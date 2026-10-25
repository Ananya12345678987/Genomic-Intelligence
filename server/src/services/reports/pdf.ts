import { getDocumentProxy, extractText } from 'unpdf';
import { HttpError } from '../../utils/httpError.js';

export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_PDF_PAGES = 40;
export const MAX_TEXT_CHARS = 250_000;
/** Below this many characters across the whole document we treat the PDF as having no usable text layer. */
const MIN_TEXT_CHARS = 20;

/**
 * Validate by content, not by filename or declared MIME type: a real PDF starts with "%PDF-"
 * within its first kilobyte. This rejects renamed executables, HTML, images and so on.
 */
export function looksLikePdf(buf: Buffer): boolean {
  if (buf.length < 8) return false;
  return buf.subarray(0, 1024).includes(Buffer.from('%PDF-'));
}

export interface ExtractedPdfText {
  pageCount: number;
  text: string;
  truncated: boolean;
}

export async function readPdfPageCount(buf: Buffer): Promise<number> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    return pdf.numPages;
  } catch {
    throw new HttpError(422, 'PDF_UNREADABLE', 'This PDF could not be read. It may be corrupted or password-protected.');
  }
}

/**
 * Text-layer extraction only. This is NOT OCR: scanned or image-only PDFs have no text layer and are
 * reported as such instead of being silently treated as empty reports.
 */
export async function extractPdfText(buf: Buffer): Promise<ExtractedPdfText> {
  let pageCount: number;
  let text: string;
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    pageCount = pdf.numPages;
    if (pageCount > MAX_PDF_PAGES) {
      throw new HttpError(413, 'PDF_TOO_MANY_PAGES', `This PDF has ${pageCount} pages; the limit is ${MAX_PDF_PAGES}.`);
    }
    const out = await extractText(pdf, { mergePages: true });
    text = out.text;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(422, 'PDF_UNREADABLE', 'This PDF could not be read. It may be corrupted or password-protected.');
  }
  if (text.replace(/\s+/g, '').length < MIN_TEXT_CHARS) {
    throw new HttpError(
      422,
      'NO_TEXT_LAYER',
      'No selectable text was found in this PDF. It may be a scanned image. OCR is not supported in this version, so nothing was extracted. Paste the report text or enter findings manually.',
    );
  }
  const truncated = text.length > MAX_TEXT_CHARS;
  return { pageCount, text: truncated ? text.slice(0, MAX_TEXT_CHARS) : text, truncated };
}
