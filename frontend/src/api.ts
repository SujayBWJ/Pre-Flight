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

export type InstitutionConfig = {
  institution: string;
  product: "personal_loan";
  label: string;
  requiredFields: string[];
  requiredDocuments: ("salary_slip" | "bank_statement")[];
  fieldMappings: Record<string, string>;
  documentFieldMappings: Record<string, string>;
  terminology: Record<string, string>;
  validationRules: string[];
};

export type ExtractedDocument = {
  document_id: string;
  document_type: "salary_slip" | "bank_statement";
  filename: string;
  fields: {
    gross_monthly_income: number | null;
    net_monthly_income: number | null;
    employer: string | null;
  };
  sources: { field: string; value: number; source_label: string; page: number }[];
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
export type VerificationResult = {
  checks: Check[];
  overall_state: Status;
  issues: Issue[];
  document_requirements: { document_type: "salary_slip" | "bank_statement"; label: string; provided: boolean; verification_optional: true; detail: string }[];
  next_actions: string[];
  provenance: { type: "user_input" | "document"; reference: string; source_label?: string; page?: number }[];
};

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

export async function evaluate(profile: CanonicalProfile, institution: InstitutionConfig, documents: ExtractedDocument[]) {
  return request<{ success: true } & VerificationResult>("/api/journey/evaluate", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ canonical_profile: profile, institution_config: institution, documents })
  });
}

export async function extractDocument(file: File, documentType: "salary_slip" | "bank_statement") {
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

export async function reverify(profile: CanonicalProfile, institution: InstitutionConfig, documents: ExtractedDocument[]) {
  return request<{ success: true } & VerificationResult>("/api/application/reverify", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ canonical_profile: profile, institution_config: institution, documents })
  });
}
