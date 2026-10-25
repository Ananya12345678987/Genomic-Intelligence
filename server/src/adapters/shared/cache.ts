export interface CacheEntry<V> {
  value: V;
  storedAt: number;
  expiresAt: number;
}

/**
 * Small in-memory TTL cache for PUBLIC source responses only.
 * Keys are built from public query parameters (gene, variant, cancer type) and
 * never contain report text, so the cache holds no user-specific content.
 */
export class TtlCache<V> {
  private readonly map = new Map<string, CacheEntry<V>>();

  constructor(
    private readonly maxEntries = 500,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): CacheEntry<V> | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    // refresh recency
    this.map.delete(key);
    this.map.set(key, hit);
    return hit;
  }

  set(key: string, value: V, ttlMs: number): CacheEntry<V> {
    const t = this.now();
    const entry = { value, storedAt: t, expiresAt: t + ttlMs };
    this.map.delete(key);
    this.map.set(key, entry);
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
    return entry;
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}
