const THREE_TO_ONE: Record<string, string> = {
  Ala: 'A', Arg: 'R', Asn: 'N', Asp: 'D', Cys: 'C', Gln: 'Q', Glu: 'E', Gly: 'G', His: 'H', Ile: 'I',
  Leu: 'L', Lys: 'K', Met: 'M', Phe: 'F', Pro: 'P', Ser: 'S', Thr: 'T', Trp: 'W', Tyr: 'Y', Val: 'V',
  Ter: '*', Sec: 'U',
};

const ONE_TO_THREE: Record<string, string> = Object.fromEntries(
  Object.entries(THREE_TO_ONE).map(([three, one]) => [one, three]),
);

export const ONE_LETTER_CLASS = 'ACDEFGHIKLMNPQRSTVWY';

export function isThreeLetter(code: string): boolean {
  return code in THREE_TO_ONE;
}

/** Convert a one-letter code or a three-letter code to canonical three-letter form, or null if invalid. */
export function toThreeLetter(code: string): string | null {
  if (code === 'X') return 'Ter';
  if (code.length === 1) return ONE_TO_THREE[code.toUpperCase()] ?? null;
  const normalized = code.charAt(0).toUpperCase() + code.slice(1).toLowerCase();
  return isThreeLetter(normalized) ? normalized : null;
}

export function toOneLetter(code: string): string | null {
  const three = toThreeLetter(code);
  return three ? (THREE_TO_ONE[three] ?? null) : null;
}
