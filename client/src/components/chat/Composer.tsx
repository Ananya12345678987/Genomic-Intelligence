import { useEffect, useRef, type FormEvent, type KeyboardEvent } from 'react';
import { ArrowUp, Paperclip } from 'lucide-react';
import type { ChatContext } from '../../types/research';

export interface ContextFields {
  cancerType: string;
  referenceGenome: '' | 'GRCh37' | 'GRCh38';
  transcriptId: string;
}

export const EMPTY_CONTEXT: ContextFields = { cancerType: '', referenceGenome: '', transcriptId: '' };

/** Blank fields become null so the server can fall back to the investigation's saved context. */
export const toChatContext = (c: ContextFields): ChatContext => ({
  cancerType: c.cancerType.trim() || null,
  referenceGenome: c.referenceGenome || null,
  transcriptId: c.transcriptId.trim() || null,
});

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  onFile: (file: File) => void;
  context: ContextFields;
  onContextChange: (c: ContextFields) => void;
  disabled?: boolean;
}

export function Composer({ value, onChange, onSubmit, onFile, context, onContextChange, disabled }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const text = value.trim();
    if (text && !disabled) onSubmit(text);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const set = <K extends keyof ContextFields>(k: K, v: ContextFields[K]) => onContextChange({ ...context, [k]: v });
  const hasContext = Boolean(context.cancerType || context.referenceGenome || context.transcriptId);

  return (
    <div className="sticky bottom-0 border-t border-line/60 bg-canvas px-4 pb-4 pt-3">
      <div className="mx-auto max-w-3xl">
        <details className="mb-2 text-xs" open={hasContext}>
          <summary className="inline-flex cursor-pointer items-center gap-1 rounded-pill px-2 py-1 text-ink-soft hover:bg-surface-alt">
            Add context (optional){hasContext ? ' · set' : ''}
          </summary>
          <div className="card mt-1 grid gap-2 p-3 sm:grid-cols-3">
            <label className="block">
              <span className="mb-0.5 block text-ink-soft">Cancer type</span>
              <input value={context.cancerType} onChange={(e) => set('cancerType', e.target.value)} maxLength={120} placeholder="e.g. melanoma" className="w-full rounded-md border border-line bg-canvas px-2 py-1.5 text-sm" />
            </label>
            <label className="block">
              <span className="mb-0.5 block text-ink-soft">Reference genome</span>
              <select value={context.referenceGenome} onChange={(e) => set('referenceGenome', e.target.value as ContextFields['referenceGenome'])} className="w-full rounded-md border border-line bg-canvas px-2 py-1.5 text-sm">
                <option value="">Not specified</option>
                <option value="GRCh38">GRCh38</option>
                <option value="GRCh37">GRCh37</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-0.5 block text-ink-soft">Transcript</span>
              <input value={context.transcriptId} onChange={(e) => set('transcriptId', e.target.value)} maxLength={40} placeholder="e.g. NM_004333.6" className="tech w-full rounded-md border border-line bg-canvas px-2 py-1.5 text-sm" />
            </label>
            <p className="text-ink-soft sm:col-span-3">Nothing is assumed when a field is left blank. Missing details can limit how precisely a variant is matched.</p>
          </div>
        </details>

        <form onSubmit={submit} className="card flex items-end gap-2 p-2 shadow-lift">
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) onFile(f);
            }}
          />
          <button type="button" className="btn !rounded-full !p-2" aria-label="Attach a PDF report" title="Attach a text-based PDF report (max 10 MB, 40 pages)" disabled={disabled} onClick={() => fileRef.current?.click()}>
            <Paperclip className="h-4 w-4" />
          </button>

          <label className="flex-1">
            <span className="sr-only">Gene, variant, or report text</span>
            <textarea
              ref={ref}
              rows={1}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Enter a gene, a variant (e.g. BRAF p.Val600Glu), or paste report text"
              className="max-h-52 w-full resize-none bg-transparent px-2 py-2 text-sm placeholder:text-ink-soft focus:outline-none"
              maxLength={20000}
            />
          </label>

          <button type="submit" className="btn btn-primary !rounded-full !p-2" disabled={disabled || !value.trim()} aria-label="Investigate">
            <ArrowUp className="h-4 w-4" />
          </button>
        </form>
        <p className="mt-2 text-center text-[11px] text-ink-soft">
          Research support only. Not a diagnosis or treatment recommendation. Verify findings against the cited sources. PDFs must contain selectable text; scanned images are not read (no OCR).
        </p>
      </div>
    </div>
  );
}
