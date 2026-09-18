import { z } from "zod";

export const preparationStatusSchema = z.enum([
  "VERIFIED",
  "PROVIDED",
  "MISSING",
  "NEEDS_CLARIFICATION"
]);
export type PreparationStatus = z.infer<typeof preparationStatusSchema>;

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

export const extractedDocumentSchema = z.object({
  document_id: z.string().min(1),
  document_type: z.enum(["salary_slip", "bank_statement"]),
  filename: z.string().min(1),
  fields: z.object({
    gross_monthly_income: z.number().nonnegative().nullable(),
    net_monthly_income: z.number().nonnegative().nullable(),
    employer: z.string().min(1).nullable()
  }),
  sources: z.array(z.object({
    field: z.string().min(1),
    value: z.number().nonnegative(),
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
  requiredDocuments: z.array(z.enum(["salary_slip", "bank_statement"])),
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
  document_type: z.enum(["salary_slip", "bank_statement"]),
  label: z.string(),
  provided: z.boolean(),
  verification_optional: z.literal(true),
  detail: z.string()
});

export const issueSchema = z.object({
  type: z.enum(["income_mismatch", "field_mismatch"]),
  canonical_field: z.string(),
  declared_value: z.number(),
  documented_value: z.number(),
  difference: z.number().nonnegative(),
  status: z.literal("NEEDS_CLARIFICATION"),
  evidence: z.object({
    document_id: z.string(),
    source_label: z.string(),
    page: z.number().int().positive()
  })
});
export type VerificationIssue = z.infer<typeof issueSchema>;

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
  provenance: z.array(provenanceSchema)
});
export type VerificationResult = z.infer<typeof verificationResultSchema>;