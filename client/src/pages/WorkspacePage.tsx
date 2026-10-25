import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FileDown, Menu } from 'lucide-react';
import clsx from 'clsx';
import { Sidebar } from '../components/layout/Sidebar';
import { EvidencePanel } from '../components/layout/EvidencePanel';
import { ExportDialog } from '../components/layout/ExportDialog';
import { EmptyState } from '../components/chat/EmptyState';
import { MessageList, type BusyState } from '../components/chat/MessageList';
import { Composer, EMPTY_CONTEXT, toChatContext, type ContextFields } from '../components/chat/Composer';
import { useInvestigation, useInvestigationMutations } from '../hooks/useInvestigations';
import { useConversation } from '../hooks/useConversation';
import { ApiError, chatApi, reportsApi, uploadReport } from '../services/api';
import type { SearchResult } from '../types/research';

const errorText = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');

export function WorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [context, setContext] = useState<ContextFields>(EMPTY_CONTEXT);
  const [busy, setBusy] = useState<BusyState | null>(null);
  const [error, setError] = useState<{ message: string; retry?: () => void } | null>(null);
  const [exporting, setExporting] = useState(false);
  const { data: active } = useInvestigation(id);
  const { create } = useInvestigationMutations();
  const convo = useConversation(id);

  // Holds the id of an investigation created mid-request so a retry never creates a second one.
  const idRef = useRef<string | undefined>(id);
  idRef.current = id ?? idRef.current;

  const ensureInvestigation = async (titleSeed: string): Promise<string> => {
    if (idRef.current) return idRef.current;
    const title = titleSeed.length > 60 ? `${titleSeed.slice(0, 57)}…` : titleSeed;
    const res = await create.mutateAsync({ title });
    idRef.current = res.investigation.id;
    navigate(`/i/${res.investigation.id}`, { replace: true });
    return res.investigation.id;
  };

  const reset = () => {
    idRef.current = undefined;
    setDraft('');
    setError(null);
    setContext(EMPTY_CONTEXT);
    setNavOpen(false);
    navigate('/');
  };

  const send = async (text: string) => {
    setError(null);
    setBusy({ label: 'Searching ClinVar, CIViC, PubMed and ClinicalTrials.gov…', echo: text });
    setDraft('');
    try {
      const invId = await ensureInvestigation(text);
      const r = await chatApi.send(invId, text, toChatContext(context));
      convo.append(invId, r.userMessage, r.assistantMessage);
    } catch (e) {
      setError({ message: errorText(e), retry: () => void send(text) });
    } finally {
      setBusy(null);
    }
  };

  const uploadPdf = async (file: File) => {
    setError(null);
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      setError({ message: 'Only PDF files are supported.' });
      return;
    }
    setBusy({ label: `Uploading ${file.name}`, progress: 0 });
    try {
      const invId = await ensureInvestigation('PDF report');
      const up = await uploadReport(file, invId, (p) => setBusy((b) => (b ? { ...b, progress: p } : b)));
      setBusy({ label: 'Extracting text and candidate findings…' });
      const ex = await reportsApi.extract(up.reportId, invId);
      convo.append(invId, ex.userMessage, ex.assistantMessage);
    } catch (e) {
      setError({ message: errorText(e) });
    } finally {
      setBusy(null);
    }
  };

  const confirm = async (reportId: string, selections: { id: string; text?: string }[]) => {
    const invId = idRef.current;
    if (!invId) return;
    setError(null);
    setBusy({ label: 'Searching the confirmed findings…' });
    try {
      const r = await reportsApi.confirm(reportId, invId, selections, toChatContext(context));
      convo.append(invId, r.userMessage, r.assistantMessage);
    } catch (e) {
      setError({ message: errorText(e), retry: () => void confirm(reportId, selections) });
    } finally {
      setBusy(null);
    }
  };

  let results: SearchResult[] = [];
  for (const m of [...convo.messages].reverse()) {
    if (m.payload?.kind === 'results') {
      results = m.payload.results;
      break;
    }
  }
  const showEmpty = !id && convo.messages.length === 0 && !busy;

  return (
    <div className="flex h-full">
      {navOpen && <button className="fixed inset-0 z-30 bg-ink/30 md:hidden" aria-label="Close navigation" onClick={() => setNavOpen(false)} />}
      <div className={clsx('fixed inset-y-0 left-0 z-40 transition-transform duration-200 md:static md:translate-x-0', navOpen ? 'translate-x-0' : '-translate-x-full')}>
        <Sidebar
          collapsed={collapsed}
          onToggle={() => setCollapsed((c) => !c)}
          activeId={id}
          onNewInvestigation={reset}
          onOpen={(openId) => {
            idRef.current = openId;
            setError(null);
            setNavOpen(false);
            navigate(`/i/${openId}`);
          }}
          onDeleted={(deletedId) => {
            if (deletedId === id) reset();
          }}
        />
      </div>

      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto" aria-label="Conversation">
        <header className={clsx('flex items-center justify-between gap-3 border-b border-line px-4 py-3 md:px-6', !active && 'md:hidden')}>
          <div className="flex min-w-0 items-center gap-2">
            <button className="btn !p-1.5 md:hidden" onClick={() => setNavOpen(true)} aria-label="Open navigation">
              <Menu className="h-4 w-4" />
            </button>
            <h1 className="truncate text-sm font-semibold">{active?.investigation.title ?? 'New investigation'}</h1>
          </div>
          {results.length > 0 && (
            <button className="btn !px-3 !py-1.5 text-xs xl:hidden" onClick={() => setExporting(true)}>
              <FileDown className="h-3.5 w-3.5" aria-hidden /> Export
            </button>
          )}
        </header>
        {showEmpty ? (
          <EmptyState onPick={setDraft} />
        ) : (
          <MessageList
            messages={convo.messages}
            busy={busy}
            error={error}
            loadError={convo.error ? errorText(convo.error) : null}
            onRetryLoad={() => void convo.refetch()}
            onConfirm={(r, s) => void confirm(r, s)}
          />
        )}
        <Composer value={draft} onChange={setDraft} onSubmit={(t) => void send(t)} onFile={(f) => void uploadPdf(f)} context={context} onContextChange={setContext} disabled={Boolean(busy)} />
      </main>

      {results.length > 0 && <EvidencePanel results={results} onExport={() => setExporting(true)} />}
      {exporting && id && <ExportDialog investigationId={id} results={results} onClose={() => setExporting(false)} />}
    </div>
  );
}
