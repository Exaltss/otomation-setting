/**
 * Execution history — ring buffer 50 entri di localStorage.
 * Mencatat eksekusi sukses dan gagal untuk audit & debugging.
 */
import type { ProviderId, ProviderTier } from '../../domain/automation';

const HISTORY_KEY = 'otomation.execution.history';
const MAX_ENTRIES = 50;

export interface HistoryEntry {
  id: string;
  at: string;
  provider?: ProviderId;
  tier?: ProviderTier;
  estimatedTokens: number;
  durationMs: number;
  status: 'ok' | 'error';
  message: string;
}

export function readHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed as HistoryEntry[];
      }
    }
  } catch {
    // data rusak -> mulai kosong
  }
  return [];
}

export function appendHistory(
  entry: Omit<HistoryEntry, 'id' | 'at'>,
): HistoryEntry[] {
  const stamped: HistoryEntry = {
    ...entry,
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
  };
  const next = [stamped, ...readHistory()].slice(0, MAX_ENTRIES);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  return next;
}

export function clearHistory(): void {
  localStorage.removeItem(HISTORY_KEY);
}