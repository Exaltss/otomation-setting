/**
 * Thinking panel gaya Qwen dengan indikator tool calls.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { TournamentTrace } from '../../services/gatewayClient';

export interface LiveState {
  content: string;
  reasoning: Record<string, string>;
  tournament: TournamentTrace & {
    progress?: { index: number; total: number; slug: string };
    toolCalls?: Array<{ name: string; params?: unknown; result?: unknown }>;
    toolResults?: Array<{ name: string; result?: unknown }>;
  };
  errorMsg?: string;
}

interface LastTrace {
  tournament?: TournamentTrace & { toolCalls?: Array<{ name: string }> };
  durationMs?: number;
  modelUsed?: string;
}

interface ThinkingPanelProps {
  live: LiveState | null;
  lastTrace?: LastTrace | null;
  onClose: () => void;
}

type StepState = 'pending' | 'active' | 'done';

interface Step {
  id: string;
  title: string;
  state: StepState;
  detail: string[];
}

function short(slug: string): string {
  const m = slug.split('/').slice(1).join('/');
  return m.length > 36 ? `${m.slice(0, 36)}…` : m;
}

export function ThinkingPanel({ live, lastTrace, onClose }: ThinkingPanelProps) {
  const [manualOpen, setManualOpen] = useState<Set<string>>(new Set());
  const [manualClosed, setManualClosed] = useState<Set<string>>(new Set());
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const t = live?.tournament;
  const idle = live === null;

  const steps: Step[] = useMemo(() => {
    const out: Step[] = [];

    if (!idle && t) {
      const candidates = t.candidates ?? [];
      const scores = t.scores ?? [];
      const validation = t.validation ?? [];
      const reasoningEntries = Object.entries(live?.reasoning ?? {});
      const hasWinner = typeof t.winner === 'string' && t.winner.length > 0;
      const hasContent = (live?.content ?? '').length > 0;
      const toolCallsList = t.toolCalls ?? [];
      const hasTools = toolCallsList.length > 0;

      out.push({
        id: 'classify',
        title: `Memahami permintaan (${t.taskType ?? '…'})`,
        state: candidates.length > 0 ? 'done' : 'active',
        detail: [`Jenis tugas: ${t.taskType ?? 'menganalisis…'}`, `Mode: ${t.mode ?? 'auto'}`],
      });

      out.push({
        id: 'fanout',
        title: t.progress
          ? `Menyeleksi model ${t.progress.index + 1}/${t.progress.total}`
          : `Menyeleksi ${candidates.length} model kandidat`,
        state: candidates.length === 0 ? 'pending' : scores.length > 0 || hasWinner ? 'done' : 'active',
        detail: [
          ...(t.progress ? [`Sedang: ${short(t.progress.slug)}`] : []),
          ...candidates.slice(0, 6).map((c) => `• ${short(c)}`),
          ...(candidates.length > 6 ? [`… +${candidates.length - 6} model lain`] : []),
        ],
      });

      out.push({
        id: 'reasoning',
        title: `Mengumpulkan reasoning (${reasoningEntries.length} model)`,
        state: reasoningEntries.length === 0 ? 'pending' : scores.length > 0 || hasWinner ? 'done' : 'active',
        detail: reasoningEntries.slice(-3).map(([slug, text]) => `${short(slug)}: ${text.slice(-140)}`),
      });

      out.push({
        id: 'judge',
        title: `Penilaian judge (${(t.judges ?? []).length} judge, median)`,
        state: scores.length === 0 ? 'pending' : hasWinner ? 'done' : 'active',
        detail: [...scores]
          .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
          .slice(0, 5)
          .map((s) => `${s.label ?? short(s.model)} → skor ${s.score}`),
      });

      out.push({
        id: 'winner',
        title: hasWinner ? `Pemenang: ${short(t.winner ?? '')}` : 'Menentukan pemenang',
        state: hasWinner ? 'done' : 'pending',
        detail: hasWinner ? [`🏆 ${t.winner}`] : [],
      });

      // TOOL CALLS STEP (BARU)
      out.push({
        id: 'tools',
        title: hasTools ? `🔧 Tool calls (${toolCallsList.length})` : '🔧 Tool calls',
        state: hasTools ? 'done' : hasWinner ? 'active' : 'pending',
        detail: toolCallsList.map((tc) => `🔧 ${tc.name} → ${JSON.stringify(tc.result ?? '').slice(0, 80)}`),
      });

      out.push({
        id: 'answer',
        title: 'Menulis jawaban final',
        state: hasContent ? 'done' : hasWinner ? 'active' : 'pending',
        detail: hasContent ? [`${(live?.content ?? '').length} karakter ditulis`] : [],
      });

      out.push({
        id: 'validate',
        title: 'Validasi & penyempurnaan',
        state: validation.length === 0 ? 'pending' : 'done',
        detail: validation.map((v) => `• ${v}`),
      });
    } else if (idle && lastTrace?.tournament) {
      const lt = lastTrace.tournament;
      const ltToolCalls = lt.toolCalls ?? [];

      out.push({
        id: 'classify',
        title: `Memahami permintaan (${lt.taskType ?? '?'})`,
        state: 'done',
        detail: [`Mode: ${lt.mode ?? 'auto'}`],
      });
      out.push({
        id: 'fanout',
        title: `Menyeleksi ${(lt.candidates ?? []).length} model kandidat`,
        state: 'done',
        detail: (lt.candidates ?? []).slice(0, 6).map((c) => `• ${short(c)}`),
      });
      out.push({
        id: 'reasoning',
        title: `Mengumpulkan reasoning (${(lt.mapping ?? []).length} model)`,
        state: 'done',
        detail: (lt.mapping ?? []).map((m) => `${m.label} = ${short(m.model)}`),
      });
      out.push({
        id: 'judge',
        title: `Penilaian judge (${(lt.judges ?? []).length} judge)`,
        state: 'done',
        detail: [...(lt.scores ?? [])]
          .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
          .slice(0, 5)
          .map((s) => `${s.label ?? short(s.model)} → skor ${s.score}`),
      });
      out.push({
        id: 'winner',
        title: `Pemenang: ${short(lastTrace.modelUsed ?? lt.winner ?? '')}`,
        state: 'done',
        detail: [`🏆 ${lastTrace.modelUsed ?? lt.winner}`],
      });
      out.push({
        id: 'tools',
        title: `🔧 Tool calls (${ltToolCalls.length})`,
        state: ltToolCalls.length > 0 ? 'done' : 'pending',
        detail: ltToolCalls.map((tc) => `🔧 ${tc.name}`),
      });
      out.push({
        id: 'answer',
        title: 'Menulis jawaban final',
        state: 'done',
        detail: [],
      });
      out.push({
        id: 'validate',
        title: 'Validasi & penyempurnaan',
        state: 'done',
        detail: (lt.validation ?? []).map((v) => `• ${v}`),
      });
    }

    return out;
  }, [idle, t, live, lastTrace]);

  const activeId = useMemo(() => steps.find((s) => s.state === 'active')?.id, [steps]);
  const openSteps = useMemo(() => {
    const base = new Set(manualOpen);
    if (activeId && !manualClosed.has(activeId)) base.add(activeId);
    return base;
  }, [manualOpen, manualClosed, activeId]);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (atBottom) {
      el.scrollTo({ top: el.scrollHeight });
    }
  }, [live?.content, live?.reasoning, live?.tournament, openSteps]);

  const toggle = (id: string) => {
    const isOpen = openSteps.has(id);
    setManualOpen((prev) => {
      const next = new Set(prev);
      if (isOpen) next.delete(id);
      else next.add(id);
      return next;
    });
    setManualClosed((prev) => {
      const next = new Set(prev);
      if (isOpen && id === activeId) next.add(id);
      else if (!isOpen) next.delete(id);
      return next;
    });
  };

  return (
    <aside className="g-think">
      <header>
        <span>💡 Thinking</span>
        <button onClick={onClose} title="tutup">✕</button>
      </header>
      <div className="body" ref={bodyRef}>
        {steps.length === 0 && (
          <div className="g-tp-idle">
            Kirim pertanyaan untuk melihat proses berpikir AI langkah demi langkah:
            seleksi model → reasoning → penilaian judge → tool calls → jawaban.
          </div>
        )}

        <ol className="g-steps">
          {steps.map((s) => (
            <li key={s.id} className={`g-step ${s.state}`}>
              <button className="g-step-head" onClick={() => toggle(s.id)}>
                <span className="g-step-ico">{s.state === 'done' ? '✓' : s.state === 'active' ? '●' : '○'}</span>
                <span className="g-step-title">{s.title}</span>
              </button>
              {openSteps.has(s.id) && s.detail.length > 0 && (
                <div className="g-step-detail">
                  {s.detail.map((d, i) => (
                    <p key={i}>{d}</p>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ol>

        {live?.errorMsg && <div className="g-tp-err">⚠️ {live.errorMsg}</div>}
      </div>
    </aside>
  );
}