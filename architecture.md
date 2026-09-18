# Paytm Pre-Flight Architecture

## 1. Architecture Overview

Pre-Flight is a preparation-state linter for a personal-loan application. The backend will normalize user intent into an institution-independent canonical profile, resolve representative institution requirements, compare structured evidence with deterministic code, and expose explanations and next actions. It will never make approval, rejection, eligibility, credit-scoring, or lender-recommendation decisions.

The repository is backend-only at this stage. The MVP uses temporary in-memory state and synthetic documents; it does not require a persistent database or document vault.

## 2. Architecture Diagram

```mermaid
flowchart TD
  Client[Client] --> API[Express Backend API]
  API --> AI[AI interpretation and document extraction]
  AI --> Schema[Zod schema validation]
  Schema --> Profile[Canonical profile]
  Profile --> Config[Institution configuration]
  Config --> Verify[Deterministic verification]
  Verify --> Explain[Explanation generator]
  Verify --> Action[Deterministic next actions]
  Explain --> Client
  Action --> Client
  Client --> Evidence[Correction or new evidence]
  Evidence --> Verify
```

## 3. Component Responsibilities

- `src/app.ts`: Express application factory, JSON parsing, health check, and stable 404/error responses.
- `src/server.ts`: Environment loading and process startup only.
- `src/domain`: Canonical profile, semantic field, status, document, issue, and application schemas.
- `src/institutions`: Validated representative configurations and canonical-to-institution mappings.
- `src/verification`: Completeness, semantic comparison, discrepancy calculation, status transitions, and next actions.
- `src/ai`: Small interfaces plus Gemini and deterministic demo implementations. AI output is never trusted before schema validation.
- `src/api`: Thin HTTP adapters. Business rules stay in services and domain modules.

## 4. AI vs Deterministic Responsibility

| Responsibility | AI | Deterministic |
| --- | --- | --- |
| Natural-language interpretation | Yes | No |
| Document fact extraction | Yes | No |
| Schema validation | No | Yes |
| Canonical normalization | No | Yes |
| Institution requirements and mappings | No | Yes |
| Completeness and comparisons | No | Yes |
| Status transitions | No | Yes |
| Issue explanation | Yes, from structured facts | No |
| Next procedural action | No | Yes |

## 5. Data Flow

`POST /api/intent` interprets a message, validates the result, and returns a canonical profile plus `extraction_source`. Journey evaluation resolves a selected representative institution configuration and runs deterministic checks. Optional document extraction validates only relevant structured fields and provenance before verification consumes them; uploaded bytes are ignored by the synthetic fallback and cannot act as instructions. Explanations accept an already-detected issue, and re-verification runs the same deterministic engine with updated profile/evidence.

## 6. Canonical Data Model

The canonical MVP profile contains `product`, `loan_amount`, `tenure_months`, separate `income.gross_monthly` and `income.net_monthly`, `employment.type`, `employment.employer`, `existing_emi`, and `purpose`. Unknown values are `null`; the extractor must not invent them.

## 7. Field Semantics

Gross and net income are distinct semantic fields. The system compares only the field selected by institution configuration, never gross income against net income merely because both are called income.

## 8. Institution Configuration

HDFC, SBI, and IDFC FIRST are representative demo configurations, not live integrations. Their requirements, terminology, and canonical field mappings live in configuration files so the verification engine remains reusable.

## 9. Verification Engine

The engine separately checks required fields/documents and compares compatible declared/evidence values. User input starts as `PROVIDED`; absence of evidence is not a discrepancy. Matching evidence becomes `VERIFIED`, while a genuine semantic conflict becomes `NEEDS_CLARIFICATION` with a deterministic difference and provenance.

## 10. Status Model

- `VERIFIED`: available evidence supports the relevant information.
- `PROVIDED`: user supplied the information, but it is not verified.
- `MISSING`: required information or evidence is absent.
- `NEEDS_CLARIFICATION`: information conflicts or needs user review.

## 11. Provenance

Extracted values retain document identity, source label, and page where available. The MVP prefers evidence references over arbitrary AI confidence scores.

## 12. AI Provider Boundary

The application depends on small `IntentExtractor`, `DocumentExtractor`, and `ExplanationGenerator` interfaces. Gemini implementations are optional adapters; deterministic demo fallbacks support known synthetic inputs when live AI is unavailable.

## 13. Fallback Strategy

Fallback results are explicitly marked as deterministic demo fallback internally and are never represented as live AI output. Live Gemini use requires `GEMINI_API_KEY`; tests and demo fixtures do not require an API key.

## 14. Security Boundary

Uploaded documents are untrusted data. Document text cannot alter status, mappings, permissions, or business rules. Only validated structured extraction output may reach deterministic verification. Uploads are transient and synthetic-only for this MVP.

## 15. State Management

No persistent database is used. Current-session application state may be held in temporary server memory. This keeps the hackathon implementation small while making the production boundary explicit.

## 16. API Contracts

- `GET /health`: returns `{ success: true, status: "ok" }`.
- `POST /api/intent`: message to validated canonical profile, with extraction source metadata. Uses Gemini when configured and deterministic demo fallback otherwise.
- `POST /api/documents/extract`: synthetic PDF/JPG/PNG plus document type to validated structured fields and provenance.
- `POST /api/journey/evaluate`: profile, institution configuration, and documents to checks, preparation state, issues, provenance, and next actions.
- `POST /api/explanations`: structured issue to plain-language explanation; it cannot create or change an issue.
- `POST /api/application/reverify`: updated profile/evidence to a fresh deterministic evaluation.

All errors use `{ success: false, error: { code, message } }` and do not expose stack traces.

## 17. Testing Strategy

Vitest will cover schemas, institution resolution, each verification rule, fallback behavior, prompt-injection resistance, and API integration flows. The first foundation test covers health and stable unknown-route errors.

## 18. Architectural Decisions / ADR-style Log

### Decision: Express with TypeScript

Context: The MVP needs a small Node.js HTTP API in an approximately eight-hour build.

Decision: Use Express and strict TypeScript.

Alternatives considered: Next.js API routes or a larger server framework.

Why this choice: Express makes the API boundary explicit and keeps backend concerns independent from the future frontend.

Trade-offs: We own a little more routing and validation plumbing than with a batteries-included framework.

Consequences: Route handlers must remain thin and delegate business behavior to domain/services.

### Decision: Zod at every trust boundary

Context: Requests, uploaded metadata, and model output are untrusted.

Decision: Validate API payloads, AI output, documents, configurations, and verification results with Zod.

Alternatives considered: TypeScript types alone or JSON Schema tooling.

Why this choice: TypeScript types disappear at runtime; Zod provides one readable runtime/schema boundary.

Trade-offs: Schemas require maintenance alongside domain types.

Consequences: No unvalidated AI or document-derived value may enter verification.

### Decision: No persistent database in the MVP

Context: The PRD requires temporary state and synthetic, transient document processing.

Decision: Use in-memory application/session state.

Alternatives considered: PostgreSQL, object storage, or a document vault.

Why this choice: It preserves the requested scope and avoids implying production financial-data handling.

Trade-offs: State is lost on restart and cannot support accounts or history.

Consequences: Persistence, retention, and production security remain explicit future work.

### Decision: Deterministic verification

Context: Preparation status and discrepancies are critical product behavior.

Decision: AI interprets; deterministic code maps, compares, transitions status, and creates next actions.

Alternatives considered: Asking an LLM whether a discrepancy is acceptable.

Why this choice: Deterministic rules are testable, explainable, and prevent probabilistic lending judgments.

Trade-offs: Institution rules must be modeled explicitly in configuration.

Consequences: The same engine can support multiple representative institutions without duplicating verification logic.