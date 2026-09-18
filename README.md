# Paytm Pre-Flight Backend

Backend-only hackathon MVP for preparing a personal-loan application before submission. Pre-Flight uses AI for interpretation and deterministic logic for verification. It does not predict approval, eligibility, rejection, or credit outcomes.

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

This is an in-memory hackathon prototype using synthetic documents only. Uploaded documents are transient and untrusted. No authentication, database, banking integration, document vault, credit scoring, approval prediction, lender recommendation, RAG, or autonomous submission is included.

See [architecture.md](architecture.md) for the component boundaries, data flow, API contracts, security boundary, and recorded architectural decisions.