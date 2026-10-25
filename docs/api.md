# API

Base path `/api`. JSON in and out unless noted. Authentication uses an HttpOnly session cookie (`cgi_sid`, 7 days, `SameSite=Lax`, `Secure` in production). State-changing requests also need the CSRF token returned by `POST /auth/login`, `POST /auth/register` and `GET /auth/me`, sent as `X-CSRF-Token`. All endpoints other than `/health`, `/auth/register` and `/auth/login` require a session, and every investigation, message, report and export is scoped to the signed-in owner. Another user's id returns 404.

Errors share one shape:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "…", "details": [] } }
```

Codes: `VALIDATION_ERROR` 400, `BAD_REQUEST` 400/413, `UNAUTHORIZED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `UNSUPPORTED_FILE_TYPE` 415, `PDF_TOO_MANY_PAGES` 413, `UNRESOLVED_FINDING` 422, `RATE_LIMITED` 429, `INTERNAL_ERROR` 500. Limits and rate limits are configurable (see `.env.example`).

## Health

`GET /health` returns `status`, `database`, and AI capability flags. It never returns secrets.

## Auth

| Method and path | Body | Result |
| --- | --- | --- |
| `POST /auth/register` | `name`, `email`, `password` (min length enforced), `role` (`researcher` or `clinician`, self-declared) | `{ user, csrfToken }` and sets the session cookie |
| `POST /auth/login` | `email`, `password` | same. Errors are deliberately generic. |
| `POST /auth/logout` | none | 204 |
| `GET /auth/me` | none | `{ user, csrfToken }` |
| `DELETE /auth/me` | `password` | deletes the account and its investigations and messages |

## Investigations

`POST /investigations`, `GET /investigations?q=&page=&limit=`, `GET /investigations/:id`, `PATCH /investigations/:id` (rename, set context), `DELETE /investigations/:id`, `GET /investigations/:id/messages`.

## Variants

| Endpoint | Purpose |
| --- | --- |
| `POST /variants/normalize` | `{ query, geneSymbol?, referenceGenome?, transcriptId? }`. Returns parsed fields, `normalizationStatus`, `warnings` and `missing`. Fields that cannot be established are `null`. |
| `POST /variants/search` | `{ query, geneSymbol?, cancerType?, referenceGenome?, transcriptId?, investigationId?, includeTrials?, includePublications?, page?, limit? }`. Returns the submitted (normalized) finding, matched findings with category, rationale, matching and differing fields, source records, assessments, publications, trials, per-source status and notices. |
| `GET /variants/:id` | A stored variant owned by the user. |

Match categories: `exact_normalized`, `equivalent_representation`, `same_position_different_allele`, `same_gene_different_variant`, `related_biomarker`, `literature_only`, `unresolved`, plus `gene_level_result` when only a gene was searched. They are not interchangeable.

## Evidence and literature

`POST /evidence/search`, `GET /evidence/:id`, `POST /publications/search` (`query` or `geneSymbol`; optional `variant`, `cancerType`, `limit`), `POST /trials/search` (`geneSymbol` or `cancerType`; optional `variant`, `statuses`, `limit`). Responses include source metadata (`status`, `retrievedAt`, `fromCache`, `limitations`).

## Chat

`POST /chat/message` with `{ investigationId, message, context? }` returns `{ userMessage, assistantMessage, notices }`. The assistant message has `payload.kind` of `results` (summary, results, citation index, safety notice) or `extraction_review` (long pasted reports are routed to the review step first). Long pasted report text is processed but replaced by a placeholder in stored history.

## Reports

| Endpoint | Purpose |
| --- | --- |
| `POST /reports/upload` | multipart, field `file` (PDF only, 10 MB, 40 pages), optional `investigationId`. File type is checked from content. Returns `{ reportId, pageCount, sizeBytes, expiresAt }`. Held in memory for 30 minutes. |
| `POST /reports/:id/extract` | Extracts text and candidate findings; drops the raw file. Returns an `extraction_review` payload. No search is run. |
| `POST /reports/:id/confirm-variants` | `{ investigationId, selections: [{ id, text? }], context? }`. Edited text is re-parsed from scratch. Runs the searches. |
| `POST /reports/export/pdf`, `POST /reports/export/csv` | `{ investigationId }`. Returns the file as a download built from stored investigation results. CSV cells that could be read as formulas are neutralized. |

## Settings

`GET /settings`, `PATCH /settings` (`aiSensitiveContentConsent`). Consent has an effect only when the operator has also enabled it in server configuration.
