/**
 * Provider credential service backed by encrypted localStorage vault.
 *
 * Zero-knowledge: raw key hanya hidup di memori saat sesi berjalan.
 * Di penyimpanan hanya ada ciphertext AES-256-GCM + metadata redacted.
 */
import { err, ok, type Result } from '../core/result';
import type { ProviderId } from '../domain/automation';
import { decryptData, deriveMasterKey, encryptData } from './cryptoVault';

export interface ProviderCredential {
  provider: ProviderId;
  redactedKey: string;
  createdAt: string;
}

interface VaultEntry extends ProviderCredential {
  ciphertext: string;
  iv: string;
}

const STORAGE_PREFIX = 'otomation.vault.';
const CANARY_KEY = 'otomation.vault.canary';
const CANARY_PLAINTEXT = 'otomation-vault-unlocked';

export const PROVIDER_OPTIONS: ProviderId[] = [
  'local',
  'nvidia',
  'groq',
  'openai',
  'anthropic',
  'custom',
];

let masterKey: CryptoKey | null = null;

export function isUnlocked(): boolean {
  return masterKey !== null;
}

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

function readEntry(provider: ProviderId): VaultEntry | null {
  const raw = localStorage.getItem(STORAGE_PREFIX + provider);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as VaultEntry;
  } catch {
    return null;
  }
}

function writeEntry(entry: VaultEntry): void {
  localStorage.setItem(STORAGE_PREFIX + entry.provider, JSON.stringify(entry));
}

function toPublic(entry: VaultEntry): ProviderCredential {
  return {
    provider: entry.provider,
    redactedKey: entry.redactedKey,
    createdAt: entry.createdAt,
  };
}

/**
 * Unlock vault. Unlock pertama sekaligus men-set master password.
 * Unlock berikutnya memverifikasi password via canary terenkripsi.
 */
export async function unlockVault(password: string): Promise<Result<null, Error>> {
  if (password.length < 8) {
    return err(new Error('Vault password minimal 8 karakter.'));
  }

  try {
    const key = await deriveMasterKey(password);
    const canaryRaw = localStorage.getItem(CANARY_KEY);

    if (canaryRaw) {
      const canary = JSON.parse(canaryRaw) as { ciphertext: string; iv: string };
      await decryptData(canary.ciphertext, canary.iv, key);
    } else {
      const sealed = await encryptData(CANARY_PLAINTEXT, key);
      localStorage.setItem(CANARY_KEY, JSON.stringify(sealed));
    }

    masterKey = key;
    return ok(null);
  } catch {
    return err(new Error('Wrong vault password or corrupted vault.'));
  }
}

export function lockVault(): void {
  masterKey = null;
}

export async function saveApiKey(
  provider: ProviderId,
  apiKey: string,
): Promise<Result<ProviderCredential, Error>> {
  if (!masterKey) {
    return err(new Error('Vault is locked. Unlock it first.'));
  }

  if (provider === 'local') {
    const entry: VaultEntry = {
      provider,
      redactedKey: 'local (no key required)',
      createdAt: new Date().toISOString(),
      ciphertext: '',
      iv: '',
    };
    writeEntry(entry);
    return ok(toPublic(entry));
  }

  const trimmed = apiKey.trim();
  const validationError = validateApiKey(trimmed);
  if (validationError) {
    return err(validationError);
  }

  try {
    const sealed = await encryptData(trimmed, masterKey);
    const entry: VaultEntry = {
      provider,
      redactedKey: redact(trimmed),
      createdAt: new Date().toISOString(),
      ciphertext: sealed.ciphertext,
      iv: sealed.iv,
    };
    writeEntry(entry);
    return ok(toPublic(entry));
  } catch {
    return err(new Error('Encryption failed. Credential not saved.'));
  }
}

/** Dipakai execution engine untuk mengambil key asli secara aman. */
export async function getApiKey(provider: ProviderId): Promise<Result<string, Error>> {
  // Local mock tidak butuh credential dan tidak butuh vault terbuka.
  if (provider === 'local') {
    return ok('local');
  }

  if (!masterKey) {
    return err(new Error('Vault is locked. Unlock it first.'));
  }

  const entry = readEntry(provider);
  if (!entry) {
    return err(new Error(`No credential stored for provider "${provider}".`));
  }

  try {
    return ok(await decryptData(entry.ciphertext, entry.iv, masterKey));
  } catch {
    return err(new Error('Failed to decrypt credential. Vault may be corrupted.'));
  }
}

export function removeApiKey(provider: ProviderId): Result<null, Error> {
  if (!readEntry(provider)) {
    return err(new Error(`No credential stored for provider "${provider}".`));
  }
  localStorage.removeItem(STORAGE_PREFIX + provider);
  return ok(null);
}

export function listCredentials(): ProviderCredential[] {
  const credentials: ProviderCredential[] = [];
  for (const provider of PROVIDER_OPTIONS) {
    const entry = readEntry(provider);
    if (entry) {
      credentials.push(toPublic(entry));
    }
  }
  return credentials;
}

export function hasApiKey(provider: ProviderId): boolean {
  return readEntry(provider) !== null;
}