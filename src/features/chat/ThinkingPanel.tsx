/**
 * Thinking panel samping (gaya side-thinking):
 * live progress turnamen, reasoning streaming, skor, pemenang, validasi.
 */
import { useEffect, useRef } from 'react';
import type { TournamentTrace } from '../../services/gatewayClient';

export interface LiveState {
  content: string;
  reasoning: Record<string, string>;
  tournament: TournamentTrace & { progress?: { index: number; total: number; slug: string } };
  errorMsg?: string;
}

interface ThinkingPanelProps {
  live: LiveState | null;
  lastTrace?: { tournament?: TournamentTrace; durationMs?: number; modelUsed?: string } | null;
  onClose: () => void;
}

function short(slug: string): string {
  const m = slug.split('/').slice(1).join('/');
  return m.length > 30 ? `${m.slice(0, 30)}…` : m;
}

export function ThinkingPanel({ live, lastTrace, onClose }: ThinkingPanelProps) {
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [live?.content, live?.reasoning, live?.tournament]);

  const t = live?.tournament;
  const idle = !live;
  const lt = lastTrace?.tournament;

  return (
    <aside className="g-think">
      <header>
        <span>🧠 Proses berpikir</span>
        <button onClick={onClose} title="tutup">✕</button>
      </header>
      <div className="body" ref={bodyRef}>
        {idle && !lt && (
          <div className="g-tp-idle">
            Kirim pertanyaan untuk melihat proses seleksi AI secara live: fan-out → reasoning →
            skor judge → pemenang → jawaban.
          </div>
        )}

        {idle && lt && (
          <>
            <div className="g-tp-line">Seleksi terakhir ({lt.taskType ?? '?'})</div>
            <div className="g-tp-box">
              <div className="head"><span>kandidat</span><span>{(lt.candidates ?? []).length}</span></div>
              <div className="head"><span>mode</span><span>{lt.mode ?? 'all'}</span></div>
              <div className="head"><span>penilai</span><span>{(lt.judges ?? []).length} judge</span></div>
            </div>
            <div className="g-tp-box win">
              <div className="g-tp-winner">🏆 {lastTrace?.modelUsed ?? lt.winner}</div>
              <div className="head" style={{ marginTop: 6 }}>
                <span>validasi</span><span>{(lt.validation ?? []).join(' → ') || '-'}</span>
              </div>
            </div>
          </>
        )}

        {!idle && (
          <>
            {t?.progress && (
              <div className="g-tp-line">
                ⏳ Menilai {t.progress.index + 1}/{t.progress.total}: {short(t.progress.slug)}
              </div>
            )}

            {Object.entries(live?.reasoning ?? {}).slice(-4).map(([slug, text]) => (
              <div key={slug} className={`g-tp-box ${t?.winner === slug ? 'win' : ''}`}>
                <div className="head">
                  <span>🧠 {short(slug)}</span>
                  <span>
                    {t?.scores?.find((s) => s.model === slug)
                      ? `skor ${t.scores.find((s) => s.model === slug)?.score}`
                      : '…'}
                  </span>
                </div>
                <div className="txt">{text.slice(-500)}▍</div>
              </div>
            ))}

            {(t?.scores ?? []).length > 0 && (
              <div className="g-tp-box">
                <div className="head"><span>skor judge (median)</span><span /></div>
                {[...(t?.scores ?? [])]
                  .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
                  .map((s) => (
                    <div key={s.model} className="g-tp-score">
                      <span>{s.label} · {short(s.model)}</span>
                      <span>{s.score}{s.votes?.length ? ` (${s.votes.join(',')})` : ''}</span>
                    </div>
                  ))}
              </div>
            )}

            {t?.winner && <div className="g-tp-winner">🏆 {short(t.winner)}</div>}

            {(t?.validation ?? []).length > 0 && (
              <div className="g-tp-box">
                <div className="head"><span>validasi</span><span>{(t?.validation ?? []).join(' → ')}</span></div>
              </div>
            )}

            {live?.errorMsg && <div style={{ color: '#f87171' }}>⚠️ {live.errorMsg}</div>}
          </>
        )}
      </div>
    </aside>
  );
}