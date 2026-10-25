import { BrandMark } from '../layout/BrandMark';

/** Labelled as example searches, not clinical recommendations. */
export const EXAMPLE_QUERIES = [
  'Investigate BRAF V600E in melanoma.',
  'Find evidence associated with EGFR variants in lung cancer.',
  'Compare two submitted variants.',
  'Search publications for a gene and cancer type.',
];

export function EmptyState({ onPick }: { onPick: (query: string) => void }) {
  return (
    <div className="mx-auto flex max-w-2xl flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <BrandMark size={44} />
      <h1 className="mt-6 text-3xl font-semibold tracking-tight sm:text-4xl">
        Explore the evidence behind a genetic variant.
      </h1>
      <p className="mt-3 max-w-xl text-base text-ink-soft">
        Search cancer-associated variants, investigate scientific evidence, and discover relevant clinical research.
      </p>

      <div className="mt-10 w-full text-left">
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-ink-soft">
          Example searches <span className="normal-case tracking-normal">(not clinical recommendations)</span>
        </p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {EXAMPLE_QUERIES.map((q) => (
            <li key={q}>
              <button
                onClick={() => onPick(q)}
                className="card h-full w-full px-4 py-3 text-left text-sm transition hover:-translate-y-px hover:bg-butter/50 hover:shadow-lift"
              >
                {q}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
