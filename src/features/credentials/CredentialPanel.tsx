/**
 * UI manajemen credential + vault lock/unlock.
 * Raw key tidak pernah dirender — hanya bentuk redacted.
 */
import { useState, type FormEvent } from 'react';
import { foldResult } from '../../core/result';
import type { ProviderId } from '../../domain/automation';
import {
  PROVIDER_OPTIONS,
  isUnlocked,
  listCredentials,
  lockVault,
  removeApiKey,
  saveApiKey,
  unlockVault,
  type ProviderCredential,
} from '../../services/providerService';

export function CredentialPanel() {
  const [unlocked, setUnlocked] = useState<boolean>(() => isUnlocked());
  const [vaultPassword, setVaultPassword] = useState('');
  const [provider, setProvider] = useState<ProviderId>('groq');
  const [apiKey, setApiKey] = useState('');
  const [credentials, setCredentials] = useState<ProviderCredential[]>(() =>
    listCredentials(),
  );
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => setCredentials(listCredentials());

  const handleUnlock = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);

    const result = await unlockVault(vaultPassword);
    foldResult(
      result,
      () => {
        setUnlocked(true);
        setVaultPassword('');
        setFeedback('Vault unlocked.');
        refresh();
      },
      (error) => setFeedback(`Error: ${error.message}`),
    );

    setBusy(false);
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);

    const result = await saveApiKey(provider, apiKey);
    foldResult(
      result,
      (saved) => {
        setFeedback(`Saved: ${saved.provider} (${saved.redactedKey})`);
        setApiKey('');
        refresh();
      },
      (error) => setFeedback(`Error: ${error.message}`),
    );

    setBusy(false);
  };

  const handleRemove = (target: ProviderId) => {
    foldResult(
      removeApiKey(target),
      () => {
        setFeedback(`Removed: ${target}`);
        refresh();
      },
      (error) => setFeedback(`Error: ${error.message}`),
    );
  };

  const handleLock = () => {
    lockVault();
    setUnlocked(false);
    setCredentials([]);
    setFeedback('Vault locked.');
  };

  if (!unlocked) {
    return (
      <div>
        <form
          onSubmit={handleUnlock}
          style={{ display: 'flex', gap: '10px', alignItems: 'flex-end' }}
        >
          <label>
            Vault password:
            <input
              type="password"
              value={vaultPassword}
              onChange={(event) => setVaultPassword(event.target.value)}
              style={{ marginLeft: '5px' }}
            />
          </label>
          <button type="submit" disabled={busy} style={{ padding: '4px 12px' }}>
            Unlock
          </button>
        </form>
        <p style={{ fontSize: '12px', opacity: 0.7 }}>
          Unlock pertama sekaligus men-set master password vault ini.
        </p>
        {feedback !== null && <p>{feedback}</p>}
      </div>
    );
  }

  return (
    <div>
      <form
        onSubmit={handleSave}
        style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', marginBottom: '10px' }}
      >
        <label>
          Provider:
          <select
            value={provider}
            onChange={(event) => setProvider(event.target.value as ProviderId)}
            style={{ marginLeft: '5px' }}
          >
            {PROVIDER_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <label style={{ flex: 1 }}>
          API key:
          <input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="sk-..."
            style={{ marginLeft: '5px', width: '70%' }}
          />
        </label>

        <button type="submit" disabled={busy} style={{ padding: '4px 12px' }}>
          Save
        </button>
        <button type="button" onClick={handleLock} style={{ padding: '4px 12px' }}>
          Lock
        </button>
      </form>

      {feedback !== null && <p>{feedback}</p>}

      {credentials.length === 0 ? (
        <p>Belum ada credential tersimpan.</p>
      ) : (
        <ul>
          {credentials.map((credential) => (
            <li key={credential.provider}>
              <strong>{credential.provider}</strong> — {credential.redactedKey}{' '}
              <button type="button" onClick={() => handleRemove(credential.provider)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}