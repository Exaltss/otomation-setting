/**
 * Klien REST untuk gateway otomation (satu sumber data UI admin).
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
  note?: string;
}

export interface TournamentTrace {
  taskType?: string;
  candidates?: string[];
  scores?: ScoreEntry[];
  winner?: string;
  validation?: string[];
  stragglers?: string[];
  synthesis?: boolean;
  mapping?: { label: string; model: string }[];
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

export interface GatewayConfig {
  model: string;
  tiers: Record<string, string | null>;
  fallbackModels: string[];
  creditLimitPerDay: number;
  keepWarm: boolean;
  keepWarmIntervalMs: number;
  providers: { id: string; baseUrl: string; enabled: boolean }[];
  tournament: Record<string, unknown>;
}

export async function fetchStatus(): Promise<StatusData> {
  const res = await fetch(`${GATEWAY}/admin/api/status`);
  if (!res.ok) throw new Error(`status HTTP ${res.status}`);
  return (await res.json()) as StatusData;
}

export async function fetchConfig(): Promise<GatewayConfig> {
  const res = await fetch(`${GATEWAY}/admin/api/config`);
  if (!res.ok) throw new Error(`config HTTP ${res.status}`);
  return (await res.json()) as GatewayConfig;
}

export async function postConfig(candidate: Partial<GatewayConfig>): Promise<GatewayConfig> {
  const res = await fetch(`${GATEWAY}/admin/api/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(candidate),
  });
  if (!res.ok) throw new Error(`config update HTTP ${res.status}`);
  return (await res.json()) as GatewayConfig;
}

export async function postKey(
  provider: string,
  key: string,
): Promise<{ keys: { provider: string; redacted: string }[] }> {
  const res = await fetch(`${GATEWAY}/admin/api/keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, key }),
  });
  if (!res.ok) throw new Error(`key save HTTP ${res.status}`);
  return (await res.json()) as { keys: { provider: string; redacted: string }[] };
}