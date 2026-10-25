# Data sources

**Verification status.** Every adapter below is implemented and tested against **synthetic fixtures** (`server/tests/fixtures/sources.ts`). **None has been run against its live service**, because the build environment could not reach these hosts. Field and endpoint details come from public documentation and, for CIViC, its published GraphQL schema. Before relying on any source, run it once from a networked machine and compare real responses with what each adapter expects (the header comment of each adapter file lists the unchecked assumptions).

## Summary

| Source | Interface used | Key / registration | Licence and terms (confirm yourself) |
| --- | --- | --- | --- |
| ClinVar | NCBI E-utilities `esearch` + `esummary` (JSON) | No key needed. `NCBI_API_KEY` is optional and raises the limit (about 3 to 10 requests/second). Sending `tool` and `email` is requested by NCBI. | NCBI data is public; review NCBI's usage policy and ClinVar's disclaimer. |
| PubMed | NCBI E-utilities `esearch` + `efetch` (XML) | Same as above | Titles, metadata and abstracts only. Abstracts may be copyrighted by publishers; the app links to PubMed and does not reproduce full texts. |
| CIViC | GraphQL API v2, `https://civicdb.org/api/graphql` | Anonymous access, rate-limited (documented about 3 requests/second). API key optional. | CIViC content is CC0; CIViC states it is for research use. |
| ClinicalTrials.gov | API v2, `https://clinicaltrials.gov/api/v2/studies` | None | Public registry data. Status changes often. |
| OncoKB, COSMIC, My Cancer Genome | **Not implemented** | Registration and/or a licence is required for many uses | Add only under an appropriate licence. The adapter interface (`server/src/adapters/types.ts`) is designed for this. Nothing is scraped. |

## Behaviour common to all adapters

- **Timeout** per request; **bounded retries** with exponential backoff and jitter, honouring `Retry-After`; **client-side spacing** between requests to stay within published limits.
- Non-retryable 4xx responses are not retried.
- Result status is one of `ok`, `no_results`, `unavailable`, `rate_limited`, `unexpected_response`, `skipped`. The UI shows it for every source in every search, so "no records" is never confused with "source down".
- **A failing source never produces substitute data.** Other sources still return results; the unavailable one is named in the response, the UI, and the exports.
- **Cache:** in-memory TTL cache for public responses only. Keys come from public query parameters (gene, variant, cancer type), never report text. Each result carries `retrievedAt`, `fromCache` and `cacheExpiresAt`. The cache is per process and is cleared on restart.
- Every record keeps source name, record id, canonical URL, retrieval time, source update date when provided, the source's own classification fields, and stated limitations.

## Source-specific notes

**ClinVar.** Classifications are shown by scope (germline pathogenicity, somatic clinical impact, oncogenicity) with the source's review status and evaluation date. A germline-pathogenicity label is never presented as treatment actionability. Not every record is expert-reviewed; the review status is displayed.

**CIViC.** Evidence items are shown with level, type, direction, significance, disease, variant origin and PubMed ids, kept distinct from the variant record. Therapy associations describe study findings, not recommendations.

**PubMed.** Only abstracts are retrieved; the UI states that the full article was not reviewed. Titles, authors and PMIDs come from the record; nothing is generated.

**ClinicalTrials.gov.** Defaults to open or running statuses. Status is displayed exactly as the registry reports it, with its last-update date. The UI states that a shared gene or cancer type does not establish eligibility.

## If a service is unavailable

The search still completes with the other sources. The affected source is marked "Unavailable" or "Rate limited" with a message; results from it are absent, not estimated. Retry later; cached copies are labelled as such with their expiry.
