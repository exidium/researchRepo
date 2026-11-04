import { expect, test } from "@playwright/test";
import { withDb } from "./db";

/**
 * AI suggestions with the offline fake model (AI_PROVIDER=fake in .env): propose highlights, accept and
 * dismiss them, suggest tags on a highlight, and edit a tag description. Cleans up after itself.
 */

const keyword = (name: string) => name.toLowerCase().split(/[^\p{L}\p{N}]+/u).find((w) => w.length >= 4) ?? null;

let ctx: { sourceId: string; projectId: string; highlightId: string; tagName: string; tagId: string; descTagId: string; descBefore: string | null };

test.beforeAll(async () => {
  ctx = await withDb(async (c) => {
    const tags = (await c.query(`select id, name from "Tag" where "archivedAt" is null`)).rows as { id: string; name: string }[];
    // A highlight in an open project whose text contains a tag keyword it is not tagged with yet.
    const hls = (await c.query(`
      select h.id, h.text, h."sourceId", s."projectId", array(select "tagId" from "HighlightTag" where "highlightId" = h.id) as tag_ids
      from "Highlight" h join "Source" s on s.id = h."sourceId" join "Project" p on p.id = s."projectId"
      where h.status = 'ACTIVE' and p.access = 'OPEN' order by h.id`)).rows as { id: string; text: string; sourceId: string; projectId: string; tag_ids: string[] }[];
    for (const h of hls) {
      const t = tags.find((t) => { const k = keyword(t.name); return k && h.text.toLowerCase().includes(k) && !h.tag_ids.includes(t.id); });
      if (t) {
        const d = (await c.query(`select id, description from "Tag" where "archivedAt" is null order by name limit 1`)).rows[0];
        return { sourceId: h.sourceId, projectId: h.projectId, highlightId: h.id, tagName: t.name, tagId: t.id, descTagId: d.id, descBefore: d.description };
      }
    }
    throw new Error("no suitable highlight in the seed");
  });
});

test.afterAll(async () => {
  await withDb(async (c) => {
    await c.query(`delete from "Highlight" where "sourceId" = $1 and "aiAssisted"`, [ctx.sourceId]);
    await c.query(`delete from "SuggestionJob" where "sourceId" = $1`, [ctx.sourceId]);
    await c.query(`delete from "HighlightSuggestion" where "sourceId" = $1`, [ctx.sourceId]);
    await c.query(`delete from "TagSuggestion" where "highlightId" in (select id from "Highlight" where "sourceId" = $1)`, [ctx.sourceId]);
    await c.query(`delete from "HighlightTag" where "highlightId" = $1 and "tagId" = $2`, [ctx.highlightId, ctx.tagId]);
    await c.query(`update "Tag" set description = $2 where id = $1`, [ctx.descTagId, ctx.descBefore]);
  });
});

test("propose highlights, accept one, dismiss one", async ({ page }) => {
  await page.goto(`/projects/${ctx.projectId}/sources/${ctx.sourceId}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Suggest highlights" }).click();

  const list = page.getByRole("region", { name: "Suggested highlights" });
  await expect(list).toBeVisible({ timeout: 20_000 }); // the panel polls every 4 s
  const pending = await withDb(async (c) => (await c.query(`select id, quote from "HighlightSuggestion" where "sourceId" = $1 and status = 'PENDING'`, [ctx.sourceId])).rows);
  expect(pending.length).toBeGreaterThan(1);
  await expect(page.locator(".transcript-editor .suggestion").first()).toBeVisible();

  const before = await page.locator("[data-highlight-item]").count();
  const first = list.locator("[data-suggestion-item]").first();
  const firstId = await first.getAttribute("data-suggestion-item");
  await first.getByRole("button", { name: "Accept" }).click();
  await expect(page.locator("[data-highlight-item]")).toHaveCount(before + 1);
  await expect(page.getByText(/AI-suggested, reviewed by/).first()).toBeVisible();

  const accepted = await withDb(async (c) => (await c.query(`
    select s.status, h.text = s.quote as same, h."aiAssisted", substr(g.text, h."startOffset" + 1, h."endOffset" - h."startOffset") = h.text as anchored
    from "HighlightSuggestion" s join "Highlight" h on h.id = s."highlightId" join "Segment" g on g.id = h."startSegmentId" where s.id = $1`, [firstId])).rows[0]);
  expect(accepted).toEqual({ status: "ACCEPTED", same: true, aiAssisted: true, anchored: true });

  const second = list.locator("[data-suggestion-item]").first();
  const secondId = await second.getAttribute("data-suggestion-item");
  await second.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.locator(`[data-suggestion-item="${secondId}"]`)).toHaveCount(0);
  expect(await withDb(async (c) => (await c.query(`select status from "HighlightSuggestion" where id = $1`, [secondId])).rows[0].status)).toBe("REJECTED");

  // Reviewed suggestions stay reviewed after a reload; nothing unreviewed reached search counts.
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.locator(`[data-suggestion-item="${firstId}"], [data-suggestion-item="${secondId}"]`)).toHaveCount(0);
});

test("suggest tags on a highlight and accept one", async ({ page }) => {
  await page.goto(`/projects/${ctx.projectId}/sources/${ctx.sourceId}?highlight=${ctx.highlightId}`);
  await page.waitForLoadState("networkidle");
  const card = page.locator(`[data-highlight-item="${ctx.highlightId}"]`);
  await card.hover();
  await card.getByRole("button", { name: "Suggest tags" }).click();
  const chip = card.getByRole("button", { name: `Add suggested tag ${ctx.tagName}` });
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(card.getByRole("button", { name: `Remove tag ${ctx.tagName}` })).toBeVisible();
  const row = await withDb(async (c) => (await c.query(`
    select (select status from "TagSuggestion" where "highlightId" = $1 and "tagId" = $2) as status,
           exists(select 1 from "HighlightTag" where "highlightId" = $1 and "tagId" = $2) as tagged`, [ctx.highlightId, ctx.tagId])).rows[0]);
  expect(row).toEqual({ status: "ACCEPTED", tagged: true });
});

test("admins edit a tag description inline", async ({ page }) => {
  await page.goto("/tags");
  const name = await withDb(async (c) => (await c.query(`select name from "Tag" where id = $1`, [ctx.descTagId])).rows[0].name);
  const text = `QQX meaning of ${name}`;
  const trigger = ctx.descBefore ? page.getByRole("button", { name: ctx.descBefore }) : page.getByRole("button", { name: "Add description" }).first();
  await trigger.click();
  await page.getByLabel(`Description of ${name}`).fill(text);
  await page.getByRole("button", { name: "Save description" }).click();
  await expect(page.getByRole("button", { name: text })).toBeVisible();
  expect(await withDb(async (c) => (await c.query(`select description from "Tag" where id = $1`, [ctx.descTagId])).rows[0].description)).toBe(text);
});
