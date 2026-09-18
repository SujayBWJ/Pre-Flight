import { describe, expect, it } from "vitest";
import { getInstitutionConfig } from "../../src/institutions/configLoader.js";
import { canonicalProfileSchema, extractedDocumentSchema } from "../../src/domain/schemas.js";
import { institutionConfigSchema } from "../../src/domain/schemas.js";
import { evaluatePreparation } from "../../src/verification/verificationEngine.js";

const profile = canonicalProfileSchema.parse({
  product: "personal_loan",
  loan_amount: 300000,
  tenure_months: 24,
  income: { gross_monthly: 60000, net_monthly: null },
  employment: { type: "salaried", employer: null },
  existing_emi: 7000,
  purpose: null
});

const salarySlip = extractedDocumentSchema.parse({
  document_id: "doc_001",
  document_type: "salary_slip",
  filename: "Salary_Slip_August.pdf",
  fields: { gross_monthly_income: 60000, net_monthly_income: 48000, employer: "XYZ Pvt Ltd" },
  sources: [
    { field: "gross_monthly_income", value: 60000, source_label: "Gross Salary", page: 1 },
    { field: "net_monthly_income", value: 48000, source_label: "Net Salary", page: 1 }
  ]
});

describe("deterministic preparation verification", () => {
  it("keeps declared income PROVIDED without evidence and reports missing documents", () => {
    const result = evaluatePreparation(profile, getInstitutionConfig("hdfc_demo"), []);

    expect(result.overall_state).toBe("PROVIDED");
    expect(result.checks.find((check) => check.id === "monthly_income")?.status).toBe("PROVIDED");
    expect(result.issues).toHaveLength(0);
    expect(result.document_requirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ document_type: "salary_slip", provided: false, verification_optional: true })
    ]));
  });

  it("verifies matching gross income without comparing it to net income", () => {
    const result = evaluatePreparation(profile, getInstitutionConfig("hdfc_demo"), [salarySlip]);

    expect(result.checks.find((check) => check.id === "monthly_income")?.status).toBe("VERIFIED");
    expect(result.issues).toHaveLength(0);
    expect(result.provenance[0]?.source_label).toBe("Gross Salary");
  });

  it("detects a deterministic net-income conflict with provenance and next action", () => {
    const netDeclaredProfile = canonicalProfileSchema.parse({
      ...profile,
      income: { gross_monthly: 60000, net_monthly: 60000 }
    });
    const result = evaluatePreparation(netDeclaredProfile, getInstitutionConfig("sbi_demo"), [salarySlip]);

    expect(result.overall_state).toBe("NEEDS_CLARIFICATION");
    expect(result.issues[0]).toMatchObject({
      canonical_field: "income.net_monthly",
      declared_value: 60000,
      documented_value: 48000,
      difference: 12000
    });
    expect(result.provenance[0]?.source_label).toBe("Net Salary");
    expect(result.next_actions.length).toBeGreaterThan(0);
  });

  const conflictingSalarySlip = extractedDocumentSchema.parse({
    ...salarySlip,
    document_id: "doc_002",
    fields: { gross_monthly_income: 50000, net_monthly_income: 48000, employer: "XYZ Pvt Ltd" },
    sources: [
      { field: "gross_monthly_income", value: 50000, source_label: "Gross Salary", page: 1 },
      { field: "net_monthly_income", value: 48000, source_label: "Net Salary", page: 1 }
    ]
  });

  it("detects a gross-income conflict and clears it after correction", () => {
    const initial = evaluatePreparation(profile, getInstitutionConfig("hdfc_demo"), [conflictingSalarySlip]);

    expect(initial.overall_state).toBe("NEEDS_CLARIFICATION");
    expect(initial.issues[0]).toMatchObject({
      canonical_field: "income.gross_monthly",
      declared_value: 60000,
      documented_value: 50000,
      difference: 10000
    });

    const correctedProfile = canonicalProfileSchema.parse({
      ...profile,
      income: { gross_monthly: 50000, net_monthly: null }
    });
    const corrected = evaluatePreparation(correctedProfile, getInstitutionConfig("hdfc_demo"), [conflictingSalarySlip]);

    expect(corrected.issues).toHaveLength(0);
    expect(corrected.checks.find((check) => check.id === "monthly_income")?.status).toBe("VERIFIED");
  });

  it("uses a later matching document instead of stopping at an earlier conflict", () => {
    const result = evaluatePreparation(profile, getInstitutionConfig("hdfc_demo"), [conflictingSalarySlip, salarySlip]);

    expect(result.issues).toHaveLength(0);
    expect(result.checks.find((check) => check.id === "monthly_income")?.status).toBe("VERIFIED");
  });

  it("keeps the canonical profile stable while institution mappings change", () => {
    const hdfc = getInstitutionConfig("hdfc_demo");
    const sbi = getInstitutionConfig("sbi_demo");
    const hdfcResult = evaluatePreparation(profile, hdfc, [salarySlip]);
    const sbiResult = evaluatePreparation(profile, sbi, [salarySlip]);

    expect(profile.income).toEqual({ gross_monthly: 60000, net_monthly: null });
    expect(hdfc.fieldMappings.monthly_income).not.toBe(sbi.fieldMappings.monthly_income);
    expect(hdfcResult.checks.find((check) => check.id === "monthly_income")?.status).toBe("VERIFIED");
    expect(sbiResult.checks.find((check) => check.id === "monthly_income")?.status).toBe("MISSING");
  });

  it("does not depend on the institution field key being monthly_income", () => {
    const customConfig = institutionConfigSchema.parse({
      institution: "custom_demo",
      product: "personal_loan",
      label: "Representative demo configuration",
      requiredFields: ["income_requirement"],
      requiredDocuments: ["salary_slip"],
      fieldMappings: { income_requirement: "income.gross_monthly" },
      documentFieldMappings: { "income.gross_monthly": "gross_monthly_income" },
      terminology: { income_requirement: "Income requirement" },
      validationRules: []
    });
    const result = evaluatePreparation(profile, customConfig, [salarySlip]);

    expect(result.checks[0]).toMatchObject({ id: "income_requirement", status: "VERIFIED" });
  });
});