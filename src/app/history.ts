import type { Row } from '../shared/types';

export interface Snapshot { ingresos: number; rows: Row[] }
export interface HistoryEntry { id: number; ym: string; label: string; at: number; before: Snapshot }
/** Un rehacer: el estado que había justo antes de deshacer, y las entradas que ese deshacer quitó. */
export interface RedoEntry { ym: string; label: string; at: number; after: Snapshot; removed: HistoryEntry[] }
interface Persisted { seq: number; entries: HistoryEntry[]; redo: RedoEntry[] }

const cloneSnapshot = (s: Snapshot): Snapshot => ({ ingresos: s.ingresos, rows: s.rows.map((r) => ({ ...r })) });

export function createHistory(limit = 10, now: () => number = () => Date.now()) {
  let seq = 0;
  let entries: HistoryEntry[] = []; // índice 0 = más antigua
  let redo: RedoEntry[] = [];       // índice 0 = más antigua
  return {
    /** Registra el estado previo a un cambio. Un cambio nuevo invalida los rehacer pendientes. */
    record(ym: string, label: string, before: Snapshot): HistoryEntry {
      const entry: HistoryEntry = { id: ++seq, ym, label, at: now(), before: cloneSnapshot(before) };
      entries.push(entry);
      if (entries.length > limit) entries = entries.slice(entries.length - limit);
      redo = [];
      return entry;
    },
    list(): HistoryEntry[] { return entries.slice().reverse(); },
    /** Quita desde la cima hasta `id` inclusive (por defecto la cima) y guarda un rehacer con el estado actual. */
    take(id: number | undefined, current: Snapshot) {
      if (entries.length === 0) return null;
      const idx = id === undefined ? entries.length - 1 : entries.findIndex((e) => e.id === id);
      if (idx < 0) return null;
      const removed = entries.splice(idx).reverse(); // de la cima hacia abajo, incluye la entrada
      const entry = removed[removed.length - 1];
      redo.push({ ym: entry.ym, label: entry.label, at: now(), after: cloneSnapshot(current), removed });
      if (redo.length > limit) redo = redo.slice(redo.length - limit);
      return { entry, removed };
    },
    /** Rehace el último deshacer: devuelve el estado a restaurar y vuelve a poner sus entradas en la pila. */
    takeRedo() {
      const r = redo.pop();
      if (!r) return null;
      entries.push(...r.removed.slice().reverse());
      if (entries.length > limit) entries = entries.slice(entries.length - limit);
      return r;
    },
    redoList(): RedoEntry[] { return redo.slice().reverse(); },
    size: () => entries.length,
    redoSize: () => redo.length,
    clear() { entries = []; redo = []; },
    serialize(): string { return JSON.stringify({ seq, entries, redo } satisfies Persisted); },
    hydrate(json: string | null | undefined): boolean {
      if (!json) return false;
      try {
        const p = JSON.parse(json) as Partial<Persisted>;
        if (!Array.isArray(p.entries) || !Array.isArray(p.redo) || typeof p.seq !== 'number') return false;
        entries = p.entries.slice(-limit); redo = p.redo.slice(-limit); seq = Math.max(p.seq, ...entries.map((e) => e.id), 0);
        return true;
      } catch { return false; }
    },
  };
}
export type History = ReturnType<typeof createHistory>;
