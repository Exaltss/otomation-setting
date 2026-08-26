/**
 * Setting — editor konfigurasi gateway (credit guard, keep-warm, turnamen).
 * Manajemen API key ada di menu 🔌 AI Provider.
 */
import { useEffect, useState } from 'react';
import { fetchConfig, postConfig } from '../../services/gatewayClient';

interface GwConfig {
  creditLimitPerDay: number;
  keepWarm: boolean;
  keepWarmIntervalMs: number;
  tournament: { enabled: boolean; size: number; maxRefineLoops: number };
  [key: string]: unknown;
}

export function SettingsView() {
  const [cfg, setCfg] = useState<GwConfig | null>(null);
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    fetchConfig()
      .then((c) => setCfg(c as unknown as GwConfig))
      .catch(() => setFeedback('⚠️ Gateway tidak terjangkau — jalankan "node server/gateway.mjs"'));
  }, []);

  const save = async (patch: Partial<GwConfig>) => {
    if (!cfg) return;
    const next = { ...cfg, ...patch };
    setCfg(next);
    try {
      await postConfig(next);
      setFeedback('Tersimpan ✓');
    } catch (e) {
      setFeedback(`⚠️ ${String(e)}`);
    }
  };

  if (!cfg) return <p>Memuat setting… {feedback}</p>;

  return (
    <div>
      <h2>⚙️ Setting</h2>

      <h3>Credit Guard</h3>
      <label>
        Limit token per hari:{' '}
        <input
          type="number"
          value={cfg.creditLimitPerDay}
          onChange={(e) => void save({ creditLimitPerDay: Number(e.target.value) || 100000 })}
          style={{ width: 120 }}
        />
      </label>

      <h3>Keep-Warm</h3>
      <label>
        <input
          type="checkbox"
          checked={cfg.keepWarm}
          onChange={(e) => void save({ keepWarm: e.target.checked })}
        />{' '}
        Aktifkan keep-warm model pemenang
      </label>
      <br />
      <label>
        Interval (ms, min 60000):{' '}
        <input
          type="number"
          value={cfg.keepWarmIntervalMs}
          onChange={(e) => void save({ keepWarmIntervalMs: Math.max(60000, Number(e.target.value) || 600000) })}
          style={{ width: 120 }}
        />
      </label>

      <h3>Fusion Tournament</h3>
      <label>
        <input
          type="checkbox"
          checked={cfg.tournament?.enabled ?? true}
          onChange={(e) => void save({ tournament: { ...cfg.tournament, enabled: e.target.checked } })}
        />{' '}
        Aktifkan turnamen
      </label>
      <br />
      <label>
        Maks kandidat:{' '}
        <input
          type="number"
          value={cfg.tournament?.size ?? 3}
          onChange={(e) => void save({ tournament: { ...cfg.tournament, size: Number(e.target.value) || 3 } })}
          style={{ width: 80 }}
        />
      </label>{' '}
      <label>
        Maks refine loop:{' '}
        <input
          type="number"
          value={cfg.tournament?.maxRefineLoops ?? 2}
          onChange={(e) =>
            void save({ tournament: { ...cfg.tournament, maxRefineLoops: Number(e.target.value) || 2 } })
          }
          style={{ width: 80 }}
        />
      </label>

      <p style={{ marginTop: 16 }}>{feedback}</p>
      <p style={{ opacity: 0.6, fontSize: 12 }}>
        Manajemen API key pindah ke menu 🔌 AI Provider.
      </p>
    </div>
  );
}