import type { MonthDoc } from '../shared/types';
import { ConflictError } from './api';
import type { SyncStatus } from './state';

export interface SaverOpts {
  save: (doc: MonthDoc) => Promise<MonthDoc>;
  onSaved: (doc: MonthDoc) => void;
  onConflict: (current: MonthDoc | null) => void;
  onStatus: (s: SyncStatus, detail?: string) => void;
  debounceMs?: number;
  timers?: { set: typeof setTimeout; clear: typeof clearTimeout };
}

const BACKOFF = [2000, 4000, 8000, 16000, 30000];

export function createSaver(opts: SaverOpts) {
  const debounceMs = opts.debounceMs ?? 800;
  const timers = opts.timers ?? { set: ((fn: () => void, ms: number) => setTimeout(fn, ms)) as typeof setTimeout, clear: ((id: ReturnType<typeof setTimeout>) => clearTimeout(id)) as typeof clearTimeout };
  let pending: MonthDoc | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  let known = 0;
  let knownMonth: string | null = null;
  let attempt = 0;

  function arm(ms: number) {
    if (timer !== null) timers.clear(timer);
    timer = timers.set(() => { timer = null; void run(); }, ms);
  }

  async function run(): Promise<void> {
    if (inFlight || pending === null) return;
    inFlight = true;
    const base = pending.month === knownMonth ? Math.max(pending.version, known) : pending.version;
    const doc = { ...pending, version: base };
    pending = null;
    opts.onStatus('guardando');
    try {
      const saved = await opts.save(doc);
      if (saved.month !== knownMonth) { knownMonth = saved.month; known = saved.version; } else known = Math.max(known, saved.version);
      attempt = 0;
      opts.onSaved(saved);
      inFlight = false;
      if (pending !== null) { arm(debounceMs); } else opts.onStatus('guardado');
    } catch (err) {
      inFlight = false;
      if (err instanceof ConflictError) {
        pending = null;
        attempt = 0;
        if (timer !== null) { timers.clear(timer); timer = null; }
        const current = (err.current ?? null) as MonthDoc | null;
        if (current) { knownMonth = current.month; known = current.version; }
        opts.onStatus('conflicto', 'Este mes cambió en otro dispositivo; se recargó');
        opts.onConflict(current);
        return;
      }
      if (pending === null) pending = doc;
      const wait = BACKOFF[Math.min(attempt, BACKOFF.length - 1)];
      attempt++;
      opts.onStatus('sin-guardar', `reintentando en ${Math.round(wait / 1000)} s`);
      arm(wait);
    }
  }

  return {
    schedule(doc: MonthDoc) {
      pending = doc;
      opts.onStatus('guardando');
      if (!inFlight) arm(debounceMs);
    },
    async flush() {
      if (timer !== null) { timers.clear(timer); timer = null; }
      await run();
    },
    hasPending: () => pending !== null || inFlight,
    knownVersion: () => known,
    setKnownVersion(v: number, month: string) { if (month !== knownMonth) { knownMonth = month; known = v; } else known = Math.max(known, v); },
  };
}
export type Saver = ReturnType<typeof createSaver>;
