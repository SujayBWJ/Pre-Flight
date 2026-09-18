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

  it("keeps a salary revision discrepancy in NEEDS_CLARIFICATION until the revision evidence is provided", () => {
    const revisedProfile = canonicalProfileSchema.parse({
      ...profile,
      income: { gross_monthly: 40000, net_monthly: null }
    });
    const salarySlipWithRevision = extractedDocumentSchema.parse({
      document_id: "doc_salary_60000",
      document_type: "salary_slip",
      filename: "salary_slip_august.pdf",
      fields: { gross_monthly_income: 60000, net_monthly_income: 56000, employer: "ABC Technologies" },
      sources: [
        { field: "gross_monthly_income", value: 60000, source_label: "Gross Salary", page: 1 },
        { field: "net_monthly_income", value: 56000, source_label: "Net Salary", page: 1 }
      ]
    });
    const result = evaluatePreparation(revisedProfile, getInstitutionConfig("hdfc_demo"), [salarySlipWithRevision]);

    expect(result.overall_state).toBe("NEEDS_CLARIFICATION");
    expect(result.issues[0]).toMatchObject({ canonical_field: "income.gross_monthly" });
  });

  it("reconciles salary revision evidence when the previous salary, revised salary, and current slip match", () => {
    const updatedProfile = canonicalProfileSchema.parse({
      ...profile,
      income: { gross_monthly: 40000, net_monthly: null }
    });
    const revisionLetter = extractedDocumentSchema.parse({
      document_id: "doc_revision_001",
      document_type: "salary_revision_letter",
      filename: "Revision_Letter_Aug_2026.pdf",
      fields: {
        gross_monthly_income: null,
        net_monthly_income: null,
        employer: "ABC Technologies",
        previous_salary: 40000,
        revised_salary: 60000,
        effective_date: "2026-08-01"
      },
      sources: [
        { field: "previous_salary", value: 40000, source_label: "Salary revision letter", page: 1 },
        { field: "revised_salary", value: 60000, source_label: "Salary revision letter", page: 1 },
        { field: "effective_date", value: 20260801, source_label: "Salary revision letter", page: 1 }
      ]
    });

    const slip = extractedDocumentSchema.parse({
      document_id: "doc_salary_60000",
      document_type: "salary_slip",
      filename: "salary_slip_august.pdf",
      fields: { gross_monthly_income: 60000, net_monthly_income: 56000, employer: "ABC Technologies" },
      sources: [
        { field: "gross_monthly_income", value: 60000, source_label: "Gross Salary", page: 1 },
        { field: "net_monthly_income", value: 56000, source_label: "Net Salary", page: 1 }
      ]
    });

    const result = evaluatePreparation(updatedProfile, getInstitutionConfig("hdfc_demo"), [slip, revisionLetter]);

    expect(result.overall_state).toBe("VERIFIED");
    expect(result.reconciliation?.explanation_type).toBe("SALARY_REVISION");
    expect(result.reconciliation?.explanation).toContain("revised gross salary of ₹60,000");
  });

  it("does not flag a gross-versus-net salary difference when net income and salary credit match", () => {
    const declaredNetProfile = canonicalProfileSchema.parse({
      ...profile,
      income: { gross_monthly: 60000, net_monthly: 56000 }
    });
    const salarySlipNet = extractedDocumentSchema.parse({
      document_id: "doc_net_001",
      document_type: "salary_slip",
      filename: "Salary_Slip_Net.pdf",
      fields: { gross_monthly_income: 60000, net_monthly_income: 56000, employer: "XYZ Pvt Ltd" },
      sources: [
        { field: "gross_monthly_income", value: 60000, source_label: "Gross Salary", page: 1 },
        { field: "net_monthly_income", value: 56000, source_label: "Net Salary", page: 1 }
      ]
    });
    const bankStatement = extractedDocumentSchema.parse({
      document_id: "doc_bank_001",
      document_type: "bank_statement",
      filename: "bank_statement_august.pdf",
      fields: { gross_monthly_income: null, net_monthly_income: 56000, employer: null },
      sources: [
        { field: "net_monthly_income", value: 56000, source_label: "Salary Credit", page: 1 }
      ]
    });

    const result = evaluatePreparation(declaredNetProfile, getInstitutionConfig("sbi_demo"), [salarySlipNet, bankStatement]);

    expect(result.overall_state).toBe("VERIFIED");
    expect(result.issues).toHaveLength(0);
    expect(result.reconciliation?.explanation_type).toBe("GROSS_NET_DIFFERENCE");
  });

  it("requests clarification for a recent job change until employment evidence matches the current employer", () => {
    const profileWithNewJob = canonicalProfileSchema.parse({
      ...profile,
      employment: { type: "salaried", employer: "ABC Technologies" },
      income: { gross_monthly: 40000, net_monthly: null }
    });
    const latestSlip = extractedDocumentSchema.parse({
      document_id: "doc_job_001",
      document_type: "salary_slip",
      filename: "salary_slip_orbit.pdf",
      fields: { gross_monthly_income: 60000, net_monthly_income: 54000, employer: "Orbit Technologies Pvt. Ltd." },
      sources: [
        { field: "gross_monthly_income", value: 60000, source_label: "Gross Salary", page: 1 },
        { field: "employer", value: 0, source_label: "Employer", page: 1 }
      ]
    });

    const result = evaluatePreparation(profileWithNewJob, getInstitutionConfig("hdfc_demo"), [latestSlip]);

    expect(result.overall_state).toBe("NEEDS_CLARIFICATION");
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ canonical_field: "employment.employer" })
    ]));
  });

  it("resolves a recent job change with matching previous and current employers plus compensation", () => {
    const profileWithOldEmployer = canonicalProfileSchema.parse({
      ...profile,
      employment: { type: "salaried", employer: "ABC Technologies" },
      income: { gross_monthly: 40000, net_monthly: null }
    });
    const offerLetter = extractedDocumentSchema.parse({
      document_id: "doc_offer_001",
      document_type: "offer_letter",
      filename: "offer_letter_orbit.pdf",
      fields: {
        gross_monthly_income: null,
        net_monthly_income: null,
        employer: "Orbit Technologies Pvt. Ltd.",
        previous_employer: "ABC Technologies",
        new_employer: "Orbit Technologies Pvt. Ltd.",
        joining_date: "2026-06-15",
        compensation: 60000
      },
      sources: [
        { field: "previous_employer", value: 0, source_label: "Offer letter", page: 1 },
        { field: "new_employer", value: 0, source_label: "Offer letter", page: 1 },
        { field: "compensation", value: 60000, source_label: "Offer letter", page: 1 }
      ]
    });
    const latestSlip = extractedDocumentSchema.parse({
      document_id: "doc_job_002",
      document_type: "salary_slip",
      filename: "salary_slip_orbit.pdf",
      fields: { gross_monthly_income: 60000, net_monthly_income: 54000, employer: "Orbit Technologies Pvt. Ltd." },
      sources: [
        { field: "gross_monthly_income", value: 60000, source_label: "Gross Salary", page: 1 },
        { field: "employer", value: 0, source_label: "Employer", page: 1 }
      ]
    });

    const result = evaluatePreparation(profileWithOldEmployer, getInstitutionConfig("hdfc_demo"), [latestSlip, offerLetter]);

    expect(result.overall_state).toBe("VERIFIED");
    expect(result.reconciliation?.explanation_type).toBe("RECENT_JOB_CHANGE");
    expect(result.reconciliation?.explanation).toContain("Orbit Technologies");
  });

  it("keeps unresolved salary revision evidence in NEEDS_CLARIFICATION when the document does not match the declared prior salary", () => {
    const revisedProfile = canonicalProfileSchema.parse({
      ...profile,
      income: { gross_monthly: 40000, net_monthly: null }
    });
    const wrongRevisionLetter = extractedDocumentSchema.parse({
      document_id: "doc_revision_wrong",
      document_type: "salary_revision_letter",
      filename: "wrong_revision_letter.pdf",
      fields: {
        gross_monthly_income: null,
        net_monthly_income: null,
        employer: "ABC Technologies",
        previous_salary: 45000,
        revised_salary: 60000,
        effective_date: "2026-08-01"
      },
      sources: [
        { field: "previous_salary", value: 45000, source_label: "Salary revision letter", page: 1 },
        { field: "revised_salary", value: 60000, source_label: "Salary revision letter", page: 1 },
        { field: "effective_date", value: 20260801, source_label: "Salary revision letter", page: 1 }
      ]
    });
    const slip = extractedDocumentSchema.parse({
      document_id: "doc_salary_60000",
      document_type: "salary_slip",
      filename: "salary_slip_august.pdf",
      fields: { gross_monthly_income: 60000, net_monthly_income: 56000, employer: "ABC Technologies" },
      sources: [
        { field: "gross_monthly_income", value: 60000, source_label: "Gross Salary", page: 1 },
        { field: "net_monthly_income", value: 56000, source_label: "Net Salary", page: 1 }
      ]
    });

    const result = evaluatePreparation(revisedProfile, getInstitutionConfig("hdfc_demo"), [slip, wrongRevisionLetter]);

    expect(result.overall_state).toBe("NEEDS_CLARIFICATION");
    expect(result.reconciliation?.unresolved_items.join(" ")).toContain("previous salary");
  });

  it("preserves provenance throughout reconciliation when evidence validates the difference", () => {
    const updatedProfile = canonicalProfileSchema.parse({
      ...profile,
      income: { gross_monthly: 40000, net_monthly: null }
    });
    const revisionLetter = extractedDocumentSchema.parse({
      document_id: "doc_revision_002",
      document_type: "salary_revision_letter",
      filename: "Revision_Letter_Aug_2026.pdf",
      fields: {
        gross_monthly_income: null,
        net_monthly_income: null,
        employer: "ABC Technologies",
        previous_salary: 40000,
        revised_salary: 60000,
        effective_date: "2026-08-01"
      },
      sources: [
        { field: "previous_salary", value: 40000, source_label: "Salary revision letter", page: 1 },
        { field: "revised_salary", value: 60000, source_label: "Salary revision letter", page: 1 },
        { field: "effective_date", value: 20260801, source_label: "Salary revision letter", page: 1 }
      ]
    });
    const slip = extractedDocumentSchema.parse({
      document_id: "doc_salary_60000",
      document_type: "salary_slip",
      filename: "salary_slip_august.pdf",
      fields: { gross_monthly_income: 60000, net_monthly_income: 56000, employer: "ABC Technologies" },
      sources: [
        { field: "gross_monthly_income", value: 60000, source_label: "Gross Salary", page: 1 },
        { field: "net_monthly_income", value: 56000, source_label: "Net Salary", page: 1 }
      ]
    });

    const result = evaluatePreparation(updatedProfile, getInstitutionConfig("hdfc_demo"), [slip, revisionLetter]);

    expect(result.reconciliation?.provenance.some((entry) => entry.reference === "Revision_Letter_Aug_2026.pdf")).toBe(true);
    expect(result.reconciliation?.provenance.some((entry) => entry.reference === "salary_slip_august.pdf")).toBe(true);
  });
});