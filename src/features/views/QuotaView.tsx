/**
 * Pelacakan Kuota — AI mana yang bisa dipakai SEKARANG.
 * Gabungan: enabled + key + pemakaian harian + circuit breaker.
 */
import { useEffect, useState } from 'react';
import { fetchStatus, type ProviderInfo, type StatusData } from '../../services/gatewayClient';

function availability(p: ProviderInfo, status: StatusData): { ok: boolean; label: string } {
  if (!p.enabled) return { ok: false, label: 'dinonaktifkan' };
  if (!p.hasKey) return { ok: false, label: 'belum ada API key' };
  const used = status.usage.perProvider[p.id] ?? 0;
  if (used >= status.creditLimitPerDay) return { ok: false, label: 'kuota harian habis' };
  return { ok: true, label: 'tersedia sekarang' };
}

export function QuotaView() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetchStatus()
        .then((s) => {
          if (!cancelled) {
            setStatus(s);
            setFailure(null);
          }
        })
        .catch((e) => {
          if (!cancelled) setFailure(String(e));
        });
    };
    load();
    const timer = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (failure !== null) {
    return <p style={{ color: 'red' }}>Gateway tidak terjangkau: {failure}</p>;
  }
  if (!status) return <p>Memuat kuota…</p>;

  const openCircuits = status.circuit.filter((c) => c.open);

  return (
    <div>
      <h2>📡 Pelacakan Kuota</h2>
      <p style={{ fontSize: 12, opacity: 0.7 }}>
        Mengetahui AI mana yang dapat digunakan saat ini (key + status + pemakaian harian +
        circuit breaker).
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
        {status.providers.map((p) => {
          const state = availability(p, status);
          const used = status.usage.perProvider[p.id] ?? 0;
          const limit = status.creditLimitPerDay;
          const remainingPct = Math.max(0, 100 - Math.min(100, Math.round((used / limit) * 100)));
          const barColor = remainingPct > 40 ? '#4ade80' : remainingPct > 10 ? '#fbbf24' : '#f87171';

          return (
            <div key={p.id} style={{ border: '1px solid #333', borderRadius: 8, padding: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: state.ok ? '#4ade80' : '#f87171',
                    display: 'inline-block',
                  }}
                />
                <strong style={{ textTransform: 'capitalize' }}>{p.id}</strong>
                <span style={{ fontSize: 11, opacity: 0.7, marginLeft: 'auto' }}>{state.label}</span>
              </div>

              <div style={{ fontSize: 11, opacity: 0.7, margin: '6px 0' }}>{p.baseUrl}</div>

              <div style={{ background: '#111', borderRadius: 4, height: 8 }}>
                <div style={{ width: `${remainingPct}%`, height: 8, borderRadius: 4, background: barColor }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginTop: 4 }}>
                <span>
                  {used} / {limit} token
                </span>
                <span style={{ color: barColor }}>{remainingPct}%</span>
              </div>
            </div>
          );
        })}
      </div>

      <h3 style={{ marginTop: 16 }}>Cooldown model (circuit breaker)</h3>
      {openCircuits.length === 0 ? (
        <p style={{ fontSize: 12, opacity: 0.7 }}>Tidak ada model yang di-cooldown. Semua sehat.</p>
      ) : (
        <ul style={{ fontSize: 12 }}>
          {openCircuits.map((c) => (
            <li key={c.slug}>
              ⛔ {c.slug} — cooldown {Math.ceil(c.remainingMs / 1000)} dtk lagi
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}