import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

/**
 * The only place that talks to a language model. Everything it receives is built by
 * `src/server/suggestions.ts`; everything it returns is validated and anchored there, so a
 * model mistake can at worst produce a suggestion that a person rejects (decision D59).
 */

export type TaxonomyTag = { key: string; name: string; group: string | null; description: string | null; examples: string[] };
export type TranscriptLine = { line: number; speaker: string | null; text: string };

export type ProposedHighlight = { line: number; quote: string; tags: string[]; reason: string };
export type ProposedTag = { tag: string; reason: string };

export interface SuggestionModel {
  readonly name: string;
  proposeHighlights(input: { study: string; source: string; lines: TranscriptLine[]; tags: TaxonomyTag[] }): Promise<ProposedHighlight[]>;
  suggestTags(input: { study: string; quote: string; note: string | null; context: TranscriptLine[]; tags: TaxonomyTag[]; current: string[] }): Promise<ProposedTag[]>;
}

export class ModelError extends Error {}

// ---------- configuration ----------

export function aiProvider(): "anthropic" | "fake" | null {
  if (process.env.AI_SUGGESTIONS === "off") return null;
  if (process.env.AI_PROVIDER === "fake") return "fake";
  return process.env.ANTHROPIC_API_KEY ? "anthropic" : null;
}

export function getModel(): SuggestionModel | null {
  const p = aiProvider();
  if (p === "fake") return new FakeModel();
  if (p === "anthropic") return new ClaudeModel(process.env.AI_MODEL || "claude-opus-5-5");
  return null;
}

// ---------- prompts ----------

/** Identical for both tasks and stable between calls, so it is cached (prompt caching is a prefix match). */
export function systemPrompt(tags: TaxonomyTag[]) {
  const lines = tags.map((t) => {
    const head = `- ${t.key}: ${t.name}${t.group ? ` (group: ${t.group})` : ""}`;
    const desc = t.description ? `\n  Means: ${t.description}` : "";
    const ex = t.examples.length ? `\n  Accepted examples: ${t.examples.map((e) => JSON.stringify(e)).join(" | ")}` : "";
    return head + desc + ex;
  });
  return [
    "You assist user researchers at an engineering company who analyse interview transcripts.",
    "Researchers mark highlights (short verbatim passages that carry evidence) and tag them from a fixed taxonomy.",
    "Your suggestions are reviewed by a researcher before anything is saved, so precision matters more than recall: suggest only what a careful researcher would keep.",
    "Use only tag keys from the taxonomy below. Never invent tags. If no tag fits, suggest none.",
    "Interviewer questions, small talk and logistics are not highlights.",
    "",
    "Taxonomy:",
    ...lines,
  ].join("\n");
}

export function formatLines(lines: TranscriptLine[]) {
  return lines.map((l) => `[${l.line}] ${l.speaker ?? "Unknown"}: ${l.text}`).join("\n");
}

const ProposalsSchema = z.object({
  highlights: z.array(z.object({
    line: z.number().int().describe("The [number] of the transcript line the quote comes from"),
    quote: z.string().describe("A verbatim passage copied exactly from that one line: usually one to three sentences"),
    tags: z.array(z.string()).describe("Taxonomy keys, most relevant first; at most three"),
    reason: z.string().describe("One short sentence: why a researcher would keep this"),
  })),
});

const TagsSchema = z.object({
  tags: z.array(z.object({
    tag: z.string().describe("A taxonomy key"),
    reason: z.string().describe("One short sentence tying the tag to the quote"),
  })),
});

// ---------- Claude ----------

class ClaudeModel implements SuggestionModel {
  private client = new Anthropic({ timeout: 10 * 60 * 1000 });
  constructor(readonly name: string) {}

  private async ask<T>(tags: TaxonomyTag[], task: string, schema: z.ZodType<T>, effort: "low" | "medium", maxTokens: number): Promise<T> {
    let res;
    try {
      res = await this.client.beta.messages.parse({
        model: this.name,
        max_tokens: maxTokens,
        // Server-side fallback: if the model declines on policy grounds, the API retries on its default fallback.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort, format: betaZodOutputFormat(schema) },
        system: [{ type: "text", text: systemPrompt(tags), cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: task }],
      });
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) throw new ModelError("The Anthropic API key was rejected.");
      if (e instanceof Anthropic.RateLimitError) throw new ModelError("The model is rate-limited; try again in a minute.");
      if (e instanceof Anthropic.APIError) throw new ModelError(`Model request failed (${e.status ?? "network"}).`);
      throw e;
    }
    if (res.stop_reason === "refusal") throw new ModelError("The model declined this transcript.");
    if (res.stop_reason === "max_tokens") throw new ModelError("The model ran out of room; the transcript may be too long for one pass.");
    if (!res.parsed_output) throw new ModelError("The model returned no usable answer.");
    return res.parsed_output;
  }

  async proposeHighlights({ study, source, lines, tags }: Parameters<SuggestionModel["proposeHighlights"]>[0]) {
    const task = [
      `Study: ${study}`,
      `Source: ${source}`,
      "",
      "Propose highlights for this transcript. Each highlight is a verbatim quote from a single numbered line, tagged with the taxonomy keys that fit.",
      "Prefer participant statements with concrete evidence: pains, workarounds, needs, decisions, surprises. Skip passages that only repeat an earlier highlight.",
      "",
      "Transcript:",
      formatLines(lines),
    ].join("\n");
    const out = await this.ask(tags, task, ProposalsSchema, "medium", 32000);
    return out.highlights;
  }

  async suggestTags({ study, quote, note, context, tags, current }: Parameters<SuggestionModel["suggestTags"]>[0]) {
    const task = [
      `Study: ${study}`,
      "",
      "A researcher highlighted the quote below. Suggest the taxonomy tags that fit it, at most three, best first.",
      current.length ? `It already has: ${current.join(", ")}. Do not repeat those.` : "It has no tags yet.",
      "",
      `Quote: ${JSON.stringify(quote)}`,
      note ? `Researcher's note: ${JSON.stringify(note)}` : "",
      "",
      "Surrounding transcript, for context only:",
      formatLines(context),
    ].join("\n");
    const out = await this.ask(tags, task, TagsSchema, "low", 4000);
    return out.tags;
  }
}

// ---------- fake (tests and local work without a key) ----------

/**
 * Deterministic stand-in: a tag "fits" a passage when the passage contains the first long word of the
 * tag's name. Good enough to exercise anchoring, review and persistence end to end.
 */
export class FakeModel implements SuggestionModel {
  readonly name = "fake";

  private static keyword(t: TaxonomyTag) {
    return t.name.toLowerCase().split(/[^\p{L}\p{N}]+/u).find((w) => w.length >= 4) ?? null;
  }

  private static fits(tags: TaxonomyTag[], text: string) {
    const lower = text.toLowerCase();
    return tags.filter((t) => { const k = FakeModel.keyword(t); return k && lower.includes(k); });
  }

  async proposeHighlights({ lines, tags }: Parameters<SuggestionModel["proposeHighlights"]>[0]) {
    const out: ProposedHighlight[] = [];
    for (const l of lines) {
      for (const sentence of l.text.match(/[^.!?]+[.!?]*/g) ?? []) {
        const hit = FakeModel.fits(tags, sentence);
        if (hit.length) out.push({ line: l.line, quote: sentence.trim(), tags: hit.slice(0, 3).map((t) => t.key), reason: `Mentions ${hit[0].name.toLowerCase()}.` });
      }
    }
    return out;
  }

  async suggestTags({ quote, note, tags, current }: Parameters<SuggestionModel["suggestTags"]>[0]) {
    return FakeModel.fits(tags, `${quote} ${note ?? ""}`)
      .filter((t) => !current.includes(t.key))
      .slice(0, 3)
      .map((t) => ({ tag: t.key, reason: `The quote mentions ${t.name.toLowerCase()}.` }));
  }
}
