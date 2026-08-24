/**
 * UI manajemen credential provider.
 * Raw key tidak pernah dirender — hanya bentuk redacted.
 */
import { useState, type FormEvent } from 'react';
import { foldResult } from '../../core/result';
import type { ProviderId } from '../../domain/automation';
import {
  PROVIDER_OPTIONS,
  listCredentials,
  removeApiKey,
  saveApiKey,
  type ProviderCredential,
} from '../../services/providerService';

export function CredentialPanel() {
  const [provider, setProvider] = useState<ProviderId>('groq');
  const [apiKey, setApiKey] = useState('');
  const [credentials, setCredentials] = useState<ProviderCredential[]>(() =>
    listCredentials(),
  );
  const [feedback, setFeedback] = useState<string | null>(null);

  const refresh = () => setCredentials(listCredentials());

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    foldResult(
      saveApiKey(provider, apiKey),
      (saved) => {
        setFeedback(`Saved: ${saved.provider} (${saved.redactedKey})`);
        setApiKey('');
        refresh();
      },
      (error) => setFeedback(`Error: ${error.message}`),
    );
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

  return (
    <div>
      <form
        onSubmit={handleSubmit}
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

        <button type="submit" style={{ padding: '4px 12px' }}>
          Save
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