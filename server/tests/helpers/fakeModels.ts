/* In-memory stand-in for the Mongoose models, used ONLY to run controllers without a database.
 * It implements just the calls the controllers make. It does not validate schemas, enforce
 * indexes or reproduce Mongo semantics, so it proves controller wiring, not database behaviour. */
import { randomBytes } from 'node:crypto';

type Doc = Record<string, any>;
// Monotonic like real ObjectIds, so sorting by _id breaks timestamp ties in insertion order.
let seq = 0;
const oid = () => (++seq).toString(16).padStart(8, '0') + randomBytes(8).toString('hex');

function get(obj: Doc, path: string): any {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj: Doc, path: string, value: unknown) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k] ??= {};
  o[keys.at(-1)!] = value;
}
function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([k, want]) => {
    const have = get(doc, k);
    if (want && typeof want === 'object' && '$in' in want) return (want.$in as unknown[]).map(String).includes(String(have));
    if (want === null) return have === null || have === undefined;
    return String(have) === String(want);
  });
}

function sortBy(arr: Doc[], spec: Doc) {
  const keys = Object.entries(spec) as [string, number][];
  arr.sort((a, b) => {
    for (const [k, dir] of keys) {
      const x = get(a, k), y = get(b, k);
      if (x > y) return dir;
      if (x < y) return -dir;
    }
    return 0;
  });
}

class Query<T> {
  constructor(private run: () => T, private sortSpec: Doc | null = null) {}
  sort(spec: Doc) { this.sortSpec = spec; return this; }
  select() { return this; }
  limit() { return this; }
  skip() { return this; }
  lean() { return Promise.resolve(this.exec()); }
  then(res: (v: T) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve(this.exec()).then(res, rej); }
  private exec(): T {
    const out = this.run();
    if (Array.isArray(out) && this.sortSpec) sortBy(out, this.sortSpec);
    return out;
  }
}

export class FakeModel {
  docs: Doc[] = [];
  bulkOps = 0;
  constructor(public name: string) {}

  private wrap(data: Doc): Doc {
    const self = this;
    const doc: Doc = {
      createdAt: new Date(),
      updatedAt: new Date(),
      ...data,
      _id: data._id ?? oid(),
      set(path: string, value: unknown) { setPath(doc, path, value); },
      async save() { doc.updatedAt = new Date(); return doc; },
      async deleteOne() { self.docs = self.docs.filter((d) => d !== doc); },
    };
    return doc;
  }
  async create(data: Doc) { const d = this.wrap(data); this.docs.push(d); return d; }
  find(filter: Doc = {}) { return new Query(() => this.docs.filter((d) => matches(d, filter)).map((d) => ({ ...d }))); }
  findOne(filter: Doc = {}) {
    const q = new Query<Doc | null>(() => null);
    let spec: Doc | null = null;
    (q as any).sort = (s: Doc) => { spec = s; return q; };
    (q as any).exec = () => {
      const found = this.docs.filter((d) => matches(d, filter));
      if (spec) sortBy(found, spec);
      return found[0] ?? null;
    };
    return q;
  }
  findById(id: string) { return this.findOne({ _id: id }); }
  async countDocuments(filter: Doc = {}) { return this.docs.filter((d) => matches(d, filter)).length; }
  async deleteMany(filter: Doc = {}) { this.docs = this.docs.filter((d) => !matches(d, filter)); }
  findOneAndUpdate(filter: Doc, update: Doc, opts: Doc = {}) {
    return new Query<Doc | null>(() => {
      let d = this.docs.find((x) => matches(x, filter));
      if (!d && opts.upsert) { d = this.wrap({ ...filter }); this.docs.push(d); }
      if (d && update.$set) for (const [k, v] of Object.entries(update.$set)) setPath(d, k, v);
      return d ? { ...d } : null;
    });
  }
  async bulkWrite(ops: Doc[]) {
    this.bulkOps += ops.length;
    for (const op of ops) {
      const { filter, update, upsert } = op.updateOne;
      let d = this.docs.find((x) => matches(x, filter));
      if (!d && upsert) { d = this.wrap({ ...filter }); this.docs.push(d); }
      if (d) for (const [k, v] of Object.entries(update.$set ?? {})) setPath(d, k, v);
    }
  }
}

export const fakeModels = {
  User: new FakeModel('User'),
  Session: new FakeModel('Session'),
  Investigation: new FakeModel('Investigation'),
  ConversationMessage: new FakeModel('ConversationMessage'),
  Variant: new FakeModel('Variant'),
  EvidenceRecord: new FakeModel('EvidenceRecord'),
  MatchResult: new FakeModel('MatchResult'),
  Publication: new FakeModel('Publication'),
  ClinicalTrial: new FakeModel('ClinicalTrial'),
  UserSettings: new FakeModel('UserSettings'),
};

export function resetFakeModels() {
  for (const m of Object.values(fakeModels)) { m.docs = []; m.bulkOps = 0; }
}
