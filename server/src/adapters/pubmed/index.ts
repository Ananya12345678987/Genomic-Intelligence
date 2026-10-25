import { XMLParser } from 'fast-xml-parser';
import type { PubMedAdapter, SourceResult } from '../types.js';
import type { ParsedVariant, PublicationRecord, SearchContext } from '../../types/domain.js';
import { HttpClient, SourceError } from '../shared/http.js';
import { TtlCache } from '../shared/cache.js';
import { runSource } from '../shared/run.js';
import { ncbiParams, type NcbiIdentity } from '../clinvar/index.js';
import { toOneLetter } from '../../services/variant-normalization/aminoAcids.js';

/**
 * PubMed via NCBI E-utilities (esearch JSON, efetch XML).
 * Docs: https://www.ncbi.nlm.nih.gov/books/NBK25497/
 * Only titles, metadata and abstracts are retrieved. Full articles are NOT reviewed.
 */

const BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);

/** Flatten an XML node that may be a string, number, or an object with inline markup. */
export function nodeText(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(nodeText).join(' ');
  const o = obj(v);
  const parts: string[] = [];
  for (const [k, val] of Object.entries(o)) {
    if (k.startsWith('@_')) continue;
    parts.push(nodeText(val));
  }
  return parts.join('').replace(/\s+/g, ' ').trim();
}

export function buildPubMedTerm(v: ParsedVariant, ctx: SearchContext): string | null {
  if (!v.geneSymbol) return null;
  const parts = [`${v.geneSymbol}[tiab]`];
  const p = v.protein;
  if (p?.kind === 'substitution' && p.ref && p.alt && p.position !== null) {
    const one = `${toOneLetter(p.ref) ?? ''}${p.position}${p.alt === 'Ter' ? '*' : (toOneLetter(p.alt) ?? '')}`;
    parts.push(`(${one}[tiab] OR "${p.ref}${p.position}${p.alt}"[tiab] OR "p.${p.ref}${p.position}${p.alt}"[tiab])`);
  } else if (v.hgvsCoding) {
    parts.push(`"${v.hgvsCoding}"[tiab]`);
  }
  if (ctx.cancerType) parts.push(`${JSON.stringify(ctx.cancerType.replace(/["\\]/g, ''))}[tiab]`);
  else parts.push('(cancer[tiab] OR neoplasm*[tiab] OR tumor[tiab] OR tumour[tiab])');
  return parts.join(' AND ');
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  isArray: (name) => ['PubmedArticle', 'Author', 'AbstractText', 'ArticleId', 'ELocationID'].includes(name),
});

export function parsePubmedXml(xml: string, retrievedAt: string): PublicationRecord[] {
  let doc: Json;
  try {
    doc = obj(parser.parse(xml));
  } catch {
    throw new SourceError('unexpected_response', 'PubMed returned XML that could not be read.');
  }
  const set = obj(doc.PubmedArticleSet);
  const out: PublicationRecord[] = [];
  for (const art of arr(set.PubmedArticle)) {
    const a = obj(art);
    const cit = obj(a.MedlineCitation);
    const pmid = nodeText(cit.PMID);
    if (!/^\d+$/.test(pmid)) continue;
    const article = obj(cit.Article);
    const title = nodeText(article.ArticleTitle);
    if (!title) continue;

    const authors = arr(obj(article.AuthorList).Author)
      .map((x) => {
        const au = obj(x);
        const collective = nodeText(au.CollectiveName);
        if (collective) return collective;
        const last = nodeText(au.LastName);
        const initials = nodeText(au.Initials);
        return last ? `${last}${initials ? ` ${initials}` : ''}` : '';
      })
      .filter(Boolean);

    const journal = obj(article.Journal);
    const pub = obj(obj(journal.JournalIssue).PubDate);
    const date =
      [nodeText(pub.Year), nodeText(pub.Month), nodeText(pub.Day)].filter(Boolean).join(' ') || nodeText(pub.MedlineDate) || null;

    const abstractParts = arr(obj(article.Abstract).AbstractText).map((t) => {
      const label = obj(t)['@_Label'];
      const text = nodeText(t);
      return label && text ? `${String(label)}: ${text}` : text;
    });
    const abstract = abstractParts.filter(Boolean).join('\n\n') || null;

    let doi: string | null = null;
    for (const id of arr(obj(obj(a.PubmedData).ArticleIdList).ArticleId)) {
      if (obj(id)['@_IdType'] === 'doi') doi = nodeText(id) || null;
    }
    if (!doi) {
      for (const e of arr(article.ELocationID)) {
        if (obj(e)['@_EIdType'] === 'doi') doi = nodeText(e) || null;
      }
    }

    out.push({
      source: 'pubmed',
      pmid,
      doi,
      title,
      authors,
      journal: nodeText(journal.Title) || null,
      publicationDate: date,
      abstract,
      canonicalUrl: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      retrievedAt,
    });
  }
  return out;
}

export class PubMedClient implements PubMedAdapter {
  readonly name = 'pubmed' as const;
  constructor(
    private readonly http: HttpClient,
    private readonly id: NcbiIdentity,
    private readonly cache: TtlCache<SourceResult<PublicationRecord>>,
    private readonly ttlSeconds: number,
  ) {}

  searchPublications(submitted: ParsedVariant, ctx: SearchContext, limit = 8): Promise<SourceResult<PublicationRecord>> {
    const term = buildPubMedTerm(submitted, ctx);
    if (!term) {
      return Promise.resolve({
        source: 'pubmed', status: 'skipped', items: [], message: 'A gene symbol is needed to search PubMed.',
        retrievedAt: new Date().toISOString(), fromCache: false, query: '', limitations: [],
      });
    }
    return this.run(term, limit);
  }

  searchByText(query: string, limit = 8): Promise<SourceResult<PublicationRecord>> {
    return this.run(query.slice(0, 300), limit);
  }

  private run(term: string, limit: number): Promise<SourceResult<PublicationRecord>> {
    return runSource<PublicationRecord>(
      {
        source: 'pubmed',
        query: term,
        limitations: [
          'Only titles, metadata and abstracts were retrieved; the full articles were not reviewed.',
          'A text match does not mean a paper reports on the specific variant, cancer type or conclusion you are interested in.',
        ],
        cache: this.cache,
        cacheKey: `pubmed:${limit}:${term}`,
        ttlSeconds: this.ttlSeconds,
      },
      async () => {
        const search = obj(
          await this.http.requestJson(
            `${BASE}/esearch.fcgi?${ncbiParams(this.id, { db: 'pubmed', term, retmode: 'json', retmax: String(limit), sort: 'relevance' })}`,
          ),
        );
        const result = obj(search.esearchresult);
        const ids = arr(result.idlist).map(String).filter((i) => /^\d+$/.test(i));
        const total = Number(result.count ?? ids.length);
        if (!ids.length) return { items: [], total: 0 };
        const xml = await this.http.requestText(
          `${BASE}/efetch.fcgi?${ncbiParams(this.id, { db: 'pubmed', id: ids.join(','), rettype: 'abstract', retmode: 'xml' })}`,
          { headers: { Accept: 'application/xml' } },
        );
        const items = parsePubmedXml(xml, new Date().toISOString());
        // Preserve the relevance order returned by esearch.
        items.sort((x, y) => ids.indexOf(x.pmid) - ids.indexOf(y.pmid));
        return { items, total };
      },
    );
  }
}
