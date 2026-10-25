# Architecture

npm workspaces monorepo: `client` (React, Vite, TypeScript, Tailwind, TanStack Query, React Router) and `server` (Express, TypeScript, Mongoose, Zod).

## Principle

Structured retrieval and deterministic matching come first. The AI layer explains retrieved records only. Its output is checked against what was actually fetched, and unverifiable statements are removed.

## Request flow (variant search)

1. Validate input (Zod) and ownership.
2. `variant-normalization` parses the input and records what is unresolved. Nothing is inferred (no assumed genome, transcript or allele).
3. `adapters/*` query ClinVar, CIViC, PubMed and ClinicalTrials.gov through a shared HTTP client (timeout, retry with backoff, spacing) and a public-only cache. Each returns a `SourceResult` with a status.
4. `matching` classifies each record into a category with rationale, matching and differing fields, and builds the four separate assessments.
5. `evidence` indexes records so every citation id maps to a real retrieved record.
6. `ai` produces a summary: a model if configured and permitted, otherwise a deterministic summary. `verify` strips statements whose citations do not resolve. The response says which path was used.
7. `persistence` stores structured records (best-effort; failure is reported, results are still returned).
8. `exports` builds PDF and CSV from the stored results.

## Server layout

`config/` env validation, logger, DB · `routes/`, `controllers/` HTTP layer · `middleware/` auth, CSRF, security, errors · `validators/` request schemas · `models/` Mongoose models (User, Session, Investigation, Variant, EvidenceRecord, MatchResult, Publication, ClinicalTrial, ConversationMessage, UserSettings) · `adapters/` one per source plus shared HTTP and cache · `services/` normalization, matching, evidence, chat, ai, reports, persistence, exports, auth.

`createApp(env, deps)` takes configuration and dependencies as parameters, so tests substitute fake sources and models.

## Client layout

`components/{layout,chat,evidence,variants}`, `pages/` (workspace, auth), `hooks/`, `services/api.ts` (all network calls, CSRF token held in memory only), `types/`. Design tokens are in `tailwind.config.ts`. The brand name placeholder is a single constant in `components/layout/BrandMark.tsx`.

## Known architectural limits

In-memory report store and source cache (single instance); no job queue or streaming (a normal JSON response per message, which can take several seconds when sources are slow); PDF text extraction only, no OCR.
