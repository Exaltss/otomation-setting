/**
 * Klien REST untuk gateway otomation.
 */
export const GATEWAY = 'http://localhost:4123';

export interface UsageData {
  date: string;
  totalTokens: number;
  perProvider: Record<string, number>;
}

export interface ScoreEntry {
  model: string;
  label?: string;
  score: number;
  votes?: number[];
}

export interface TournamentTrace {
  mode?: string;
  taskType?: string;
  candidates?: string[];
  mapping?: { label: string; model: string }[];
  scores?: ScoreEntry[];
  winner?: string | null;
  stragglers?: string[];
  validation?: string[];
  synthesis?: boolean;
  judges?: string[];
  quorumReached?: boolean;
  reasoningText?: string;
}

export interface HistoryEntry {
  id: string;
  at: string;
  provider?: string;
  model?: string;
  tier?: string;
  estimatedTokens: number;
  durationMs: number;
  status: 'ok' | 'error';
  message: string;
  tournament?: TournamentTrace;
}

export interface ProviderInfo {
  id: string;
  baseUrl: string;
  enabled: boolean;
  hasKey: boolean;
}

export interface CircuitInfo {
  slug: string;
  open: boolean;
  remainingMs: number;
}

export interface StatusData {
  usage: UsageData;
  history: HistoryEntry[];
  discoveredModels: number;
  warmModel: string | null;
  keys: { provider: string; redacted: string }[];
  circuit: CircuitInfo[];
  providers: ProviderInfo[];
  creditLimitPerDay: number;
}

export interface Combo {
  id: string;
  name: string;
  models: string[];
  createdAt: string;
}

export async function fetchStatus(): Promise<StatusData> {
  const res = await fetch(`${GATEWAY}/admin/api/status`);
  if (!res.ok) throw new Error(`status HTTP ${res.status}`);
  return (await res.json()) as StatusData;
}

export async function fetchConfig(): Promise<Record<string, unknown>> {
  const res = await fetch(`${GATEWAY}/admin/api/config`);
  if (!res.ok) throw new Error(`config HTTP ${res.status}`);
  return res.json();
}

export async function postConfig(candidate: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`${GATEWAY}/admin/api/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(candidate),
  });
  if (!res.ok) throw new Error(`config update HTTP ${res.status}`);
  return res.json();
}

export async function postKey(provider: string, key: string): Promise<{ keys: { provider: string; redacted: string }[] }> {
  const res = await fetch(`${GATEWAY}/admin/api/keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, key }),
  });
  if (!res.ok) throw new Error(`key save HTTP ${res.status}`);
  return res.json();
}

export async function fetchCombos(): Promise<Combo[]> {
  const res = await fetch(`${GATEWAY}/admin/api/combos`);
  if (!res.ok) throw new Error(`combos HTTP ${res.status}`);
  const data = (await res.json()) as { combos: Combo[] };
  return data.combos ?? [];
}

export async function createCombo(name: string, models: string[]): Promise<Combo> {
  const res = await fetch(`${GATEWAY}/admin/api/combos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, models }),
  });
  if (!res.ok) throw new Error(`combo create HTTP ${res.status}`);
  return res.json();
}

export async function deleteCombo(id: string): Promise<void> {
  await fetch(`${GATEWAY}/admin/api/combos/${id}`, { method: 'DELETE' });
}