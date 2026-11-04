import { describe, expect, it } from "vitest";
import { locateQuote } from "@/lib/ai/quote";

const text = "We export to Excel. Then we export to Excel again, because the tool “forgets” the settings.";

describe("locateQuote", () => {
  it("finds an exact quote", () => {
    const s = locateQuote(text, "Then we export to Excel again")!;
    expect(text.slice(s.start, s.end)).toBe("Then we export to Excel again");
  });

  it("picks the occurrence nearest the hint", () => {
    const first = locateQuote(text, "export to Excel", 0)!;
    const second = locateQuote(text, "export to Excel", 30)!;
    expect(first.start).toBe(3);
    expect(second.start).toBeGreaterThan(20);
  });

  it("tolerates case, whitespace and straight vs curly quotes", () => {
    const s = locateQuote(text, 'the tool  "FORGETS" the settings')!;
    expect(text.slice(s.start, s.end)).toBe("the tool “forgets” the settings");
  });

  it("returns null for text that is not there or empty", () => {
    expect(locateQuote(text, "we never use spreadsheets")).toBeNull();
    expect(locateQuote(text, "   ")).toBeNull();
  });
});
