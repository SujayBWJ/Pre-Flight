# Paytm Pre-Flight Backend

Backend-only P0 implementation for preparing a personal-loan application before submission. Pre-Flight uses AI for interpretation and deterministic logic for verification. It does not predict approval, eligibility, rejection, or credit outcomes.

## Run

```bash
npm install
copy .env.example .env
npm run dev
```

The health check is available at `GET http://localhost:3000/health`.

## Verify

```bash
npm test
npm run typecheck
npm run build
```

## API reference

- `GET /health`: backend liveness check.
- `POST /api/intent`: `{ "message": "I need 3 lakh for 2 years and earn 60000 per month." }` returns a validated canonical profile and `extraction_source`.
- `GET /api/institutions/:institution`: returns a validated representative configuration for `hdfc_demo`, `sbi_demo`, or `idfc_demo`.
- `POST /api/documents/extract`: multipart fields `file` and `document_type` (`salary_slip` or `bank_statement`). Supports PDF, JPG, and PNG up to 5 MB. Returns structured fields, provenance, and `extraction_source`.
- `POST /api/journey/evaluate`: accepts `canonical_profile`, `institution_config`, and `documents`; returns deterministic `checks`, `overall_state`, `issues`, `provenance`, and `next_actions`.
- `POST /api/explanations`: accepts an already detected structured `issue`; returns a plain-language explanation and cannot change verification state.
- `POST /api/application/reverify`: accepts updated `canonical_profile`, `institution_config`, and `documents`; reruns the deterministic evaluation.

The demo uses a deterministic fallback when `GEMINI_API_KEY` is absent or live intent extraction fails. Responses expose `extraction_source` so fallback data is not presented as live AI output.

## Implemented P0

- Natural-language intent to a validated canonical profile with unknown values as `null`.
- Separate gross and net income semantics.
- Representative HDFC, SBI, and IDFC configuration with shared verification logic.
- No-document preparation path: provided fields are usable immediately; optional document requirements are returned separately and do not block continuation.
- Synthetic PDF/JPG/PNG document extraction with strict schema validation and provenance.
- Deterministic required-field checks, configured semantic comparisons, discrepancies, statuses, next actions, explanations, and re-verification.
- Multiple-document evaluation searches all supplied evidence and accepts a later matching document.
- Explicit fallback source metadata, prompt-injection boundary, structured client errors, and automated PRD scenario coverage.

## P1 and P2 scope

P1 stretch work includes a document viewer/source highlighting, polished UI states, institution comparison, richer contextual explanations, and additional synthetic documents. P2/future work includes persistent storage, accounts, secure document retention, real institution integrations, cross-document reconciliation, and additional products. These are intentionally not part of this backend-only MVP.

All API errors use this shape:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Readable error message"
  }
}
```

## Scope and data policy

This is a stateless hackathon prototype using synthetic documents only. Uploaded documents are transient and untrusted. `validationRules` are currently empty in the representative configs; no descriptive rule strings are treated as executable business logic. No authentication, database, session store, banking integration, document vault, credit scoring, approval prediction, lender recommendation, RAG, or autonomous submission is included.

See [architecture.md](architecture.md) for the component boundaries, data flow, API contracts, security boundary, and recorded architectural decisions.