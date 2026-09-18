import { z } from "zod";

export const preparationStatusSchema = z.enum([
  "VERIFIED",
  "PROVIDED",
  "MISSING",
  "NEEDS_CLARIFICATION"
]);
export type PreparationStatus = z.infer<typeof preparationStatusSchema>;

export const reconciliationExplanationTypeSchema = z.enum([
  "SALARY_REVISION",
  "GROSS_NET_DIFFERENCE",
  "RECENT_JOB_CHANGE"
]);
export type ReconciliationExplanationType = z.infer<typeof reconciliationExplanationTypeSchema>;

export const canonicalProfileSchema = z.object({
  product: z.literal("personal_loan"),
  loan_amount: z.number().nonnegative().nullable(),
  tenure_months: z.number().int().positive().nullable(),
  income: z.object({
    gross_monthly: z.number().nonnegative().nullable(),
    net_monthly: z.number().nonnegative().nullable()
  }),
  employment: z.object({
    type: z.enum(["salaried", "self_employed", "other"]).nullable(),
    employer: z.string().min(1).nullable()
  }),
  existing_emi: z.number().nonnegative().nullable(),
  purpose: z.string().min(1).nullable()
});
export type CanonicalProfile = z.infer<typeof canonicalProfileSchema>;

export const provenanceSchema = z.object({
  type: z.enum(["user_input", "document"]),
  reference: z.string().min(1),
  source_label: z.string().min(1).optional(),
  page: z.number().int().positive().optional()
});
export type Provenance = z.infer<typeof provenanceSchema>;

export const supportingDocumentTypeSchema = z.enum([
  "salary_slip",
  "bank_statement",
  "salary_revision_letter",
  "hr_salary_certificate",
  "offer_letter",
  "appointment_letter",
  "employment_salary_certificate"
]);
export type SupportingDocumentType = z.infer<typeof supportingDocumentTypeSchema>;

export const extractedDocumentFieldsSchema = z.object({
  gross_monthly_income: z.number().nonnegative().nullable().optional(),
  net_monthly_income: z.number().nonnegative().nullable().optional(),
  salary_credit: z.number().nonnegative().nullable().optional(),
  employer: z.string().min(1).nullable().optional(),
  previous_salary: z.number().nonnegative().nullable().optional(),
  revised_salary: z.number().nonnegative().nullable().optional(),
  effective_date: z.string().min(1).nullable().optional(),
  previous_employer: z.string().min(1).nullable().optional(),
  new_employer: z.string().min(1).nullable().optional(),
  joining_date: z.string().min(1).nullable().optional(),
  compensation: z.number().nonnegative().nullable().optional()
}).passthrough();

export const extractedDocumentSchema = z.object({
  document_id: z.string().min(1),
  document_type: supportingDocumentTypeSchema,
  filename: z.string().min(1),
  fields: extractedDocumentFieldsSchema,
  sources: z.array(z.object({
    field: z.string().min(1),
    value: z.union([z.number().nonnegative(), z.string().min(1)]),
    source_label: z.string().min(1),
    page: z.number().int().positive()
  }))
});
export type ExtractedDocument = z.infer<typeof extractedDocumentSchema>;

export const institutionConfigSchema = z.object({
  institution: z.string().min(1),
  product: z.literal("personal_loan"),
  label: z.string().min(1),
  requiredFields: z.array(z.string().min(1)),
  requiredDocuments: z.array(supportingDocumentTypeSchema),
  fieldMappings: z.record(z.string().min(1)),
  documentFieldMappings: z.record(z.string().min(1)),
  terminology: z.record(z.string().min(1)),
  validationRules: z.array(z.string())
});
export type InstitutionConfig = z.infer<typeof institutionConfigSchema>;

export const verificationInputSchema = z.object({
  canonical_profile: canonicalProfileSchema,
  institution_config: institutionConfigSchema,
  documents: z.array(extractedDocumentSchema)
});

export const documentRequirementSchema = z.object({
  document_type: supportingDocumentTypeSchema,
  label: z.string(),
  provided: z.boolean(),
  verification_optional: z.literal(true),
  detail: z.string()
});

export const issueSchema = z.object({
  type: z.enum(["income_mismatch", "field_mismatch"]),
  canonical_field: z.string(),
  declared_value: z.union([z.number(), z.string()]),
  documented_value: z.union([z.number(), z.string()]),
  difference: z.number().nonnegative(),
  status: z.literal("NEEDS_CLARIFICATION"),
  evidence: z.object({
    document_id: z.string(),
    source_label: z.string(),
    page: z.number().int().positive()
  })
});
export type VerificationIssue = z.infer<typeof issueSchema>;

export const reconciliationSchema = z.object({
  reconciliation_id: z.string().min(1),
  discrepancy_type: z.enum(["income_mismatch", "field_mismatch"]).optional(),
  explanation_type: reconciliationExplanationTypeSchema,
  user_declaration: z.object({
    field: z.string().min(1),
    value: z.union([z.number(), z.string()]),
    source: z.literal("user_input")
  }),
  primary_evidence: z.object({
    field: z.string().min(1),
    value: z.union([z.number(), z.string()]),
    source_label: z.string().min(1),
    page: z.number().int().positive().optional()
  }).optional(),
  supporting_evidence: z.array(z.object({
    document_id: z.string().min(1),
    document_type: supportingDocumentTypeSchema,
    source_label: z.string().min(1),
    page: z.number().int().positive().optional(),
    field: z.string().min(1),
    value: z.union([z.number(), z.string()])
  })),
  relationships: z.array(z.object({
    from: z.string().min(1),
    to: z.string().min(1),
    note: z.string().min(1)
  })),
  status: preparationStatusSchema,
  explanation: z.string().min(1),
  unresolved_items: z.array(z.string()),
  provenance: z.array(provenanceSchema)
});
export type Reconciliation = z.infer<typeof reconciliationSchema>;

export const verificationResultSchema = z.object({
  checks: z.array(z.object({
    id: z.string(),
    label: z.string(),
    status: preparationStatusSchema,
    detail: z.string()
  })),
  overall_state: preparationStatusSchema,
  issues: z.array(issueSchema),
  document_requirements: z.array(documentRequirementSchema),
  next_actions: z.array(z.string()),
  provenance: z.array(provenanceSchema),
  reconciliation: reconciliationSchema.optional()
});
export type VerificationResult = z.infer<typeof verificationResultSchema>;