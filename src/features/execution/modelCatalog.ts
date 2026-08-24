/**
 * Model catalog — daftar model yang DIFASILITASI oleh API key.
 *
 * Prinsip: bukan kita yang menentukan model. Katalog diambil dari
 * provider (GET /v1/models), lalu diranking otomatis per tier.
 * Key NVIDIA di build.nvidia.com memfasilitasi model gratis —
 * catalog inilah sumber kebenarannya.
 */
import { err, ok, type Result } from '../../core/result';
import type { ProviderId, ProviderTier } from '../../domain/automation';
import { getOpenAiCompatibleBaseUrl } from './providerAdapters';

export interface ModelInfo {
  id: string;
}

const catalogCache = new Map<ProviderId, ModelInfo[]>();

/** Ambil katalog model yang tersedia untuk key tertentu (dengan cache). */
export async function fetchModels(
  provider: ProviderId,
  apiKey: string,
): Promise<Result<ModelInfo[], Error>> {
  const cached = catalogCache.get(provider);
  if (cached) {
    return ok(cached);
  }

  if (provider === 'local') {
    const models: ModelInfo[] = [{ id: 'local-small' }];
    catalogCache.set(provider, models);
    return ok(models);
  }

  const baseUrl = getOpenAiCompatibleBaseUrl(provider);
  if (!baseUrl) {
    return err(new Error(`Model catalog not supported for provider "${provider}".`));
  }

  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!response.ok) {
      return err(new Error(`${provider} catalog: HTTP ${response.status}`));
    }

    const data = (await response.json()) as { data?: { id: string }[] };
    const models = (data.data ?? []).map((entry) => ({ id: entry.id }));

    if (models.length === 0) {
      return err(new Error(`${provider} catalog is empty.`));
    }

    catalogCache.set(provider, models);
    return ok(models);
  } catch {
    return err(new Error(`Network error while fetching ${provider} catalog.`));
  }
}

const CHEAP_SIGNALS = ['nano', '4b', '8b', 'small', 'mini'];
const PREMIUM_SIGNALS = ['ultra', '405b', '70b', 'nemotron', 'large'];

/**
 * Ranking otomatis: pilih model dari katalog key sesuai tier.
 * Jika tidak ada sinyal yang cocok, pakai model pertama yang difasilitasi key.
 */
export function pickModelForTier(
  tier: ProviderTier,
  models: ModelInfo[],
): string | null {
  if (models.length === 0) {
    return null;
  }

  const signals = tier === 'premium' ? PREMIUM_SIGNALS : CHEAP_SIGNALS;

  for (const signal of signals) {
    const hit = models.find((model) => model.id.toLowerCase().includes(signal));
    if (hit) {
      return hit.id;
    }
  }

  return models[0].id;
}