import { expect, test, type Page } from "@playwright/test";
import { withDb } from "./db";

/** Find and replace, highlight notes, and tag counts. */
type Snap = { segs: Map<string, string>; hls: Map<string, string> };
async function snapshot(sourceId: string): Promise<Snap> {
  return withDb(async (c) => ({
    segs: new Map((await c.query(`select id, text from "Segment" where "sourceId" = $1`, [sourceId])).rows.map((r) => [r.id, r.text])),
    hls: new Map((await c.query(`select id, "startSegmentId"||':'||"startOffset"||'-'||"endSegmentId"||':'||"endOffset"||'|'||status||'|'||text as k from "Highlight" where "sourceId" = $1`, [sourceId])).rows.map((r) => [r.id, r.k])),
  }));
}
/** Every ACTIVE highlight's stored text equals the transcript slice at its anchors. */
async function anchorsConsistent(sourceId: string) {
  return withDb(async (c) => (await c.query(`
    select count(*)::int as bad from "Highlight" h
    join "Segment" a on a.id = h."startSegmentId" join "Segment" b on b.id = h."endSegmentId"
    where h."sourceId" = $1 and h.status = 'ACTIVE' and (
      (a.id = b.id and substr(a.text, h."startOffset" + 1, h."endOffset" - h."startOffset") <> h.text) or
      (a.id <> b.id and left(h.text, length(a.text) - h."startOffset") <> substr(a.text, h."startOffset" + 1)))`, [sourceId])).rows[0].bad);
}

let ctx: { sourceId: string; projectId: string; word: string; occurrences: number };

test.beforeAll(async () => {
  ctx = await withDb(async (c) => {
    // A source with highlights; the word is the first 6+ letter word inside a single-segment highlight.
    const { rows } = await c.query(`
      select h."sourceId", s."projectId", h.text from "Highlight" h join "Source" s on s.id = h."sourceId" join "Project" p on p.id = s."projectId"
      where h.status = 'ACTIVE' and p.access = 'OPEN' and h."startSegmentId" = h."endSegmentId" and h.text ~ '[A-Za-z]{6,}' order by h.id limit 1`);
    const word = rows[0].text.match(/[A-Za-z]{6,}/)[0];
    const occ = (await c.query(`select coalesce(sum((length(text) - length(replace(lower(text), lower($2), ''))) / length($2)), 0)::int as n from "Segment" where "sourceId" = $1`, [rows[0].sourceId, word])).rows[0].n;
    return { sourceId: rows[0].sourceId, projectId: rows[0].projectId, word, occurrences: occ };
  });
});

async function replaceAll(page: Page, find: string, repl: string) {
  await page.getByLabel("Find", { exact: true }).fill(find);
  await page.getByLabel("Replace with").fill(repl);
  await page.getByRole("button", { name: "Replace all" }).click();
  await expect(page.getByText(/^Replaced \d+ occurrence/).last()).toBeVisible();
  await page.waitForTimeout(1500); // per-line debounced saves
}

test("replace all keeps every highlight anchored, and is fully reversible", async ({ page }) => {
  const before = await snapshot(ctx.sourceId);
  await page.goto(`/projects/${ctx.projectId}/sources/${ctx.sourceId}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /Find and replace/ }).click();
  await page.getByLabel("Find", { exact: true }).fill(ctx.word);
  await expect(page.getByText(new RegExp(`^1 of ${ctx.occurrences}$`))).toBeVisible();
  await expect(page.locator(".find-current")).toHaveCount(1);

  await replaceAll(page, ctx.word, `${ctx.word}QQX`);
  const mid = await snapshot(ctx.sourceId);
  expect([...mid.segs.values()].join("\n")).toContain(`${ctx.word}QQX`);
  expect(await anchorsConsistent(ctx.sourceId)).toBe(0);
  expect([...mid.hls.values()].some((k) => k.includes(`${ctx.word}QQX`))).toBe(true);

  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.keyboard.press("ControlOrMeta+f");
  await replaceAll(page, `${ctx.word}QQX`, ctx.word);
  const after = await snapshot(ctx.sourceId);
  expect(after.segs).toEqual(before.segs);
  expect(after.hls).toEqual(before.hls);
});

test("a note on a highlight saves and survives a reload", async ({ page }) => {
  const NOTE = "E2E note: shows the spreadsheet workaround";
  const hid = await withDb(async (c) => (await c.query(`select id from "Highlight" where "sourceId" = $1 and status = 'ACTIVE' order by id limit 1`, [ctx.sourceId])).rows[0].id);
  await page.goto(`/projects/${ctx.projectId}/sources/${ctx.sourceId}`);
  await page.waitForLoadState("networkidle");
  const item = page.locator(`[data-highlight-item="${hid}"]`);
  await item.hover();
  await item.getByRole("button", { name: "Add note" }).click();
  await item.getByLabel("Note on this highlight").fill(NOTE);
  await item.getByLabel("Note on this highlight").press("ControlOrMeta+Enter");
  await expect(item.getByLabel("Note on this highlight")).toHaveCount(0); // editor closes once the save returns
  await expect(item.getByText(NOTE)).toBeVisible();
  await page.reload();
  await expect(page.locator(`[data-highlight-item="${hid}"]`).getByText(NOTE)).toBeVisible();
  expect(await withDb(async (c) => (await c.query(`select note from "Highlight" where id = $1`, [hid])).rows[0].note)).toBe(NOTE);
  await withDb(async (c) => { await c.query(`update "Highlight" set note = null where id = $1`, [hid]); });
});

test("tag counts: project page list and the tags-by-project table link to matching searches", async ({ page }) => {
  await page.goto(`/projects/${ctx.projectId}`);
  const first = page.getByRole("heading", { name: "Tags in this project" }).locator("..").locator("..").locator("ul li a").first();
  const n = Number(await first.locator("span").last().textContent());
  await first.click();
  await expect(page).toHaveURL(/\/search\?.*tag=/);
  await expect(page.getByText(new RegExp(`^${n} highlights?`))).toBeVisible();

  await page.goto("/tags?view=projects");
  const cell = page.locator("tbody td a").first();
  const c = Number(await cell.textContent());
  await cell.click();
  await expect(page).toHaveURL(/\/search\?.*project=.*tag=|\/search\?.*tag=.*project=/);
  await expect(page.getByText(new RegExp(`^${c} highlights?`))).toBeVisible();
});
