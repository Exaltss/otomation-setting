/**
 * 9Router — cost-aware routing engine.
 *
 * Prinsip: "model termurah yang MAMPU mengerjakan tugas" menang.
 * Estimasi token + sinyal kompleksitas menentukan tier,
 * dan setiap tier dipetakan ke satu provider/model (single source of truth).
 */
import { err, ok, type Result } from '../../core/result';
import type {
  ProviderId,
  ProviderTier,
  RoutingDecision,
} from '../../domain/automation';

/** Batas token per tier. Harus ascending: cheap < standard < premium. */
export interface RouterPolicy {
  cheapMaxTokens: number;
  standardMaxTokens: number;
  premiumMaxTokens: number;
}

export const DEFAULT_ROUTER_POLICY: RouterPolicy = {
  cheapMaxTokens: 512,
  standardMaxTokens: 4096,
  premiumMaxTokens: 16384,
};

/** Mapping tier -> provider/model. Ubah hanya di sini (DRY). */
const TIER_TARGETS: Record<ProviderTier, { provider: ProviderId; model: string }> = {
  cheap: { provider: 'local', model: 'local-small' },
  standard: { provider: 'groq', model: 'fast-small' },
  premium: { provider: 'anthropic', model: 'premium-reasoning' },
};

/** Kata kunci yang menaikkan beban komputasi (tugas analitik/arsitektural). */
const COMPLEXITY_KEYWORDS = [
  'analisis',
  'analysis',
  'reasoning',
  'audit',
  'arsitek',
  'architect',
  'strategi',
  'strategy',
  'refactor',
] as const;

/** Bonus token virtual jika terdeteksi sinyal kompleksitas. */
const COMPLEXITY_BONUS = 1000;

/** Heuristik ringan: ~4 karakter per token (standar industri untuk estimasi cepat). */
export function estimateTokens(text: string): number {
  if (!text) {
    return 0;
  }
  return Math.max(1, Math.ceil(text.length / 4));
}

/** Validasi internal: kembalikan Error | null (bebas narrowing issue). */
function validatePolicy(policy: RouterPolicy): Error | null {
  const values = [
    policy.cheapMaxTokens,
    policy.standardMaxTokens,
    policy.premiumMaxTokens,
  ];

  if (values.some((value) => !Number.isFinite(value) || value <= 0)) {
    return new Error('Router policy thresholds must be positive numbers.');
  }

  if (
    !(
      policy.cheapMaxTokens < policy.standardMaxTokens &&
      policy.standardMaxTokens < policy.premiumMaxTokens
    )
  ) {
    return new Error(
      'Router policy thresholds must be ascending: cheap < standard < premium.',
    );
  }

  return null;
}

function selectTier(tokens: number, policy: RouterPolicy): ProviderTier | null {
  if (tokens <= policy.cheapMaxTokens) return 'cheap';
  if (tokens <= policy.standardMaxTokens) return 'standard';
  if (tokens <= policy.premiumMaxTokens) return 'premium';
  return null;
}

/**
 * Menentukan provider/model paling hemat yang mampu menangani input.
 * Mengembalikan Result — caller WAJIB menangani kasus overflow.
 */
export function routeByNineRouter(
  input: string,
  policy: RouterPolicy = DEFAULT_ROUTER_POLICY,
): Result<RoutingDecision, Error> {
  const validationError = validatePolicy(policy);
  if (validationError) {
    return err(validationError);
  }

  const safeInput = typeof input === 'string' ? input : '';
  const baseTokens = estimateTokens(safeInput);

  const normalized = safeInput.toLowerCase();
  const hasComplexSignal = COMPLEXITY_KEYWORDS.some((keyword) =>
    normalized.includes(keyword),
  );

  const effectiveTokens = baseTokens + (hasComplexSignal ? COMPLEXITY_BONUS : 0);

  const tier = selectTier(effectiveTokens, policy);

  if (tier === null) {
    return err(
      new Error(
        `Estimated context (${effectiveTokens} tokens) exceeds premiumMaxTokens ` +
          `(${policy.premiumMaxTokens}). Apply Compressed Context or split the task.`,
      ),
    );
  }

  const target = TIER_TARGETS[tier];

  return ok({
    provider: target.provider,
    model: target.model,
    tier,
    estimatedTokens: effectiveTokens,
    reason:
      tier === 'cheap'
        ? 'Low complexity: routed to cheapest tier to save credits.'
        : tier === 'standard'
          ? 'Medium complexity: routed to fast standard tier.'
          : 'High complexity: routed to premium tier.',
  });
}