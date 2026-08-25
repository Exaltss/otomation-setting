/**
 * AI Provider — kelola key & status provider (sumber pool seleksi fusion).
 */
import { useEffect, useState } from 'react';
import {
  fetchConfig,
  fetchStatus,
  postConfig,
  postKey,
  type GatewayConfig,
  type StatusData,
} from '../../services/gatewayClient';

export function ProvidersView() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [config, setConfig] = useState<GatewayConfig | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [provider, setProvider] = useState('nvidia');
  const [keyDraft, setKeyDraft] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);

  const refresh = () => {
    Promise.all([fetchStatus(), fetchConfig()])
      .then(([s, c]) => {
        setStatus(s);
        setConfig(c);
        setFailure(null);
      })
      .catch((e) => setFailure(String(e)));
  };

  useEffect(refresh, []);

  const handleSaveKey = async () => {
    try {
      await postKey(provider, keyDraft);
      setFeedback(`Key ${provider} tersimpan di server (terenkripsi di keys.json).`);
      setKeyDraft('');
      refresh();
    } catch (e) {
      setFeedback(`Error: ${String(e)}`);
    }
  };

  const handleToggle = async (id: string) => {
    if (!config) return;
    try {
      const providers = config.providers.map((p) =>
        p.id === id ? { ...p, enabled: !p.enabled } : p,
      );
      await postConfig({ providers });
      refresh();
    } catch (e) {
      setFeedback(`Error: ${String(e)}`);
    }
  };

  if (failure !== null && !status) {
    return <p style={{ color: 'red' }}>Gateway tidak terjangkau: {failure}</p>;
  }
  if (!status || !config) return <p>Memuat provider…</p>;

  return (
    <div>
      <h2>🔌 AI Provider</h2>
      <p style={{ fontSize: 12, opacity: 0.7 }}>
        Semua provider dengan key aktif masuk SATU pool seleksi Fusion Tournament.
        Model ditemukan otomatis dari katalog masing-masing provider.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
        {status.providers.map((p) => (
          <div
            key={p.id}
            style={{
              border: '1px solid #333',
              borderRadius: 8,
              padding: '8px 10px',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              fontSize: 13,
            }}
          >
            <strong style={{ textTransform: 'capitalize', minWidth: 90 }}>{p.id}</strong>
            <span style={{ fontSize: 11, opacity: 0.7, flex: 1 }}>{p.baseUrl}</span>
            <span style={{ fontSize: 11 }}>{p.hasKey ? '🔑 key ada' : '⚠️ tanpa key'}</span>
            <button onClick={() => void handleToggle(p.id)} style={{ padding: '2px 10px' }}>
              {p.enabled ? 'Nonaktifkan' : 'Aktifkan'}
            </button>
          </div>
        ))}
      </div>

      <h3>Tambahkan / perbarui API key</h3>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label>
          Provider:
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            style={{ marginLeft: 6 }}
          >
            {status.providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id}
              </option>
            ))}
          </select>
        </label>
        <label style={{ flex: 1, minWidth: 220 }}>
          API key:
          <input
            type="password"
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.target.value)}
            placeholder="nvapi-... / sk-... / gsk_..."
            style={{ marginLeft: 6, width: '70%' }}
          />
        </label>
        <button onClick={() => void handleSaveKey()} style={{ padding: '6px 14px' }}>
          Simpan
        </button>
      </div>
      {feedback !== null && <p style={{ fontSize: 12 }}>{feedback}</p>}

      <h3 style={{ marginTop: 16 }}>Key tersimpan (redacted)</h3>
      {status.keys.length === 0 ? (
        <p style={{ fontSize: 12 }}>Belum ada key.</p>
      ) : (
        <ul style={{ fontSize: 12 }}>
          {status.keys.map((k) => (
            <li key={k.provider}>
              <strong>{k.provider}</strong> — {k.redacted}
            </li>
          ))}
        </ul>
      )}

      <p style={{ fontSize: 11, opacity: 0.6, marginTop: 16 }}>
        Model terdeteksi: {status.discoveredModels} (gabungan semua provider aktif).
      </p>
    </div>
  );
}