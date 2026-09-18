import { afterEach, describe, expect, it } from "vitest";
import { GeminiIntentExtractor } from "../../src/ai/intentExtractor.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("AI adapter boundaries", () => {
  it("rejects malformed Gemini intent output before domain logic consumes it", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: "{\"loan_amount\": \"invented\"}" }] } }] })
    })) as unknown as typeof fetch;

    await expect(new GeminiIntentExtractor("test-key").extract("synthetic input")).rejects.toThrow();
  });
});