import { randomBytes } from 'node:crypto';
import type { ExtractedCandidate } from '../variant-normalization/index.js';

export interface ReportEntry {
  id: string;
  userId: string;
  investigationId: string | null;
  /** Raw uploaded bytes. Held only between upload and extraction, then dropped. */
  buffer: Buffer | null;
  pageCount: number | null;
  /** Candidate findings only. The report text itself is never kept. */
  candidates: ExtractedCandidate[] | null;
  /** True when the findings came from a pasted or uploaded report (affects AI consent rules). */
  reportDerived: boolean;
  createdAt: number;
  expiresAt: number;
}

/**
 * Short-lived, per-process holding area for uploads and extracted candidates.
 *
 * Uploads are kept in memory rather than on disk, so there are no temporary files to leak,
 * no filesystem paths to expose and nothing to clean up after a crash. Entries expire on a
 * timer. Limitation: a multi-instance deployment would need a shared store with the same
 * expiry and ownership rules.
 */
export class ReportStore {
  private entries = new Map<string, ReportEntry>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly ttlMs = 30 * 60 * 1000,
    private readonly maxEntries = 200,
    private readonly now: () => number = Date.now,
  ) {}

  start(sweepEveryMs = 60_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.sweep(), sweepEveryMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.entries.clear();
  }

  create(input: { userId: string; investigationId?: string | null; buffer?: Buffer | null; pageCount?: number | null; candidates?: ExtractedCandidate[] | null; reportDerived?: boolean }): ReportEntry {
    this.sweep();
    if (this.entries.size >= this.maxEntries) {
      // Evict the oldest entry rather than refusing: stale review sessions are the cheapest to lose.
      const oldest = [...this.entries.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
      if (oldest) this.delete(oldest.id);
    }
    const t = this.now();
    const entry: ReportEntry = {
      id: randomBytes(18).toString('base64url'),
      userId: input.userId,
      investigationId: input.investigationId ?? null,
      buffer: input.buffer ?? null,
      pageCount: input.pageCount ?? null,
      candidates: input.candidates ?? null,
      reportDerived: input.reportDerived ?? true,
      createdAt: t,
      expiresAt: t + this.ttlMs,
    };
    this.entries.set(entry.id, entry);
    return entry;
  }

  /** Returns the entry only for its owner and only before expiry. Others get undefined, same as a missing id. */
  get(id: string, userId: string): ReportEntry | undefined {
    const e = this.entries.get(id);
    if (!e || e.userId !== userId) return undefined;
    if (e.expiresAt <= this.now()) {
      this.delete(id);
      return undefined;
    }
    return e;
  }

  delete(id: string): void {
    const e = this.entries.get(id);
    if (e) e.buffer = null;
    this.entries.delete(id);
  }

  deleteForUser(userId: string): void {
    for (const e of [...this.entries.values()]) if (e.userId === userId) this.delete(e.id);
  }

  sweep(): void {
    const t = this.now();
    for (const e of [...this.entries.values()]) if (e.expiresAt <= t) this.delete(e.id);
  }

  get size(): number {
    return this.entries.size;
  }
}
