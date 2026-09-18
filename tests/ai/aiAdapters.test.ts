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

  it("normalizes monetary shorthand after Gemini extraction too", async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({
        product: "personal_loan",
        loan_amount: 300000,
        tenure_months: 24,
        income: { gross_monthly: 50, net_monthly: null },
        employment: { type: "salaried", employer: null },
        existing_emi: 7000,
        purpose: null
      }) }] } }] })
    })) as unknown as typeof fetch;

    const result = await new GeminiIntentExtractor("test-key").extract("I earn 50K per month and I am salaried.");

    expect(result.profile.income.gross_monthly).toBe(50000);
    expect(result.profile.employment.type).toBe("salaried");
  });
});