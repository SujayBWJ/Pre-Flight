export type Status = "VERIFIED" | "PROVIDED" | "MISSING" | "NEEDS_CLARIFICATION";

export type CanonicalProfile = {
  product: "personal_loan";
  loan_amount: number | null;
  tenure_months: number | null;
  income: { gross_monthly: number | null; net_monthly: number | null };
  employment: { type: "salaried" | "self_employed" | "other" | null; employer: string | null };
  existing_emi: number | null;
  purpose: string | null;
};

export type SupportingDocumentType =
  | "salary_slip"
  | "bank_statement"
  | "salary_revision_letter"
  | "hr_salary_certificate"
  | "offer_letter"
  | "appointment_letter"
  | "employment_salary_certificate";

export type InstitutionConfig = {
  institution: string;
  product: "personal_loan";
  label: string;
  requiredFields: string[];
  requiredDocuments: SupportingDocumentType[];
  fieldMappings: Record<string, string>;
  documentFieldMappings: Record<string, string>;
  terminology: Record<string, string>;
  validationRules: string[];
};

export type ExtractedDocument = {
  document_id: string;
  document_type: SupportingDocumentType;
  filename: string;
  fields: {
    gross_monthly_income?: number | null;
    net_monthly_income?: number | null;
    employer?: string | null;
    previous_salary?: number | null;
    revised_salary?: number | null;
    effective_date?: string | null;
    previous_employer?: string | null;
    new_employer?: string | null;
    joining_date?: string | null;
    compensation?: number | null;
    salary_credit?: number | null;
  };
  sources: { field: string; value: number | string; source_label: string; page: number }[];
};

export type Check = { id: string; label: string; status: Status; detail: string };
export type Issue = {
  type: "income_mismatch" | "field_mismatch";
  canonical_field: string;
  declared_value: number | string;
  documented_value: number | string;
  difference: number;
  status: "NEEDS_CLARIFICATION";
  evidence: { document_id: string; source_label: string; page: number };
};
export type Reconciliation = {
  explanation_type: "SALARY_REVISION" | "GROSS_NET_DIFFERENCE" | "RECENT_JOB_CHANGE";
  user_declaration: { field: string; value: number | string; source: "user_input" };
  primary_evidence?: { field: string; value: number | string; source_label: string; page?: number };
  supporting_evidence: { document_id: string; document_type: SupportingDocumentType; source_label: string; page?: number; field: string; value: number | string }[];
  relationships: { from: string; to: string; note: string }[];
  status: Status;
  explanation: string;
  unresolved_items: string[];
  provenance: { type: "user_input" | "document"; reference: string; source_label?: string; page?: number }[];
};
export type VerificationResult = {
  checks: Check[];
  overall_state: Status;
  issues: Issue[];
  document_requirements: { document_type: "salary_slip" | "bank_statement"; label: string; provided: boolean; verification_optional: true; detail: string }[];
  next_actions: string[];
  provenance: { type: "user_input" | "document"; reference: string; source_label?: string; page?: number }[];
  reconciliation?: Reconciliation;
};
export type ReconciliationContext = { explanation_type: "SALARY_REVISION" | "GROSS_NET_DIFFERENCE" | "RECENT_JOB_CHANGE"; previous_salary_confirmed?: boolean };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const payload = await response.json() as T & { success?: boolean; error?: { message?: string } };
  if (!response.ok || payload.success === false) throw new Error(payload.error?.message ?? "Something went wrong. Please try again.");
  return payload;
}

export async function extractIntent(message: string) {
  return request<{ success: true; profile: CanonicalProfile; extraction_source: string }>("/api/intent", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message })
  });
}

export async function getInstitution() {
  const response = await request<{ success: true; institution_config: InstitutionConfig }>("/api/institutions/hdfc_demo");
  return response.institution_config;
}

export async function getInstitutions() {
  const response = await request<{ success: true; institutions: InstitutionConfig[] }>("/api/institutions");
  return response.institutions;
}

export async function evaluate(profile: CanonicalProfile, institution: InstitutionConfig, documents: ExtractedDocument[], reconciliationContext?: ReconciliationContext) {
  return request<{ success: true } & VerificationResult>("/api/journey/evaluate", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ canonical_profile: profile, institution_config: institution, documents, reconciliation_context: reconciliationContext })
  });
}

export async function extractDocument(file: File, documentType: SupportingDocumentType) {
  const body = new FormData();
  body.append("file", file);
  body.append("document_type", documentType);
  return request<{ success: true; document: ExtractedDocument; extraction_source: string }>("/api/documents/extract", { method: "POST", body });
}

export async function explainIssue(issue: Issue) {
  return request<{ success: true; explanation: string }>("/api/explanations", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ issue })
  });
}

export async function reverify(profile: CanonicalProfile, institution: InstitutionConfig, documents: ExtractedDocument[], reconciliationContext?: ReconciliationContext) {
  return request<{ success: true } & VerificationResult>("/api/application/reverify", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ canonical_profile: profile, institution_config: institution, documents, reconciliation_context: reconciliationContext })
  });
}
