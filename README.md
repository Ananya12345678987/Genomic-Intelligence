# Cancer Genomic Intelligence (research prototype)

**Live demo:** https://genomic-intelligence.onrender.com

> The demo runs on a free instance, so the first load after idle can take about a minute. It is a research prototype: not clinically validated, and not for patient data.

A chat-first workspace for investigating cancer-associated genetic variants. Enter a gene or variant, paste report text, or upload a text-based PDF; the app finds exact and related records in ClinVar and CIViC, retrieves PubMed publications and ClinicalTrials.gov trials, and shows everything in expandable evidence cards with source links. Structured retrieval and deterministic matching come first; an optional AI layer only summarizes what was retrieved, and its citations are checked against those records.

> **Scope.** Research support and evidence review only. It does not diagnose cancer, recommend treatment, or replace qualified clinical interpretation. It is **not clinically validated, not a medical device, and not ready for patient care.** No compliance with HIPAA, GDPR or any other framework is claimed or has been assessed.

## What is built

| Area | State |
| --- | --- |
| Auth: register, login, logout, delete account; Argon2id; HttpOnly session cookie; CSRF token; rate limits | Built, tested |
| Investigations: create, list/search, rename, delete, all scoped to the owner | Built, tested |
| Variant normalization (HGVS p./c./g., rsID, coordinates) that records what is **unresolved** rather than guessing | Built, tested |
| Matching engine with separate categories (exact, equivalent, same position/different allele, same gene, related, literature-only, unresolved) | Built, tested |
| Four separate assessments per match (match confidence, evidence strength, clinical relevance, completeness); no combined score | Built, tested |
| Adapters: ClinVar, CIViC, PubMed, ClinicalTrials.gov, with timeouts, retries with backoff, client-side spacing, public-only TTL cache | Built, tested **against fixtures only** |
| Chat: follow-up questions, context carried between turns, AI optional, citation verification | Built, tested with fake sources |
| PDF upload (type checked by content, size and page limits), text extraction, extraction review with edit/select/confirm | Built, tested |
| PDF and CSV export from stored investigation data (CSV is formula-injection safe) | Built, tested |
| React UI: pistachio design system, empty state, evidence cards, publications, trials, review step, export dialog, mobile drawer | Built; UI smoke-tested with a **mocked API** |

## What has NOT been verified

Read this before trusting any output.

1. **No live source call has ever succeeded from the build environment.** It could not reach NCBI, CIViC or ClinicalTrials.gov. Each adapter's header comment lists which response paths were never checked against a live response. Parsing is defensive and reports `unexpected_response` instead of guessing, but the first real run may need adjustments. See [docs/data-sources.md](docs/data-sources.md).
2. **MongoDB-backed tests were skipped** in the build environment (no MongoDB available). 24 tests, including auth/ownership integration, run only when a database is reachable. Run them yourself (see Tests).
3. **The UI was checked with mocked API responses**, not a running backend and database together. No true end-to-end run (browser to Express to MongoDB to live sources) has been performed.
4. **AI summarization was not tested against a live provider.** Without a configured provider the app says so and shows a deterministic summary instead.
5. **Scanned PDFs are not supported.** There is no OCR; image-only PDFs yield no findings and the UI says so.
6. The matching rules, extraction patterns and gene list have **not been validated against a reference dataset** by a bioinformatician.
7. `npm audit` reports 5 moderate advisories (Tailwind 3 build-time CSS parsing, React Router 6 open-redirect). Both fixes are major upgrades (Tailwind 4, React Router 7) that were not applied to avoid breaking the verified UI. This app only navigates to internal paths and server-issued ids, but upgrade before any real deployment.

## Requirements

Node.js 20+ (built on 22), npm 10+, MongoDB 7 (Docker Compose file included), internet access to the four public sources.

## Setup

```bash
npm install
cp .env.example server/.env        # set SESSION_SECRET: openssl rand -hex 32
docker compose up -d               # local MongoDB on 127.0.0.1:27017
npm run dev                        # server :4000, client :5173
```

Open http://localhost:5173 and register an account. The Vite dev server proxies `/api` to Express.

## Configuration

Everything is documented in [`.env.example`](.env.example). Required: `MONGODB_URI`, `SESSION_SECRET` (32+ chars). The server validates the environment at startup and names a bad variable without printing its value.

| Variable | Notes |
| --- | --- |
| `AI_PROVIDER` / `AI_API_KEY` / `AI_MODEL` | `none` (default) or `anthropic`. Keys stay server-side. |
| `AI_ALLOW_SENSITIVE_CONTENT` | Default `false`. Report-derived text reaches an AI provider only if this is `true` **and** the user has opted in. |
| `NCBI_API_KEY`, `NCBI_EMAIL`, `NCBI_TOOL` | Optional; raise the NCBI rate limit and identify the app. |
| `CACHE_TTL_*_SECONDS`, `*_TIMEOUT_MS`, `EXTERNAL_MAX_RETRIES` | Per-source cache lifetimes, timeouts, retry policy. |

Only `VITE_`-prefixed variables reach the browser; none hold secrets.

## Database

No manual step. Mongoose creates collections and indexes on first use. Reset local data with `docker compose down -v`.

## Tests

```bash
npm test                      # server: Vitest + Supertest
npm run typecheck             # server and client
MONGODB_URI_TEST=mongodb://127.0.0.1:27017/cgi-test npm test   # also runs the DB-backed tests

npm run build -w client && node client/ui-smoke/smoke.cjs ./shots   # UI smoke test, MOCKED API
```

Results from the last run in the build environment (no MongoDB, no internet to sources): **116 passed, 24 skipped** (skipped = need MongoDB). UI smoke test: all assertions passed (mocked API). Re-run in your environment and treat that as the real result.

## Production build and deployment

Deploying to a host such as Render: see [docs/deployment.md](docs/deployment.md). Serve the website and API from **one** address, otherwise login cookies are not kept and every request returns 401.


```bash
npm run build                 # server/dist and client/dist
NODE_ENV=production npm start
```

Serve `client/dist` from a static host or reverse proxy and terminate HTTPS there. In production, cookies are `Secure` and one proxy hop is trusted.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Invalid environment configuration` | Fix the variable named in the message. |
| Health `degraded` | MongoDB unreachable: `docker compose up -d`, check `MONGODB_URI`. |
| A source shows "Unavailable" or "Unexpected response" | The source was down, rate-limited, or its response differed from what the adapter expects. The app does not substitute data. Check server logs. |
| Login works but actions return 403 | CSRF token missing; reload the page. |
| Upload says the file is not a PDF | Checked by file content, not name or MIME type. |

## Security and privacy limitations

- Uploaded PDFs are held **in server memory** for up to 30 minutes and dropped after extraction; the PDF and its text are not written to the database. Pasted long report text is processed but not saved in conversation history.
- The report store and source cache are **in-memory, single-instance**. They do not survive a restart and are not shared across servers.
- No encryption at rest is configured by this app; no audit log; no retention automation beyond session expiry (7 days) and account deletion.
- User role (researcher/clinician) is self-declared and unverified; it does not grant any additional access.
- Logs redact auth headers, cookies, request bodies and known secret fields.

See [docs/privacy-and-safety.md](docs/privacy-and-safety.md).

## Before any clinical or institutional deployment

1. Validate normalization, matching and extraction against reference datasets with domain experts.
2. Regulatory review for your jurisdiction (software-as-a-medical-device status, if applicable).
3. Privacy and security assessment: consent, data-processing agreements, retention, audit logging, encryption, access review, penetration test.
4. Licence review for every data source, including institutional-use terms; add any restricted source (OncoKB, COSMIC) only under its licence.
5. A governance decision on external AI providers and identifiable data.
6. Operations: persistent shared stores, backups, monitoring, incident response, dependency patching.

## Documentation

[deployment](docs/deployment.md) · [architecture](docs/architecture.md) · [data sources](docs/data-sources.md) · [API](docs/api.md) · [privacy and safety](docs/privacy-and-safety.md)
