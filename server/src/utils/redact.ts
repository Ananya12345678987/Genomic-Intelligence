/**
 * Best-effort removal of common identifiers from user-typed text before it can reach an external
 * service. This is a minimisation step, NOT de-identification: names and free-text details
 * cannot be reliably detected. The product therefore also keeps report-derived content away
 * from external AI providers unless explicitly enabled and consented.
 */
const PATTERNS: [RegExp, string][] = [
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]'],
  [/\b(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3,5}\)?[\s.-]?){2,4}\d{2,4}\b(?=\D|$)/g, '[number]'],
  [/\b(?:MRN|UHID|patient\s*id|pt\s*id|accession|specimen\s*id|case\s*(?:no|number|#))\s*[:#-]?\s*[A-Z0-9-]{3,}\b/gi, '[identifier]'],
  [/\b(?:DOB|date of birth|born)\s*[:\-]?\s*[\d/.\- A-Za-z]{6,20}/gi, '[date of birth]'],
  [/\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/g, '[date]'],
  [/\b\d{4}-\d{2}-\d{2}\b/g, '[date]'],
  [/\b(?:Mr|Mrs|Ms|Miss|Dr|Prof)\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?/g, '[name]'],
];

export function redactIdentifiers(text: string, maxLength = 400): string {
  let out = text;
  for (const [re, label] of PATTERNS) out = out.replace(re, label);
  return out.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}
