import { err, ok, type Result } from '../core/result';
import type { ProviderId } from '../domain/automation';

export interface ProviderCredential {
  provider: ProviderId;
  redactedKey: string;
  createdAt: string;
}

interface StoredCredential extends ProviderCredential {
  apiKey: string;
}

const memoryStore = new Map<ProviderId, StoredCredential>();

export const PROVIDER_OPTIONS: ProviderId[] = [
  'local',
  'groq',
  'openai',
  'anthropic',
  'custom',
];

function redact(apiKey: string): string {
  if (apiKey.length <= 8) {
    return '********';
  }
  return `${apiKey.slice(0, 4)}…${apiKey.slice(-4)}`;
}

function validateApiKey(apiKey: string): Error | null {
  const trimmed = apiKey.trim();
  if (trimmed.length < 8) {
    return new Error('API key minimal 8 karakter.');
  }
  if (/\s/.test(trimmed)) {
    return new Error('API key tidak boleh mengandung spasi.');
  }
  return null;
}

function toPublicCredential(credential: StoredCredential): ProviderCredential {
  return {
    provider: credential.provider,
    redactedKey: credential.redactedKey,
    createdAt: credential.createdAt,
  };
}

export function saveApiKey(
  provider: ProviderId,
  apiKey: string,
): Result<ProviderCredential, Error> {
  if (provider === 'local') {
    const credential: StoredCredential = {
      provider,
      apiKey: 'local',
      redactedKey: 'local (no key required)',
      createdAt: new Date().toISOString(),
    };
    memoryStore.set(provider, credential);
    return ok(toPublicCredential(credential));
  }

  const trimmed = apiKey.trim();
  const validationError = validateApiKey(trimmed);
  if (validationError) {
    return err(validationError);
  }

  const credential: StoredCredential = {
    provider,
    apiKey: trimmed,
    redactedKey: redact(trimmed),
    createdAt: new Date().toISOString(),
  };
  memoryStore.set(provider, credential);
  return ok(toPublicCredential(credential));
}

export function removeApiKey(provider: ProviderId): Result<null, Error> {
  if (!memoryStore.has(provider)) {
    return err(new Error(`No credential stored for provider "${provider}".`));
  }
  memoryStore.delete(provider);
  return ok(null);
}

export function listCredentials(): ProviderCredential[] {
  return Array.from(memoryStore.values()).map(toPublicCredential);
}

export function hasApiKey(provider: ProviderId): boolean {
  return memoryStore.has(provider);
}