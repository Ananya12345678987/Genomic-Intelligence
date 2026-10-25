# Privacy and safety

## Scope statement

Research support and evidence review. Not a diagnosis, not a treatment recommendation, **not clinically validated**. Clinical interpretation belongs with qualified professionals who have full clinical context. No regulatory or legal compliance (HIPAA, GDPR, medical-device rules) is claimed; none has been assessed.

## Evidence rules the product follows

- Match confidence, evidence strength, clinical relevance and evidence completeness are shown separately. There is no combined confidence percentage and no probability of pathogenicity or treatment benefit.
- Source classifications are shown with their own scope and review status. Germline pathogenicity is not presented as treatment actionability.
- Gene-level matches are labelled "same gene, different variant" and never as variant matches.
- Somatic and germline contexts are kept apart; nothing infers inherited risk from a tumor finding.
- Unavailable sources are reported, never filled in. Disagreement between sources is displayed with dates.
- Trial mentions never imply eligibility.
- Sourced facts, deterministic matching, AI text and unverified input carry different labels in the UI (icon plus word, not colour alone).

## Controls that exist (and are tested unless noted)

- Argon2id password hashing; random server-side sessions in MongoDB; HttpOnly, SameSite cookie; CSRF token on state-changing requests; auth rate limiting; generic login errors
- Per-request ownership checks, with other users' ids returning 404
- Input validation on every endpoint; Mongoose filter sanitization against operator injection
- Security headers, single-origin CORS, global and per-route rate limits, body size limits
- PDF checked by content (not name or MIME), size and page limits, in-memory only, dropped after extraction, 30-minute expiry
- Log redaction of auth headers, cookies, request bodies and secret-named fields
- Markdown rendered without raw HTML; only http(s) links are made clickable
- Retrieved publications, trial text and uploaded documents are treated as data, never as instructions; AI citations are checked against retrieved records and unverifiable statements are removed

## AI and sensitive content

AI is optional (`AI_PROVIDER=none` by default). Report-derived text is **not** sent to an external provider unless the operator sets `AI_ALLOW_SENSITIVE_CONTENT=true` **and** the user turns on consent in the account menu. Plain gene or variant queries typed by the user are handled separately. The redaction applied to report-derived text is best-effort pattern removal and has not been independently validated; do not rely on it for identifiable patient data. This path has not been tested against a live AI provider.

## Not implemented or not assured

No encryption at rest configured by the app, no audit log, no retention automation beyond session expiry and account deletion, no verification of the self-declared user role, in-memory report and cache stores (single instance, lost on restart), no OCR for scanned reports, no malware scanning beyond content-type and structure checks. Do not load identifiable patient data into this prototype.
