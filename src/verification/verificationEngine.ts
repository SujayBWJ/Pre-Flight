import {
  type CanonicalProfile,
  type ExtractedDocument,
  type InstitutionConfig,
  type VerificationIssue,
  type VerificationResult
} from "../domain/schemas.js";

type ComparableValue = number | string | null;

function getCanonicalValue(profile: CanonicalProfile, path: string): ComparableValue | undefined {
  const value = path.split(".").reduce<unknown>((current, segment) => {
    if (current === null || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[segment];
  }, profile);
  return typeof value === "number" || typeof value === "string" || value === null ? value : undefined;
}

function getSource(document: ExtractedDocument, field: string) {
  return document.sources.find((source) => source.field === field);
}

function evaluateMappedField(
  profile: CanonicalProfile,
  config: InstitutionConfig,
  documents: ExtractedDocument[],
  institutionField: string
): { status: "MISSING" | "PROVIDED" | "VERIFIED" | "NEEDS_CLARIFICATION"; issues: VerificationIssue[]; provenance: VerificationResult["provenance"] } {
  const declaredValue = getCanonicalValue(profile, institutionField);
  if (declaredValue === null || declaredValue === undefined) {
    return { status: "MISSING", issues: [], provenance: [] };
  }

  const documentField = config.documentFieldMappings[institutionField];
  if (!documentField) return { status: "PROVIDED", issues: [], provenance: [] };

  const evidence = documents.flatMap((document) => {
    const documentedValue = document.fields[documentField as keyof typeof document.fields];
    const source = getSource(document, documentField);
    if ((typeof documentedValue !== "number" && typeof documentedValue !== "string") || !source) return [];
    return [{ document, documentedValue, source }];
  });
  const provenance = evidence.map(({ document, source }) => ({
    type: "document" as const,
    reference: document.filename,
    source_label: source.source_label,
    page: source.page
  }));
  const matchingEvidence = evidence.find(({ documentedValue }) => documentedValue === declaredValue);
  if (matchingEvidence) return { status: "VERIFIED", issues: [], provenance };
  const conflictingEvidence = evidence.find(({ documentedValue }) => typeof declaredValue === "number" && typeof documentedValue === "number");
  if (!conflictingEvidence) return { status: "PROVIDED", issues: [], provenance };

  const { document, documentedValue, source } = conflictingEvidence;
  if (typeof declaredValue !== "number" || typeof documentedValue !== "number") {
    return { status: "PROVIDED", issues: [], provenance };
  }
  return {
    status: "NEEDS_CLARIFICATION",
    provenance,
    issues: [{
      type: institutionField.startsWith("income.") ? "income_mismatch" : "field_mismatch",
      canonical_field: institutionField,
      declared_value: declaredValue,
      documented_value: documentedValue,
      difference: Math.abs(declaredValue - documentedValue),
      status: "NEEDS_CLARIFICATION",
      evidence: { document_id: document.document_id, source_label: source.source_label, page: source.page }
    }]
  };
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
    const value = getCanonicalValue(profile, mappedField);
    const status = value === null || value === undefined ? "MISSING" : "PROVIDED";
    checks.push({
      id: field,
      label: config.terminology[field] ?? field,
      status,
      detail: status === "MISSING" ? "Required information has not been provided." : "Provided by the user; not yet verified."
    });
    if (status === "MISSING") nextActions.push(`Provide ${config.terminology[field] ?? field}.`);
  }

  for (const [institutionField, canonicalField] of Object.entries(config.fieldMappings)) {
    const checkIndex = config.requiredFields.findIndex((field) => field === institutionField);
    const mappedField = canonicalField;
    const fieldCheckIndex = checkIndex >= 0 ? checkIndex : checks.findIndex((check) => check.id === institutionField);
    const fieldResult = evaluateMappedField(profile, config, documents, mappedField);
    if (fieldCheckIndex >= 0 && checks[fieldCheckIndex]) {
      const currentCheck = checks[fieldCheckIndex];
      checks[fieldCheckIndex] = {
        ...currentCheck,
        status: fieldResult.status,
        detail: fieldResult.status === "VERIFIED"
          ? "Supporting evidence matches the mapped field."
          : fieldResult.status === "NEEDS_CLARIFICATION"
            ? "Supporting evidence differs from the mapped declared value."
            : currentCheck.detail
      };
    }
    issues.push(...fieldResult.issues);
    provenance.push(...fieldResult.provenance);
    if (fieldResult.issues.length > 0) nextActions.push(`Review ${config.terminology[institutionField] ?? institutionField} and provide clarification or supporting evidence.`);
  }

  const documentRequirements: VerificationResult["document_requirements"] = [];
  for (const requiredDocument of config.requiredDocuments) {
    const present = documents.some((document) => document.document_type === requiredDocument);
    documentRequirements.push({
      document_type: requiredDocument,
      label: `${requiredDocument.replace("_", " ")} evidence`,
      provided: present,
      verification_optional: true,
      detail: present ? "Available for optional verification." : "Optional evidence that may help verify provided information."
    });
    if (!present) nextActions.push(`Upload a ${requiredDocument.replace("_", " ")} if you want to verify this information.`);
  }

  const overall_state = issues.length > 0
    ? "NEEDS_CLARIFICATION"
    : checks.some((check) => check.status === "MISSING")
      ? "MISSING"
      : checks.some((check) => check.status === "PROVIDED")
        ? "PROVIDED"
        : "VERIFIED";

  return { checks, overall_state, issues, document_requirements: documentRequirements, next_actions: [...new Set(nextActions)], provenance };
}