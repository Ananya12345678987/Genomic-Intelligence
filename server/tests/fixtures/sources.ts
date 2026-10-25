/**
 * HAND-WRITTEN fixtures that follow the documented/cross-checked response shapes of each source.
 * They are NOT recordings of live responses (the build environment cannot reach NCBI,
 * ClinicalTrials.gov or CIViC). They prove our parsing and matching logic, not that the live
 * services currently return exactly this. Re-record against live services before relying on them.
 */

export const CLINVAR_ESEARCH = {
  esearchresult: { count: '2', retmax: '2', idlist: ['13961', '13962'] },
};

export const CLINVAR_ESUMMARY = {
  result: {
    uids: ['13961', '13962'],
    '13961': {
      uid: '13961',
      accession: 'VCV000013961',
      title: 'NM_004333.6(BRAF):c.1799T>A (p.Val600Glu)',
      genes: [{ symbol: 'BRAF', geneid: '673' }],
      germline_classification: {
        description: 'Pathogenic',
        last_evaluated: '2023/05/01 00:00',
        review_status: 'reviewed by expert panel',
        trait_set: [{ trait_name: 'Cardiofaciocutaneous syndrome' }],
      },
      oncogenicity_classification: {
        description: 'Oncogenic',
        last_evaluated: '2022/01/01 00:00',
        review_status: 'criteria provided, single submitter',
        trait_set: [{ trait_name: 'Melanoma' }],
      },
      variation_set: [
        {
          variation_xrefs: [{ db_source: 'dbSNP', db_id: '113488022' }],
          canonical_spdi: 'NC_000007.14:140753335:A:T',
        },
      ],
    },
    '13962': {
      uid: '13962',
      accession: 'VCV000013962',
      title: 'NM_004333.6(BRAF):c.1798_1799delinsAA (p.Val600Lys)',
      genes: [{ symbol: 'BRAF', geneid: '673' }],
      germline_classification: { description: 'Uncertain significance', review_status: 'no assertion criteria provided' },
    },
  },
};

export const PUBMED_ESEARCH = { esearchresult: { count: '2', idlist: ['11111111', '22222222'] } };

export const PUBMED_XML = `<?xml version="1.0"?>
<PubmedArticleSet>
  <PubmedArticle>
    <MedlineCitation>
      <PMID Version="1">22222222</PMID>
      <Article>
        <Journal><Title>Journal of Test Oncology</Title><JournalIssue><PubDate><Year>2020</Year><Month>Mar</Month></PubDate></JournalIssue></Journal>
        <ArticleTitle>Second paper about <i>BRAF</i> V600E in melanoma</ArticleTitle>
        <Abstract><AbstractText Label="BACKGROUND">BRAF V600E is a hotspot.</AbstractText><AbstractText Label="RESULTS">Findings were observed.</AbstractText></Abstract>
        <AuthorList><Author><LastName>Rivera</LastName><Initials>A</Initials></Author><Author><CollectiveName>Test Consortium</CollectiveName></Author></AuthorList>
      </Article>
    </MedlineCitation>
    <PubmedData><ArticleIdList><ArticleId IdType="pubmed">22222222</ArticleId><ArticleId IdType="doi">10.1000/test.2</ArticleId></ArticleIdList></PubmedData>
  </PubmedArticle>
  <PubmedArticle>
    <MedlineCitation>
      <PMID Version="1">11111111</PMID>
      <Article>
        <Journal><Title>Test Letters</Title><JournalIssue><PubDate><MedlineDate>2019 Jan-Feb</MedlineDate></PubDate></JournalIssue></Journal>
        <ArticleTitle>First paper without an abstract</ArticleTitle>
      </Article>
    </MedlineCitation>
  </PubmedArticle>
</PubmedArticleSet>`;

export const CIVIC_RESPONSE = {
  data: {
    evidenceItems: {
      totalCount: 3,
      nodes: [
        {
          id: 1409,
          name: 'EID1409',
          status: 'ACCEPTED',
          evidenceLevel: 'A',
          evidenceType: 'PREDICTIVE',
          evidenceDirection: 'SUPPORTS',
          significance: 'SENSITIVITYRESPONSE',
          variantOrigin: 'SOMATIC',
          description: 'Example curated statement used only for tests.',
          disease: { name: 'Melanoma' },
          therapies: [{ name: 'Example-tinib' }],
          source: { citation: 'Test et al., 2011', citationId: '22222222', sourceType: 'PUBMED' },
          molecularProfile: { id: 12, name: 'BRAF V600E' },
          lastAcceptedRevisionEvent: { createdAt: '2024-02-03T10:00:00Z' },
        },
        {
          id: 2001,
          name: 'EID2001',
          status: 'ACCEPTED',
          evidenceLevel: 'B',
          evidenceType: 'PREDICTIVE',
          evidenceDirection: 'SUPPORTS',
          significance: 'SENSITIVITYRESPONSE',
          variantOrigin: 'SOMATIC',
          description: 'Statement about a different substitution at the same residue.',
          disease: { name: 'Colorectal Cancer' },
          therapies: [],
          source: { citation: 'Other et al., 2015', citationId: '33333333', sourceType: 'PUBMED' },
          molecularProfile: { id: 13, name: 'BRAF V600K' },
          lastAcceptedRevisionEvent: null,
        },
        {
          id: 3001,
          name: 'EID3001',
          status: 'ACCEPTED',
          evidenceLevel: 'C',
          evidenceType: 'PREDICTIVE',
          evidenceDirection: 'SUPPORTS',
          significance: 'SENSITIVITYRESPONSE',
          variantOrigin: 'SOMATIC',
          description: 'Belongs to a different gene and must be discarded.',
          disease: { name: 'Lung Cancer' },
          therapies: [],
          source: { citation: 'Else et al.', citationId: '44444444', sourceType: 'PUBMED' },
          molecularProfile: { id: 99, name: 'KRAS G12C' },
          lastAcceptedRevisionEvent: null,
        },
      ],
    },
  },
};

export const TRIALS_RESPONSE = {
  totalCount: 2,
  studies: [
    {
      protocolSection: {
        identificationModule: { nctId: 'NCT01234567', briefTitle: 'Brief title', officialTitle: 'An Official Trial Title for Testing' },
        statusModule: { overallStatus: 'RECRUITING', lastUpdatePostDateStruct: { date: '2026-09-01', type: 'ACTUAL' } },
        conditionsModule: { conditions: ['Melanoma'] },
        armsInterventionsModule: { interventions: [{ name: 'Example-tinib', type: 'DRUG' }] },
        eligibilityModule: { eligibilityCriteria: 'Inclusion: adults. Exclusion: none listed for testing.' },
        contactsLocationsModule: { locations: [{ facility: 'Test Hospital', city: 'Pune', country: 'India' }] },
      },
    },
    { protocolSection: { identificationModule: { nctId: 'not-an-nct' } } },
  ],
};

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });
}
