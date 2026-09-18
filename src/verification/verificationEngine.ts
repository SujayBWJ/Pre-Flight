import {
  type CanonicalProfile,
  type ExtractedDocument,
  type InstitutionConfig,
  type VerificationIssue,
  type VerificationResult
} from "../domain/schemas.js";

const canonicalValues: Record<string, (profile: CanonicalProfile) => number | string | null> = {
  loan_amount: (profile) => profile.loan_amount,
  tenure_months: (profile) => profile.tenure_months,
  employment_type: (profile) => profile.employment.type,
  "income.gross_monthly": (profile) => profile.income.gross_monthly,
  "income.net_monthly": (profile) => profile.income.net_monthly
};

function getSource(document: ExtractedDocument, field: string) {
  return document.sources.find((source) => source.field === field);
}

function evaluateMappedIncome(
  profile: CanonicalProfile,
  config: InstitutionConfig,
  documents: ExtractedDocument[]
): { status: "MISSING" | "PROVIDED" | "VERIFIED" | "NEEDS_CLARIFICATION"; issue?: VerificationIssue; provenance?: VerificationResult["provenance"] } {
  const canonicalField = config.fieldMappings.monthly_income;
  if (!canonicalField) return { status: "MISSING" };
  const declaredValue = canonicalValues[canonicalField]?.(profile);
  if (typeof declaredValue !== "number") {
    return { status: "MISSING" };
  }

  const documentField = config.documentFieldMappings[canonicalField];
  if (!documentField) return { status: "MISSING" };
  for (const document of documents) {
    const documentedValue = document.fields[documentField as keyof typeof document.fields];
    if (typeof documentedValue !== "number") continue;
    const source = getSource(document, documentField);
    if (!source) continue;

    const provenance = [{
      type: "document" as const,
      reference: document.filename,
      source_label: source.source_label,
      page: source.page
    }];
    if (documentedValue === declaredValue) return { status: "VERIFIED", provenance };

    return {
      status: "NEEDS_CLARIFICATION",
      provenance,
      issue: {
        type: "income_mismatch",
        canonical_field: canonicalField,
        declared_value: declaredValue,
        documented_value: documentedValue,
        difference: Math.abs(declaredValue - documentedValue),
        status: "NEEDS_CLARIFICATION",
        evidence: { document_id: document.document_id, source_label: source.source_label, page: source.page }
      }
    };
  }

  return { status: "PROVIDED" };
}

export function evaluatePreparation(
  profile: CanonicalProfile,
  config: InstitutionConfig,
  documents: ExtractedDocument[]
): VerificationResult {
  const checks: VerificationResult["checks"] = [];
  const issues: VerificationIssue[] = [];
  const provenance: VerificationResult["provenance"] = [];
  const nextActions: string[] = [];

  for (const field of config.requiredFields) {
    const mappedField = config.fieldMappings[field] ?? field;
    const value = canonicalValues[mappedField]?.(profile);
    const status = value === null || value === undefined ? "MISSING" : "PROVIDED";
    checks.push({
      id: field,
      label: config.terminology[field] ?? field,
      status,
      detail: status === "MISSING" ? "Required information has not been provided." : "Provided by the user; not yet verified."
    });
    if (status === "MISSING") nextActions.push(`Provide ${config.terminology[field] ?? field}.`);
  }

  const incomeCheck = evaluateMappedIncome(profile, config, documents);
  const incomeCheckIndex = checks.findIndex((check) => check.id === "monthly_income");
  const incomeCheckEntry = incomeCheckIndex >= 0 ? checks[incomeCheckIndex] : undefined;
  if (incomeCheckEntry && incomeCheckIndex >= 0) {
    checks[incomeCheckIndex] = {
      ...incomeCheckEntry,
      status: incomeCheck.status,
      detail: incomeCheck.status === "VERIFIED"
        ? "Supporting evidence matches the mapped income field."
        : incomeCheck.status === "NEEDS_CLARIFICATION"
          ? "Supporting evidence differs from the mapped declared value."
          : incomeCheckEntry.detail
    };
  }
  if (incomeCheck.issue) {
    issues.push(incomeCheck.issue);
    nextActions.push("Review the declared income and provide clarification or supporting evidence.");
  }
  if (incomeCheck.provenance) provenance.push(...incomeCheck.provenance);

  for (const requiredDocument of config.requiredDocuments) {
    const present = documents.some((document) => document.document_type === requiredDocument);
    if (!present) {
      checks.push({
        id: requiredDocument,
        label: `${requiredDocument.replace("_", " ")} evidence`,
        status: "MISSING",
        detail: "This representative document has not been provided."
      });
      nextActions.push(`Upload a ${requiredDocument.replace("_", " ")} if you want to verify this information.`);
    }
  }

  const overall_state = issues.length > 0
    ? "NEEDS_CLARIFICATION"
    : checks.some((check) => check.status === "MISSING")
      ? "MISSING"
      : checks.some((check) => check.status === "PROVIDED")
        ? "PROVIDED"
        : "VERIFIED";

  return { checks, overall_state, issues, next_actions: [...new Set(nextActions)], provenance };
}