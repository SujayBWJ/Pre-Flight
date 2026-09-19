import {
  type CanonicalProfile,
  type ExtractedDocument,
  type InstitutionConfig,
  type Reconciliation,
  type VerificationIssue,
  type VerificationResult
} from "../domain/schemas.js";

type ComparableValue = number | string | null;

type ReconciliationOutcome = {
  status: "MISSING" | "PROVIDED" | "VERIFIED" | "NEEDS_CLARIFICATION";
  issues: VerificationIssue[];
  provenance: VerificationResult["provenance"];
  reconciliation?: Reconciliation;
};
type ReconciliationContext = { explanation_type: "SALARY_REVISION" | "GROSS_NET_DIFFERENCE" | "RECENT_JOB_CHANGE"; previous_salary_confirmed?: boolean };

function getCanonicalValue(profile: CanonicalProfile, path: string): ComparableValue | undefined {
  const value = path.split(".").reduce<unknown>((current, segment) => {
    if (current === null || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[segment];
  }, profile);
  return typeof value === "number" || typeof value === "string" || value === null ? value : undefined;
}

function getSource(document: ExtractedDocument, field: string) {
  return document.sources.find((source) => source.field === field || source.field === field.replace(/^income\./, ""));
}

function valueMatches(a: number | string | null | undefined, b: number | string | null | undefined) {
  if (a === null || b === null || a === undefined || b === undefined) return false;
  return a === b;
}

function coerceDate(dateString: string | number | null | undefined) {
  if (typeof dateString === "number") {
    const text = String(dateString);
    if (text.length === 8) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
    return null;
  }
  if (typeof dateString !== "string") return null;
  const trimmed = dateString.trim();
  if (!trimmed) return null;
  const iso = trimmed.match(/^\d{4}-\d{2}-\d{2}$/) ? trimmed : null;
  if (iso) return iso;
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString().slice(0, 10);
}

function buildProvenance(document: ExtractedDocument, label: string, page?: number) {
  return {
    type: "document" as const,
    reference: document.filename,
    source_label: label,
    page
  };
}

function evaluateGrossVsNetReconciliation(
  profile: CanonicalProfile,
  documents: ExtractedDocument[]
): ReconciliationOutcome {
  const declaredGross = profile.income.gross_monthly;
  const declaredNet = profile.income.net_monthly;
  const salarySlip = documents.find((document) => document.document_type === "salary_slip");
  const bankDocument = documents.find((document) => document.document_type === "bank_statement");

  if (declaredNet === null || declaredNet === undefined) {
    return { status: "PROVIDED", issues: [], provenance: [] };
  }

  const slipNet = salarySlip?.fields.net_monthly_income ?? null;
  const salaryCredit = bankDocument?.fields.salary_credit ?? bankDocument?.fields.net_monthly_income ?? null;
  const slipGross = salarySlip?.fields.gross_monthly_income ?? null;

  if (!salarySlip || !bankDocument) {
    return { status: "PROVIDED", issues: [], provenance: [] };
  }

  if (slipNet === declaredNet && salaryCredit === declaredNet && slipGross !== null) {
    const provenance = [
      buildProvenance(salarySlip, salarySlip.sources.find((source) => source.field === "net_monthly_income")?.source_label ?? "Net Salary", salarySlip.sources.find((source) => source.field === "net_monthly_income")?.page),
      buildProvenance(bankDocument, bankDocument.sources.find((source) => source.field === "salary_credit" || source.field === "net_monthly_income")?.source_label ?? "Salary Credit", bankDocument.sources.find((source) => source.field === "salary_credit" || source.field === "net_monthly_income")?.page)
    ];

    return {
      status: "VERIFIED",
      issues: [],
      provenance,
      reconciliation: {
        reconciliation_id: `recon_${Date.now()}`,
        explanation_type: "GROSS_NET_DIFFERENCE",
        user_declaration: { field: "income.net_monthly", value: declaredNet, source: "user_input" },
        primary_evidence: { field: "income.net_monthly", value: slipNet ?? declaredNet, source_label: "Salary slip", page: salarySlip.sources.find((source) => source.field === "net_monthly_income")?.page },
        supporting_evidence: [
          {
            document_id: salarySlip.document_id,
            document_type: "salary_slip",
            source_label: "Salary slip",
            page: salarySlip.sources.find((source) => source.field === "gross_monthly_income")?.page,
            field: "gross_monthly_income",
            value: slipGross ?? 0
          },
          {
            document_id: bankDocument.document_id,
            document_type: "bank_statement",
            source_label: "Bank statement",
            page: bankDocument.sources.find((source) => source.field === "salary_credit" || source.field === "net_monthly_income")?.page,
            field: "salary_credit",
            value: salaryCredit ?? declaredNet
          }
        ],
        relationships: [
          { from: "User declaration", to: "Salary slip net income", note: "Declared ₹" + declaredNet + " matches net take-home salary." },
          { from: "Salary slip gross salary", to: "Bank salary credit", note: "Gross salary is before deductions and does not contradict net pay." }
        ],
        status: "VERIFIED",
        explanation: `Your declared ₹${declaredNet.toLocaleString("en-IN")} corresponds to your net/take-home salary. Your gross monthly salary is ₹${(slipGross ?? 0).toLocaleString("en-IN")} before deductions.`,
        unresolved_items: [],
        provenance
      }
    };
  }

  return { status: "PROVIDED", issues: [], provenance: [] };
}

function evaluateSalaryRevision(
  profile: CanonicalProfile,
  documents: ExtractedDocument[],
  reconciliationContext?: ReconciliationContext
): ReconciliationOutcome {
  const declaredIncome = profile.income.gross_monthly;
  if (declaredIncome === null || declaredIncome === undefined) {
    return { status: "PROVIDED", issues: [], provenance: [] };
  }

  const salaryRevisionDocs = documents.filter((document) => document.document_type === "salary_revision_letter" || document.document_type === "hr_salary_certificate");
  const currentSlip = documents.find((document) => document.document_type === "salary_slip");
  if (reconciliationContext?.explanation_type === "SALARY_REVISION" && reconciliationContext.previous_salary_confirmed && currentSlip) {
    const currentSalary = currentSlip.fields.gross_monthly_income ?? null;
    const currentSource = currentSlip.sources.find((entry) => entry.field === "gross_monthly_income") ?? currentSlip.sources[0];
    if (currentSalary !== null && currentSalary !== declaredIncome) {
      const provenance = [{ type: "document" as const, reference: currentSlip.filename, source_label: currentSource?.source_label ?? "Gross Salary", page: currentSource?.page }];
      return {
        status: "VERIFIED",
        issues: [],
        provenance,
        reconciliation: {
          reconciliation_id: `recon_${Date.now()}`,
          explanation_type: "SALARY_REVISION",
          user_declaration: { field: "income.gross_monthly", value: declaredIncome, source: "user_input" },
          primary_evidence: { field: "gross_monthly_income", value: currentSalary, source_label: currentSource?.source_label ?? "Current salary slip", page: currentSource?.page },
          supporting_evidence: [{ document_id: currentSlip.document_id, document_type: "salary_slip", source_label: currentSlip.filename, page: currentSource?.page, field: "gross_monthly_income", value: currentSalary }],
          relationships: [{ from: "User declaration", to: "Current salary slip", note: `You confirmed that the declared ₹${declaredIncome.toLocaleString("en-IN")} was your previous salary; the current salary slip shows ₹${currentSalary.toLocaleString("en-IN")}.` }],
          status: "VERIFIED",
          explanation: `You confirmed that your declared ₹${declaredIncome.toLocaleString("en-IN")} was your previous salary. The current salary slip shows a revised salary of ₹${currentSalary.toLocaleString("en-IN")}.`,
          unresolved_items: [],
          provenance
        }
      };
    }
  }
  if (!salaryRevisionDocs.length || !currentSlip) {
    return { status: "PROVIDED", issues: [], provenance: [] };
  }

  for (const revisionDocument of salaryRevisionDocs) {
    const previousSalary = revisionDocument.fields.previous_salary ?? null;
    const revisedSalary = revisionDocument.fields.revised_salary ?? null;
    const effectiveDate = coerceDate(revisionDocument.fields.effective_date ?? null);
    const currentSalary = currentSlip.fields.gross_monthly_income ?? null;

    if (previousSalary === declaredIncome && revisedSalary === currentSalary && effectiveDate) {
      const source = revisionDocument.sources.find((entry) => entry.field === "previous_salary") ?? revisionDocument.sources[0];
      const revisedSource = revisionDocument.sources.find((entry) => entry.field === "revised_salary") ?? revisionDocument.sources[1] ?? source;
      const effectiveSource = revisionDocument.sources.find((entry) => entry.field === "effective_date") ?? revisedSource;
      const slipSource = currentSlip.sources.find((entry) => entry.field === "gross_monthly_income") ?? currentSlip.sources[0];
      const provenance = [
        { type: "document" as const, reference: revisionDocument.filename, source_label: source?.source_label ?? "Salary revision letter", page: source?.page },
        { type: "document" as const, reference: currentSlip.filename, source_label: slipSource?.source_label ?? "Gross Salary", page: slipSource?.page }
      ];

      return {
        status: "VERIFIED",
        issues: [],
        provenance,
        reconciliation: {
          reconciliation_id: `recon_${Date.now()}`,
          explanation_type: "SALARY_REVISION",
          user_declaration: { field: "income.gross_monthly", value: declaredIncome, source: "user_input" },
          primary_evidence: { field: "gross_monthly_income", value: currentSalary ?? revisedSalary ?? 0, source_label: slipSource?.source_label ?? "Current salary slip", page: slipSource?.page },
          supporting_evidence: [
            { document_id: revisionDocument.document_id, document_type: revisionDocument.document_type, source_label: source?.source_label ?? "Salary revision letter", page: source?.page, field: "previous_salary", value: previousSalary ?? declaredIncome },
            { document_id: revisionDocument.document_id, document_type: revisionDocument.document_type, source_label: revisedSource?.source_label ?? "Salary revision letter", page: revisedSource?.page, field: "revised_salary", value: revisedSalary ?? currentSalary ?? 0 },
            { document_id: revisionDocument.document_id, document_type: revisionDocument.document_type, source_label: effectiveSource?.source_label ?? "Effective date", page: effectiveSource?.page, field: "effective_date", value: effectiveDate }
          ],
          relationships: [
            { from: "User declaration", to: "Previous salary", note: `Declared ₹${declaredIncome.toLocaleString("en-IN")} matches the previous compensation.` },
            { from: "Previous salary", to: "Revised salary", note: `The salary revision increases compensation to ₹${(revisedSalary ?? 0).toLocaleString("en-IN")} effective ${effectiveDate}.` },
            { from: "Revised salary", to: "Current salary slip", note: `The latest salary slip reflects the revised gross salary of ₹${(currentSalary ?? 0).toLocaleString("en-IN")}.` }
          ],
          status: "VERIFIED",
          explanation: `Your declared ₹${declaredIncome.toLocaleString("en-IN")} matches your previous compensation. Your latest salary slip reflects a revised gross salary of ₹${(currentSalary ?? 0).toLocaleString("en-IN")} effective ${effectiveDate}.`,
          unresolved_items: [],
          provenance
        }
      };
    }
  }

  return {
    status: "NEEDS_CLARIFICATION",
    issues: [{
      type: "income_mismatch",
      canonical_field: "income.gross_monthly",
      declared_value: declaredIncome,
      documented_value: currentSlip?.fields.gross_monthly_income ?? declaredIncome,
      difference: Math.abs((currentSlip?.fields.gross_monthly_income ?? declaredIncome) - declaredIncome),
      status: "NEEDS_CLARIFICATION",
      evidence: {
        document_id: currentSlip?.document_id ?? "",
        source_label: currentSlip?.sources.find((entry) => entry.field === "gross_monthly_income")?.source_label ?? "Salary slip",
        page: currentSlip?.sources.find((entry) => entry.field === "gross_monthly_income")?.page ?? 1
      }
    }],
    provenance: currentSlip ? [{ type: "document", reference: currentSlip.filename, source_label: currentSlip.sources.find((entry) => entry.field === "gross_monthly_income")?.source_label ?? "Salary slip", page: currentSlip.sources.find((entry) => entry.field === "gross_monthly_income")?.page ?? 1 }] : [],
    reconciliation: {
      reconciliation_id: `recon_${Date.now()}`,
      explanation_type: "SALARY_REVISION",
      user_declaration: { field: "income.gross_monthly", value: declaredIncome, source: "user_input" },
      primary_evidence: currentSlip ? { field: "gross_monthly_income", value: currentSlip.fields.gross_monthly_income ?? declaredIncome, source_label: currentSlip.sources.find((entry) => entry.field === "gross_monthly_income")?.source_label ?? "Salary slip", page: currentSlip.sources.find((entry) => entry.field === "gross_monthly_income")?.page ?? 1 } : undefined,
      supporting_evidence: salaryRevisionDocs.map((document) => ({
        document_id: document.document_id,
        document_type: document.document_type,
        source_label: document.filename,
        page: document.sources[0]?.page,
        field: "previous_salary",
        value: document.fields.previous_salary ?? document.fields.revised_salary ?? 0
      })),
      relationships: [{ from: "User declaration", to: "Revision evidence", note: "Supporting document does not align with the previously declared salary." }],
      status: "NEEDS_CLARIFICATION",
      explanation: "Your supporting document confirms the revised salary, but it does not show the previously declared salary value. The difference remains unresolved.",
      unresolved_items: ["previous salary does not match the declared income"],
      provenance: currentSlip ? [{ type: "document", reference: currentSlip.filename, source_label: currentSlip.sources.find((entry) => entry.field === "gross_monthly_income")?.source_label ?? "Salary slip", page: currentSlip.sources.find((entry) => entry.field === "gross_monthly_income")?.page ?? 1 }] : []
    }
  };
}

function evaluateRecentJobChange(
  profile: CanonicalProfile,
  documents: ExtractedDocument[]
): ReconciliationOutcome {
  const declaredEmployer = profile.employment.employer;
  const declaredIncome = profile.income.gross_monthly;
  if (!declaredEmployer || declaredIncome === null || declaredIncome === undefined) {
    return { status: "PROVIDED", issues: [], provenance: [] };
  }

  const employmentDocs = documents.filter((document) => document.document_type === "offer_letter" || document.document_type === "appointment_letter" || document.document_type === "employment_salary_certificate");
  const currentSlip = documents.find((document) => document.document_type === "salary_slip");
  if (!currentSlip) {
    return { status: "PROVIDED", issues: [], provenance: [] };
  }

  if (!employmentDocs.length) {
    return { status: "PROVIDED", issues: [], provenance: [] };
  }

  for (const employmentDoc of employmentDocs) {
    const previousEmployer = employmentDoc.fields.previous_employer ?? null;
    const newEmployer = employmentDoc.fields.new_employer ?? employmentDoc.fields.employer ?? null;
    const joiningDate = coerceDate(employmentDoc.fields.joining_date ?? null);
    const compensation = employmentDoc.fields.compensation ?? null;
    const currentEmployer = currentSlip.fields.employer ?? null;
    const currentSalary = currentSlip.fields.gross_monthly_income ?? null;

    if (previousEmployer === declaredEmployer && newEmployer && currentEmployer === newEmployer && (compensation === null || compensation === currentSalary) && joiningDate) {
      const employerSource = currentSlip.sources.find((entry) => entry.field === "employer") ?? currentSlip.sources[0];
      const provenance = [
        { type: "document" as const, reference: employmentDoc.filename, source_label: employmentDoc.filename, page: employmentDoc.sources[0]?.page },
        { type: "document" as const, reference: currentSlip.filename, source_label: employerSource?.source_label ?? "Employer", page: employerSource?.page }
      ];
      return {
        status: "VERIFIED",
        issues: [],
        provenance,
        reconciliation: {
          reconciliation_id: `recon_${Date.now()}`,
          explanation_type: "RECENT_JOB_CHANGE",
          user_declaration: { field: "employment.employer", value: declaredEmployer, source: "user_input" },
          primary_evidence: { field: "employment.employer", value: currentEmployer ?? newEmployer, source_label: employerSource?.source_label ?? "Current salary slip", page: employerSource?.page },
          supporting_evidence: [
            { document_id: employmentDoc.document_id, document_type: employmentDoc.document_type, source_label: employmentDoc.filename, page: employmentDoc.sources[0]?.page, field: "previous_employer", value: previousEmployer ?? declaredEmployer },
            { document_id: employmentDoc.document_id, document_type: employmentDoc.document_type, source_label: employmentDoc.filename, page: employmentDoc.sources[0]?.page, field: "new_employer", value: newEmployer },
            { document_id: employmentDoc.document_id, document_type: employmentDoc.document_type, source_label: employmentDoc.filename, page: employmentDoc.sources[0]?.page, field: "joining_date", value: joiningDate }
          ],
          relationships: [
            { from: "Application", to: "Previous employer", note: `Your application reflects ${declaredEmployer}.` },
            { from: "Previous employer", to: "New employer", note: `The employment document confirms the change to ${newEmployer} on ${joiningDate}.` },
            { from: "New employer", to: "Current salary slip", note: `The latest salary slip is issued by ${currentEmployer}.` }
          ],
          status: "VERIFIED",
          explanation: `Your application contains your previous employer and salary, while your supporting employment document and current salary slip confirm your recent change to ${newEmployer}.`,
          unresolved_items: [],
          provenance
        }
      };
    }
  }

  return {
    status: "NEEDS_CLARIFICATION",
    issues: [{
      type: "field_mismatch",
      canonical_field: "employment.employer",
      declared_value: declaredEmployer,
      documented_value: currentSlip.fields.employer ?? "Unknown employer",
      difference: 0,
      status: "NEEDS_CLARIFICATION",
      evidence: {
        document_id: currentSlip.document_id,
        source_label: currentSlip.sources.find((entry) => entry.field === "employer")?.source_label ?? "Salary slip",
        page: currentSlip.sources.find((entry) => entry.field === "employer")?.page ?? 1
      }
    }],
    provenance: [{ type: "document", reference: currentSlip.filename, source_label: currentSlip.sources.find((entry) => entry.field === "employer")?.source_label ?? "Salary slip", page: currentSlip.sources.find((entry) => entry.field === "employer")?.page ?? 1 }],
    reconciliation: {
      reconciliation_id: `recon_${Date.now()}`,
      explanation_type: "RECENT_JOB_CHANGE",
      user_declaration: { field: "employment.employer", value: declaredEmployer, source: "user_input" },
      primary_evidence: currentSlip.fields.employer ? { field: "employment.employer", value: currentSlip.fields.employer, source_label: currentSlip.sources.find((entry) => entry.field === "employer")?.source_label ?? "Current salary slip", page: currentSlip.sources.find((entry) => entry.field === "employer")?.page ?? 1 } : undefined,
      supporting_evidence: employmentDocs.map((document) => ({
        document_id: document.document_id,
        document_type: document.document_type,
        source_label: document.filename,
        page: document.sources[0]?.page,
        field: "new_employer",
        value: document.fields.new_employer ?? document.fields.employer ?? "Unknown"
      })),
      relationships: [{ from: "Application", to: "Supporting employment document", note: "The supporting document does not match the declared employer or current slip." }],
      status: "NEEDS_CLARIFICATION",
      explanation: "Your supporting employment document does not match the current employer and the difference remains unresolved.",
      unresolved_items: ["supporting document does not match the current employer"],
      provenance: [{ type: "document", reference: currentSlip.filename, source_label: currentSlip.sources.find((entry) => entry.field === "employer")?.source_label ?? "Salary slip", page: currentSlip.sources.find((entry) => entry.field === "employer")?.page ?? 1 }]
    }
  };
}

function evaluateMappedField(
  profile: CanonicalProfile,
  config: InstitutionConfig,
  documents: ExtractedDocument[],
  institutionField: string
): ReconciliationOutcome {
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
  const matchingEvidence = evidence.find(({ documentedValue }) => valueMatches(documentedValue, declaredValue));
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
  documents: ExtractedDocument[],
  reconciliationContext?: ReconciliationContext
): VerificationResult {
  const checks: VerificationResult["checks"] = [];
  const issues: VerificationIssue[] = [];
  const provenance: VerificationResult["provenance"] = [];
  const nextActions: string[] = [];

  let reconciliation: Reconciliation | undefined;
  const salaryRevisionResult = evaluateSalaryRevision(profile, documents, reconciliationContext);
  const grossNetResult = evaluateGrossVsNetReconciliation(profile, documents);
  const jobChangeResult = evaluateRecentJobChange(profile, documents);

  const reconciliationCandidates = [
    salaryRevisionResult,
    grossNetResult,
    jobChangeResult
  ].filter((candidate) => candidate.reconciliation !== undefined || candidate.issues.length > 0 || candidate.status !== "PROVIDED");

  const chosenCandidate = reconciliationCandidates.find((candidate) => candidate.status === "VERIFIED" && candidate.reconciliation)
    ?? reconciliationCandidates.find((candidate) => candidate.reconciliation?.status === "NEEDS_CLARIFICATION")
    ?? null;

  if (chosenCandidate) {
    reconciliation = chosenCandidate.reconciliation;
  }

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
    if (reconciliation?.status === "VERIFIED") {
      if (fieldCheckIndex >= 0 && checks[fieldCheckIndex]) {
        checks[fieldCheckIndex] = {
          ...checks[fieldCheckIndex],
          status: "VERIFIED",
          detail: "Reconciled with supporting evidence."
        };
      }
      continue;
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

  const currentSlip = documents.find((document) => document.document_type === "salary_slip");
  const declaredEmployer = profile.employment.employer;
  const slipEmployer = currentSlip?.fields.employer ?? null;
  if (currentSlip && declaredEmployer && slipEmployer && slipEmployer !== declaredEmployer && !documents.some((document) => document.document_type === "offer_letter" || document.document_type === "appointment_letter" || document.document_type === "employment_salary_certificate")) {
    issues.push({
      type: "field_mismatch",
      canonical_field: "employment.employer",
      declared_value: declaredEmployer,
      documented_value: slipEmployer,
      difference: 0,
      status: "NEEDS_CLARIFICATION",
      evidence: {
        document_id: currentSlip.document_id,
        source_label: currentSlip.sources.find((entry) => entry.field === "employer")?.source_label ?? "Salary slip",
        page: currentSlip.sources.find((entry) => entry.field === "employer")?.page ?? 1
      }
    });
    nextActions.push("Review the employer change and provide supporting employment evidence.");
  }

  if (chosenCandidate) {
    reconciliation = chosenCandidate.reconciliation;
    if (reconciliation?.status === "VERIFIED") {
      issues.length = 0;
      provenance.length = 0;
      provenance.push(...chosenCandidate.provenance);
      if (reconciliation) provenance.push(...reconstructionProvenance(reconciliation));
    } else if (chosenCandidate.issues.length > 0) {
      issues.length = 0;
      issues.push(...chosenCandidate.issues);
      provenance.length = 0;
      provenance.push(...chosenCandidate.provenance);
      if (reconciliation) provenance.push(...reconstructionProvenance(reconciliation));
    }
  }

  const overall_state = reconciliation?.status === "VERIFIED"
    ? "VERIFIED"
    : issues.length > 0
      ? "NEEDS_CLARIFICATION"
      : checks.some((check) => check.status === "MISSING")
        ? "MISSING"
        : checks.some((check) => check.status === "PROVIDED")
          ? "PROVIDED"
          : "VERIFIED";

  return {
    checks,
    overall_state,
    issues,
    document_requirements: documentRequirements,
    next_actions: [...new Set(nextActions)],
    provenance,
    reconciliation
  };
}

function reconstructionProvenance(reconciliation: Reconciliation) {
  return reconciliation.provenance.filter((entry) => entry.reference)
    .map((entry) => ({
      type: entry.type,
      reference: entry.reference,
      source_label: entry.source_label,
      page: entry.page
    }));
}