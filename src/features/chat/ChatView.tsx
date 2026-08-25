/**
 * Chat — wajah utama. Streaming SSE dari gateway:
 * progress evaluasi semua model -> reasoning live -> skor judge -> pemenang -> jawaban.
 * Dropdown model menampilkan SEMUA model dari semua provider ber-key.
 */
import { useEffect, useRef, useState } from 'react';
import { SelectionMap } from '../views/SelectionMap';

const GATEWAY = 'http://localhost:4123';

interface LiveTournament {
  taskType?: string;
  candidates?: string[];
  mapping?: { label: string; model: string }[];
  scores?: { model: string; label?: string; score: number }[];
  winner?: string | null;
  stragglers?: string[];
  validation?: string[];
  synthesis?: boolean;
}

interface OtoTrace {
  tier?: string;
  providerUsed?: string;
  modelUsed?: string;
  durationMs?: number;
  usageToday?: number;
  tournament?: LiveTournament;
}

interface LiveState {
  content: string;
  reasoning: Record<string, string>;
  reasoningErrors: Record<string, string>;
  tournament: LiveTournament;
  progress?: { index: number; total: number; slug: string };
  errorMsg?: string;
  trace?: OtoTrace;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  trace?: OtoTrace;
  failed?: boolean;
}

function shortSlug(slug: string): string {
  const model = slug.split('/').slice(1).join('/');
  return model.length > 26 ? `${model.slice(0, 26)}…` : model;
}

export function ChatView() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [selected, setSelected] = useState('auto');
  const [live, setLive] = useState<LiveState | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Muat katalog model + refetch berkala (pulih saat gateway restart)
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch(`${GATEWAY}/v1/models`)
        .then((r) => r.json())
        .then((d) => {
          if (!cancelled) setModels((d.data ?? []).map((m: { id: string }) => m.id));
        })
        .catch(() => {});
    };
    load();
    const timer = setInterval(load, 20000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, live]);

  // Kelompokkan model per provider untuk optgroup
  const grouped = models.reduce<Record<string, string[]>>((accMap, slug) => {
    const prov = slug.split('/')[0];
    if (!accMap[prov]) accMap[prov] = [];
    accMap[prov].push(slug);
    return accMap;
  }, {});

  const handleSend = async () => {
    const question = draft.trim();
    if (question.length === 0 || busy) return;

    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: question };
    const history = messages
      .filter((m) => !m.failed)
      .map((m) => ({ role: m.role, content: m.content }));

    setMessages((prev) => [...prev, userMessage]);
    setDraft('');
    setBusy(true);

    const acc: LiveState = { content: '', reasoning: {}, reasoningErrors: {}, tournament: {} };
    setLive({ ...acc });

    try {
      const res = await fetch(`${GATEWAY}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...history, { role: 'user', content: question }],
          model: selected,
          stream: true,
        }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error?.message ?? `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('event:')) {
            currentEvent = trimmed.slice(6).trim();
            continue;
          }
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') continue;

          let data: Record<string, unknown>;
          try {
            data = JSON.parse(payload);
          } catch {
            continue;
          }

          if (currentEvent === 'reasoning') {
            if (typeof data.delta === 'string') {
              const slug = String(data.slug ?? '');
              acc.reasoning[slug] = (acc.reasoning[slug] ?? '') + data.delta;
            }
            if (typeof data.error === 'string') {
              acc.reasoningErrors[String(data.slug ?? '')] = data.error;
            }
            setLive({ ...acc, reasoning: { ...acc.reasoning } });
          } else if (currentEvent === 'tournament') {
            if (data.type === 'fanout') {
              acc.tournament.taskType = String(data.taskType ?? '');
              acc.tournament.candidates = Array.isArray(data.candidates) ? (data.candidates as string[]) : [];
            }
            if (data.type === 'progress') {
              acc.progress = {
                index: Number(data.index ?? 0),
                total: Number(data.total ?? 0),
                slug: String(data.slug ?? ''),
              };
            }
            if (data.type === 'quorum') {
              acc.tournament.stragglers = Array.isArray(data.stragglers) ? (data.stragglers as string[]) : [];
            }
            if (data.type === 'mapping') {
              acc.tournament.mapping = Array.isArray(data.mapping)
                ? (data.mapping as { label: string; model: string }[])
                : [];
            }
            if (data.type === 'score') {
              const entry = {
                model: String(data.slug ?? ''),
                label: String(data.label ?? ''),
                score: Number(data.score ?? 0),
              };
              acc.tournament.scores = [...(acc.tournament.scores ?? []), entry];
            }
            if (data.type === 'winner') {
              acc.tournament.winner = String(data.winner ?? '');
              acc.tournament.synthesis = Boolean(data.synthesis);
              acc.progress = undefined;
            }
            if (data.type === 'validation') {
              acc.tournament.validation = Array.isArray(data.validation) ? (data.validation as string[]) : [];
            }
            if (data.type === 'error') {
              acc.errorMsg = String(data.message ?? 'terjadi kesalahan turnamen');
            }
            setLive({ ...acc, tournament: { ...acc.tournament } });
          } else if (currentEvent === 'answer_reset') {
            acc.content = '';
            setLive({ ...acc });
          } else if (currentEvent === 'otomation_trace') {
            acc.trace = data as OtoTrace;
            setLive({ ...acc });
          } else {
            const delta = (data?.choices as { delta?: { content?: string } }[])?.[0]?.delta;
            if (typeof delta?.content === 'string') {
              acc.content += delta.content;
              setLive({ ...acc });
            }
          }
        }
      }

      const finalContent =
        acc.content || (acc.errorMsg ? `⚠️ ${acc.errorMsg}` : '(tidak ada output)');

      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: finalContent,
          reasoning:
            Object.values(acc.reasoning).length > 0
              ? Object.values(acc.reasoning).join('\n---\n')
              : undefined,
          trace: acc.trace,
          failed: Boolean(acc.errorMsg),
        },
      ]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `⚠️ ${String(error)} — pastikan "node server/gateway.mjs" berjalan.`,
          failed: true,
        },
      ]);
    }

    setLive(null);
    setBusy(false);
  };

  const lastTrace = [...messages].reverse().find((m) => m.trace)?.trace;
  const liveTournament = live?.tournament ?? lastTrace?.tournament ?? null;

  const reasoningEntries = Object.entries(live?.reasoning ?? {}).slice(-3);

  return (
    <div>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px' }}>
        <label>
          Model:
          <select
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
            style={{ marginLeft: '6px', maxWidth: 320 }}
          >
            <option value="auto">auto (Fusion Tournament — semua model)</option>
            {Object.entries(grouped).map(([prov, list]) => (
              <optgroup key={prov} label={prov}>
                {list.map((id) => (
                  <option key={id} value={id}>
                    {id.split('/').slice(1).join('/')}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <span style={{ fontSize: '12px', opacity: 0.7 }}>
          {models.length} model tersedia · auto = semua dinilai, judge memilih terbaik.
        </span>
      </div>

      <div
        style={{
          border: '1px solid #333',
          borderRadius: '8px',
          padding: '12px',
          minHeight: '320px',
          maxHeight: '560px',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}
      >
        {messages.length === 0 && !live && (
          <p style={{ opacity: 0.6 }}>
            Tanya apa saja — semua model dari semua provider akan dinilai satu per satu,
            dan jawaban terbaik yang dikeluarkan.
          </p>
        )}

        {messages.map((m) => (
          <div
            key={m.id}
            style={{
              alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '85%',
              background: m.role === 'user' ? '#1d4ed8' : '#1f2937',
              padding: '8px 12px',
              borderRadius: '10px',
            }}
          >
            <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>

            {m.trace?.tournament && (
              <details style={{ marginTop: '8px', fontSize: '12px', opacity: 0.95 }}>
                <summary style={{ cursor: 'pointer' }}>🧠 proses berpikir & seleksi AI</summary>
                <ul style={{ margin: '6px 0 0', paddingLeft: '18px' }}>
                  <li>tugas: {m.trace.tournament.taskType}</li>
                  <li>total kandidat: {(m.trace.tournament.candidates ?? []).length} model</li>
                  <li>
                    dinilai: {(m.trace.tournament.scores ?? []).length} · gagal:{' '}
                    {(m.trace.tournament.stragglers ?? []).length}
                  </li>
                  {(m.trace.tournament.scores ?? []).length > 0 && (
                    <li>
                      skor:{' '}
                      {[...(m.trace.tournament.scores ?? [])]
                        .sort((a, b) => b.score - a.score)
                        .slice(0, 5)
                        .map((s) => `${s.label ?? shortSlug(s.model)}:${s.score}`)
                        .join(' · ')}
                    </li>
                  )}
                  <li>pemenang: {m.trace.tournament.winner}</li>
                  <li>validasi: {(m.trace.tournament.validation ?? []).join(' → ')}</li>
                </ul>
              </details>
            )}

            {m.reasoning && (
              <details style={{ marginTop: '6px', fontSize: '12px' }}>
                <summary style={{ cursor: 'pointer' }}>reasoning mentah</summary>
                <pre
                  style={{
                    whiteSpace: 'pre-wrap',
                    background: '#111',
                    padding: '8px',
                    borderRadius: '6px',
                    maxHeight: '220px',
                    overflowY: 'auto',
                  }}
                >
                  {m.reasoning}
                </pre>
              </details>
            )}
          </div>
        ))}

        {live && (
          <div
            style={{
              alignSelf: 'flex-start',
              maxWidth: '92%',
              background: '#1f2937',
              padding: '8px 12px',
              borderRadius: '10px',
            }}
          >
            {live.progress && (
              <div style={{ fontSize: 12, color: '#fb923c', marginBottom: 6 }}>
                ⏳ Menilai model {live.progress.index + 1}/{live.progress.total}:{' '}
                {shortSlug(live.progress.slug)}
              </div>
            )}

            {reasoningEntries.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                {reasoningEntries.map(([slug, text]) => {
                  const label =
                    live.tournament.mapping?.find((mp) => mp.model === slug)?.label ??
                    shortSlug(slug);
                  const isWinner = live.tournament.winner === slug;
                  const score = live.tournament.scores?.find((s) => s.model === slug)?.score;
                  return (
                    <div
                      key={slug}
                      style={{
                        border: `1px solid ${isWinner ? '#4ade80' : '#333'}`,
                        borderRadius: 6,
                        padding: 6,
                        fontSize: 11,
                      }}
                    >
                      <strong style={{ color: isWinner ? '#4ade80' : '#fb923c' }}>
                        🧠 {label}
                      </strong>{' '}
                      <span style={{ opacity: 0.6 }}>
                        {shortSlug(slug)}
                        {score !== undefined ? ` · skor ${score}` : ''}
                      </span>
                      <div
                        style={{
                          whiteSpace: 'pre-wrap',
                          maxHeight: 90,
                          overflow: 'hidden',
                          opacity: 0.85,
                        }}
                      >
                        {text.slice(-400)}▍
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {live.errorMsg && (
              <div style={{ color: '#f87171', fontSize: 12, marginBottom: 6 }}>⚠️ {live.errorMsg}</div>
            )}

            <div style={{ whiteSpace: 'pre-wrap' }}>{live.content}▍</div>
          </div>
        )}

        {busy && (
          <p style={{ opacity: 0.6 }}>
            Fusion: evaluasi semua model → judge → pemenang → jawaban final…
          </p>
        )}
        <div ref={bottomRef} />
      </div>

      <SelectionMap tournament={liveTournament} />

      <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
        <input
          style={{ flex: 1, padding: '8px' }}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void handleSend();
          }}
          placeholder="Tulis pertanyaan…"
        />
        <button onClick={() => void handleSend()} disabled={busy} style={{ padding: '8px 16px' }}>
          Kirim
        </button>
      </div>
    </div>
  );
}