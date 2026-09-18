import { Router } from "express";
import multer from "multer";
import { createIntentExtractor } from "../ai/intentExtractor.js";
import { createDocumentExtractor, SyntheticDocumentExtractor } from "../ai/documentExtractor.js";
import { StructuredIssueExplanationGenerator } from "../ai/explanationGenerator.js";
import {
  canonicalProfileSchema,
  extractedDocumentSchema,
  institutionConfigSchema,
  issueSchema,
  verificationInputSchema
} from "../domain/schemas.js";
import { getInstitutionConfig } from "../institutions/configLoader.js";
import { evaluatePreparation } from "../verification/verificationEngine.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const router = Router();

function validationError(message: string) {
  return { success: false, error: { code: "VALIDATION_ERROR", message } };
}

router.post("/intent", async (request, response, next) => {
  try {
    const message = typeof request.body?.message === "string" ? request.body.message.trim() : "";
    if (!message) return response.status(400).json(validationError("message is required."));
    try {
      const result = await createIntentExtractor().extract(message);
      return response.json({ success: true, profile: result.profile, extraction_source: result.source });
    } catch (error) {
      console.error("Intent extraction failed; using deterministic fallback", error);
      const result = await new (await import("../ai/intentExtractor.js")).DemoIntentExtractor().extract(message);
      return response.json({ success: true, profile: result.profile, extraction_source: result.source });
    }
  } catch (error) {
    return next(error);
  }
});

router.post("/documents/extract", upload.single("file"), async (request, response, next) => {
  try {
    const documentType = request.body?.document_type;
    const parsedType = extractedDocumentSchema.shape.document_type.safeParse(documentType);
    if (!request.file) return response.status(400).json(validationError("file is required."));
    if (!parsedType.success) return response.status(400).json(validationError("document_type must be salary_slip or bank_statement."));
    if (!["application/pdf", "image/jpeg", "image/png"].includes(request.file.mimetype)) {
      return response.status(415).json({ success: false, error: { code: "UNSUPPORTED_DOCUMENT", message: "Only PDF, JPG, and PNG files are supported." } });
    }
    try {
      const result = await createDocumentExtractor().extract({ filename: request.file.originalname, documentType: parsedType.data, bytes: request.file.buffer, mimeType: request.file.mimetype });
      return response.json({ success: true, document: result.document, extraction_source: result.source });
    } catch (error) {
      console.error("Document extraction failed; using deterministic fallback", error);
      const result = await new SyntheticDocumentExtractor().extract({ filename: request.file.originalname, documentType: parsedType.data, bytes: request.file.buffer, mimeType: request.file.mimetype });
      return response.json({ success: true, document: result.document, extraction_source: result.source });
    }
  } catch (error) {
    return next(error);
  }
});

router.post("/journey/evaluate", (request, response) => {
  const parsed = verificationInputSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json(validationError("canonical_profile, institution_config, and documents are required and must be valid."));
  return response.json({ success: true, ...evaluatePreparation(parsed.data.canonical_profile, parsed.data.institution_config, parsed.data.documents) });
});

router.post("/explanations", async (request, response) => {
  const parsed = issueSchema.safeParse(request.body?.issue);
  if (!parsed.success) return response.status(400).json(validationError("A detected structured issue is required."));
  return response.json({ success: true, explanation: await new StructuredIssueExplanationGenerator().explain(parsed.data) });
});

router.post("/application/reverify", (request, response) => {
  const parsed = verificationInputSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json(validationError("Updated canonical_profile, institution_config, and documents are required and must be valid."));
  return response.json({ success: true, ...evaluatePreparation(parsed.data.canonical_profile, parsed.data.institution_config, parsed.data.documents) });
});

router.get("/institutions/:institution", (request, response) => {
  try {
    return response.json({ success: true, institution_config: institutionConfigSchema.parse(getInstitutionConfig(request.params.institution)) });
  } catch {
    return response.status(404).json({ success: false, error: { code: "INSTITUTION_CONFIGURATION_ERROR", message: "Unknown institution configuration." } });
  }
});

export { router as apiRouter };