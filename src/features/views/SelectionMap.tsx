/**
 * SelectionMap — visual LIVE seleksi AI.
 * Level 1: radial provider (klik untuk drill-down).
 * Level 2: grid chip semua model provider, berurutan sesuai antrean evaluasi,
 *          dengan nomor urut, skor, dan pemenang.
 */
import { useEffect, useState } from 'react';
import { fetchStatus, GATEWAY, type StatusData } from '../../services/gatewayClient';

interface TournamentLike {
  candidates?: string[];
  scores?: { model: string; label?: string; score: number }[];
  winner?: string | null;
  stragglers?: string[];
}

interface SelectionMapProps {
  tournament: TournamentLike | null;
}

function shortModel(slug: string): string {
  const model = slug.split('/').slice(1).join('/');
  return model.length > 24 ? `${model.slice(0, 24)}…` : model;
}

export function SelectionMap({ tournament }: SelectionMapProps) {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetchStatus()
        .then((s) => {
          if (!cancelled) setStatus(s);
        })
        .catch(() => {});
    };
    load();
    const timer = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    fetch(`${GATEWAY}/v1/models`)
      .then((r) => r.json())
      .then((d) => setModels((d.data ?? []).map((m: { id: string }) => m.id)))
      .catch(() => {});
  }, []);

  const candidates = tournament?.candidates ?? [];
  const winner = tournament?.winner ?? null;
  const brokenSet = new Set((status?.circuit ?? []).filter((c) => c.open).map((c) => c.slug));

  const providerNodes = (status?.providers ?? []).map((p) => p.id);

  const providerState = (pid: string) => {
    const win = winner ? winner.startsWith(`${pid}/`) : false;
    const cand = candidates.some((c) => c.startsWith(`${pid}/`));
    const broken = [...brokenSet].some((s) => s.startsWith(`${pid}/`));
    return { win, cand, broken };
  };

  const W = 860;
  const H = 360;
  const CX = W / 2;
  const CY = H / 2;
  const R = 130;

  const drillModels = selected === null ? [] : models.filter((m) => m.startsWith(`${selected}/`));

  return (
    <div style={{ marginTop: 12 }}>
      {selected !== null && (
        <button
          onClick={() => setSelected(null)}
          style={{ marginBottom: 6, padding: '2px 10px', fontSize: 12 }}
        >
          ← semua provider
        </button>
      )}

      {selected === null ? (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          style={{ width: '100%', background: '#0b0d10', borderRadius: 8, border: '1px solid #222' }}
        >
          {providerNodes.map((id, i) => {
            const angle = (i / Math.max(1, providerNodes.length)) * Math.PI * 2 - Math.PI / 2;
            const x = CX + R * Math.cos(angle);
            const y = CY + R * Math.sin(angle);
            const st = providerState(id);
            const stroke = st.win ? '#4ade80' : st.cand ? '#fb923c' : st.broken ? '#7f1d1d' : '#1f2a30';
            return (
              <line
                key={`l-${id}`}
                x1={CX}
                y1={CY}
                x2={x}
                y2={y}
                stroke={stroke}
                strokeWidth={st.win ? 3 : st.cand ? 2 : 1}
                style={{ transition: 'stroke 0.4s' }}
              />
            );
          })}

          <rect x={CX - 62} y={CY - 18} width={124} height={36} rx={9} fill="#1f2937" stroke="#fb923c" strokeWidth={2} />
          <text x={CX} y={CY + 5} textAnchor="middle" fill="#fb923c" fontSize={13} fontWeight={700}>
            ⚙ otomation GW
          </text>

          {providerNodes.map((id, i) => {
            const angle = (i / Math.max(1, providerNodes.length)) * Math.PI * 2 - Math.PI / 2;
            const x = CX + R * Math.cos(angle);
            const y = CY + R * Math.sin(angle);
            const st = providerState(id);
            const stroke = st.win ? '#4ade80' : st.cand ? '#fb923c' : st.broken ? '#f87171' : '#37474f';
            const fill = st.win ? '#052e16' : st.cand ? '#431407' : '#161b22';
            return (
              <g
                key={`n-${id}`}
                onClick={() => setSelected(id)}
                style={{ cursor: 'pointer' }}
              >
                <rect
                  x={x - 74}
                  y={y - 14}
                  width={148}
                  height={28}
                  rx={7}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={st.win || st.cand ? 2 : 1}
                />
                <text
                  x={x}
                  y={y + 4}
                  textAnchor="middle"
                  fill={st.win ? '#4ade80' : st.cand ? '#fb923c' : '#90a4ae'}
                  fontSize={11}
                >
                  {st.win ? '🏆 ' : st.cand ? '⚡ ' : ''}
                  {id}
                </text>
              </g>
            );
          })}
        </svg>
      ) : (
        <div
          style={{
            border: '1px solid #222',
            borderRadius: 8,
            background: '#0b0d10',
            padding: 10,
            maxHeight: 260,
            overflowY: 'auto',
          }}
        >
          <div style={{ fontSize: 12, marginBottom: 8, opacity: 0.8 }}>
            Provider <strong>{selected}</strong> — {drillModels.length} model · urutan = antrean
            evaluasi turnamen
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {drillModels.map((slug) => {
              const order = candidates.indexOf(slug);
              const inTournament = order >= 0;
              const score = tournament?.scores?.find((s) => s.model === slug)?.score;
              const isWin = winner === slug;
              const failed = (tournament?.stragglers ?? []).includes(slug);
              const border = isWin ? '#4ade80' : inTournament ? '#fb923c' : failed ? '#7f1d1d' : '#263238';
              const bg = isWin ? '#052e16' : inTournament ? '#431407' : '#10151a';
              return (
                <div
                  key={slug}
                  style={{
                    border: `1px solid ${border}`,
                    background: bg,
                    borderRadius: 6,
                    padding: '3px 8px',
                    fontSize: 10,
                    color: isWin ? '#4ade80' : inTournament ? '#fb923c' : '#78909c',
                  }}
                >
                  {inTournament ? `#${order + 1} ` : ''}
                  {shortModel(slug)}
                  {score !== undefined ? ` · ${score}` : ''}
                  {isWin ? ' 🏆' : failed ? ' ⛔' : ''}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ fontSize: 11, opacity: 0.75, marginTop: 4 }}>
        {selected === null
          ? 'Klik provider untuk melihat seluruh modelnya + jalur seleksi. (⚡ ikut turnamen · 🏆 pemenang · ⛔ gagal)'
          : `#${'n'} = urutan evaluasi · angka = skor judge · 🏆 pemenang · ⛔ gagal/cooldown`}
      </div>
    </div>
  );
}