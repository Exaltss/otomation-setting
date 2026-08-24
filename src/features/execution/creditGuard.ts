/**
 * Credit Guard — batas pemakaian token per hari.
 * Menolak eksekusi SEBELUM request dikirim jika budget terlampaui.
 * Persist di localStorage, reset otomatis setiap ganti tanggal.
 */
import { err, ok, type Result } from '../../core/result';
import type { ProviderId } from '../../domain/automation';

const USAGE_KEY = 'otomation.credit.usage';

export interface CreditPolicy {
  maxTokensPerDay: number;
}

export const DEFAULT_CREDIT_POLICY: CreditPolicy = {
  maxTokensPerDay: 100000,
};

export interface UsageSnapshot {
  date: string;
  totalTokens: number;
  perProvider: Partial<Record<ProviderId, number>>;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function readUsage(): UsageSnapshot {
  try {
    const raw = localStorage.getItem(USAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as UsageSnapshot;
      if (parsed.date === today()) {
        return parsed;
      }
    }
  } catch {
    // data rusak -> reset ke snapshot baru
  }
  return { date: today(), totalTokens: 0, perProvider: {} };
}

function writeUsage(snapshot: UsageSnapshot): void {
  localStorage.setItem(USAGE_KEY, JSON.stringify(snapshot));
}

/** Cek apakah estimasi token masih dalam budget harian. */
export function checkBudget(
  estimatedTokens: number,
  policy: CreditPolicy = DEFAULT_CREDIT_POLICY,
): Result<UsageSnapshot, Error> {
  const usage = readUsage();
  const projected = usage.totalTokens + estimatedTokens;

  if (projected > policy.maxTokensPerDay) {
    return err(
      new Error(
        `Credit Guard: projected usage ${projected} tokens exceeds daily limit ` +
          `${policy.maxTokensPerDay}. Used today: ${usage.totalTokens}.`,
      ),
    );
  }

  return ok(usage);
}

/** Catat pemakaian setelah eksekusi sukses. */
export function recordUsage(provider: ProviderId, tokens: number): UsageSnapshot {
  const usage = readUsage();
  const next: UsageSnapshot = {
    date: usage.date,
    totalTokens: usage.totalTokens + tokens,
    perProvider: {
      ...usage.perProvider,
      [provider]: (usage.perProvider[provider] ?? 0) + tokens,
    },
  };
  writeUsage(next);
  return next;
}