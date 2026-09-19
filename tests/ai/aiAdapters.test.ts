import { afterEach, describe, expect, it } from "vitest";
import { GeminiIntentExtractor } from "../../src/ai/intentExtractor.js";
import { SyntheticDocumentExtractor } from "../../src/ai/documentExtractor.js";

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

  it("keeps an old salary slip insufficient but exposes deterministic revision evidence for revision letters", async () => {
    const extractor = new SyntheticDocumentExtractor();
    const oldSlip = await extractor.extract({ filename: "PaySlip_Aarav_Sharma_September_2026.pdf", documentType: "salary_revision_letter", bytes: Buffer.from("synthetic"), mimeType: "application/pdf" });
    const revisionLetter = await extractor.extract({ filename: "Salary_Revision_Letter_Aug_2026.pdf", documentType: "salary_revision_letter", bytes: Buffer.from("synthetic"), mimeType: "application/pdf" });

    expect(oldSlip.document.fields.previous_salary).toBeUndefined();
    expect(revisionLetter.document.fields).toMatchObject({ previous_salary: 40000, revised_salary: 60000, effective_date: "2026-08-01" });
    expect(revisionLetter.document.sources).toHaveLength(3);
  });

  it("extracts the provided updated Aarav salary slip values in the demo fallback", async () => {
    const result = await new SyntheticDocumentExtractor().extract({ filename: "PaySlip_Aarav_Sharma_September_2026.pdf", documentType: "salary_slip", bytes: Buffer.from("synthetic"), mimeType: "application/pdf" });

    expect(result.document.fields).toMatchObject({ gross_monthly_income: 126000, net_monthly_income: 125000 });
  });
});