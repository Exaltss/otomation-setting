/**
 * Statistik — kartu penggunaan + rincian proses penyeleksian per request.
 * (Visual live seleksi kini berada di bawah Chat.)
 */
import { useEffect, useState } from 'react';
import { fetchStatus, type HistoryEntry, type StatusData } from '../../services/gatewayClient';

function TournamentFlow({ entry }: { entry: HistoryEntry }) {
  const t = entry.tournament;
  if (!t) return null;

  const labelOf = (model: string) =>
    (t.mapping ?? []).find((m) => m.model === model)?.label ?? model;

  return (
    <div style={{ marginTop: '6px', fontSize: '11px', opacity: 0.9 }}>
      <div>🎯 tugas: {t.taskType}</div>
      <div>① fan-out: {(t.candidates ?? []).join(' · ')}</div>
      {(t.scores ?? []).length > 0 && (
        <div>
          ② skor panel:{' '}
          {(t.scores ?? []).map((s) => `${s.label ?? labelOf(s.model)}:${s.score}`).join(' · ')}
        </div>
      )}
      <div>
        ③ mode: {t.synthesis ? 'Fusion (sintesis judge)' : 'single survivor'} → 🏆{' '}
        {t.winner ?? entry.model}
      </div>
      {(t.validation ?? []).length > 0 && <div>④ validasi: {(t.validation ?? []).join(' → ')}</div>}
      {(t.stragglers ?? []).length > 0 && (
        <div style={{ opacity: 0.7 }}>straggler (quorum): {(t.stragglers ?? []).join(' · ')}</div>
      )}
    </div>
  );
}

export function StatsView() {
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
  if (!status) return <p>Memuat statistik…</p>;

  const okRequests = status.history.filter((h) => h.status === 'ok');
  const okTokens = status.usage.totalTokens;
  const limit = status.creditLimitPerDay;
  const pct = Math.min(100, Math.round((okTokens / limit) * 100));

  return (
    <div>
      <h2>📊 Statistik Penggunaan</h2>

      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '16px' }}>
        <div style={{ border: '1px solid #333', borderRadius: 8, padding: '10px 14px', minWidth: 140 }}>
          <div style={{ fontSize: 11, opacity: 0.7 }}>TOTAL REQUESTS (riwayat)</div>
          <div style={{ fontSize: 20 }}>{okRequests.length}</div>
        </div>
        <div style={{ border: '1px solid #333', borderRadius: 8, padding: '10px 14px', minWidth: 140 }}>
          <div style={{ fontSize: 11, opacity: 0.7 }}>TOTAL TOKENS HARI INI</div>
          <div style={{ fontSize: 20, color: '#fb923c' }}>{okTokens}</div>
        </div>
        <div style={{ border: '1px solid #333', borderRadius: 8, padding: '10px 14px', minWidth: 140 }}>
          <div style={{ fontSize: 11, opacity: 0.7 }}>MODEL HANGAT (keep-warm)</div>
          <div style={{ fontSize: 12 }}>{status.warmModel ?? '-'}</div>
        </div>
        <div style={{ border: '1px solid #333', borderRadius: 8, padding: '10px 14px', minWidth: 140 }}>
          <div style={{ fontSize: 11, opacity: 0.7 }}>EST. COST</div>
          <div style={{ fontSize: 20, color: '#facc15' }}>~$0.00</div>
          <div style={{ fontSize: 10, opacity: 0.6 }}>free tier NVIDIA</div>
        </div>
        <div style={{ border: '1px solid #333', borderRadius: 8, padding: '10px 14px', minWidth: 200 }}>
          <div style={{ fontSize: 11, opacity: 0.7 }}>CREDIT GUARD: {okTokens} / {limit}</div>
          <div style={{ background: '#111', borderRadius: 4, height: 8, marginTop: 6 }}>
            <div
              style={{
                width: `${pct}%`,
                height: 8,
                borderRadius: 4,
                background: pct < 60 ? '#4ade80' : pct < 90 ? '#fbbf24' : '#f87171',
              }}
            />
          </div>
        </div>
      </div>

      <h3>Proses Perpindahan & Penyeleksian AI (request terbaru)</h3>
      {status.history.length === 0 ? (
        <p>Belum ada request.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {status.history.slice(0, 10).map((entry) => (
            <div
              key={entry.id}
              style={{ border: '1px solid #333', borderRadius: 8, padding: '8px 10px', fontSize: 12 }}
            >
              <div>
                <strong style={{ color: entry.status === 'ok' ? '#4ade80' : '#f87171' }}>
                  {entry.status}
                </strong>{' '}
                {new Date(entry.at).toLocaleTimeString()} — {entry.model}{' '}
                {entry.tier ? `(tier ${entry.tier})` : ''} — {entry.estimatedTokens} token —{' '}
                {entry.durationMs} ms
              </div>
              <TournamentFlow entry={entry} />
              <div style={{ opacity: 0.7, marginTop: 4 }}>{entry.message}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}