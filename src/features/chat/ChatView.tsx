/**
 * Chat UI gaya Gemini: greeting tengah saat kosong, input pill,
 * model selector combo, thinking panel samping live,
 * jawaban dirender sebagai markdown (code block rapi).
 */
import { useEffect, useRef, useState } from 'react';
import {
  fetchStatus,
  GATEWAY,
  type ProviderInfo,
  type StatusData,
  type TournamentTrace,
} from '../../services/gatewayClient';
import type { ChatTrace, ChatsApi } from '../../services/chatStore';
import { ModelSelector } from './ModelSelector';
import { ThinkingPanel, type LiveState } from './ThinkingPanel';
import { Markdown } from './Markdown';

interface LastTrace {
  tournament?: TournamentTrace;
  durationMs?: number;
  modelUsed?: string;
}

function short(slug: string): string {
  const m = slug.split('/').slice(1).join('/');
  return m.length > 26 ? `${m.slice(0, 26)}…` : m;
}

export function ChatView({ chatsApi }: { chatsApi: ChatsApi }) {
  const { active, ensureChat, updateChat } = chatsApi;

  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [selected, setSelected] = useState('auto');
  const [live, setLive] = useState<LiveState | null>(null);
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const [lastTrace, setLastTrace] = useState<LastTrace | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch(`${GATEWAY}/v1/models`)
        .then((r) => r.json())
        .then((d) => {
          if (!cancelled) setModels((d.data ?? []).map((m: { id: string }) => m.id));
        })
        .catch(() => {});
      fetchStatus()
        .then((s: StatusData) => {
          if (!cancelled) setProviders(s.providers ?? []);
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
  }, [active?.messages, live]);

  const handleSend = async () => {
    const question = draft.trim();
    if (question.length === 0 || busy) return;

    const chatId = ensureChat(question);
    const userMsg = { id: crypto.randomUUID(), role: 'user' as const, content: question };
    updateChat(chatId, (c) => ({ ...c, messages: [...c.messages, userMsg] }));
    setDraft('');
    setBusy(true);
    setThinkingOpen(true);

    const acc: LiveState = { content: '', reasoning: {}, tournament: {} };
    setLive({ ...acc });

    let finalTrace: ChatTrace | undefined;

    const history = (active?.messages ?? [])
      .filter((m) => !m.failed)
      .map((m) => ({ role: m.role, content: m.content }));

    const body: Record<string, unknown> = {
      messages: [...history, { role: 'user', content: question }],
      stream: true,
    };

    if (selected === 'auto') {
      body.model = 'auto';
    } else if (selected.startsWith('fusion:')) {
      body.model = 'auto';
      body.fusionProvider = selected.slice(7);
    } else if (selected.startsWith('combo:')) {
      body.model = 'auto';
      body.comboId = selected.slice(6);
    } else {
      body.model = selected;
    }

    try {
      const res = await fetch(`${GATEWAY}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
            setLive({ ...acc, reasoning: { ...acc.reasoning } });
          } else if (currentEvent === 'tournament') {
            if (data.type === 'fanout') {
              acc.tournament.taskType = String(data.taskType ?? '');
              acc.tournament.candidates = Array.isArray(data.candidates) ? (data.candidates as string[]) : [];
              acc.tournament.mode = String(data.mode ?? '');
            }
            if (data.type === 'progress') {
              acc.tournament.progress = {
                index: Number(data.index ?? 0),
                total: Number(data.total ?? 0),
                slug: String(data.slug ?? ''),
              };
            }
            if (data.type === 'judges') {
              acc.tournament.judges = Array.isArray(data.judges) ? (data.judges as string[]) : [];
            }
            if (data.type === 'mapping') {
              acc.tournament.mapping = Array.isArray(data.mapping)
                ? (data.mapping as { label: string; model: string }[])
                : [];
            }
            if (data.type === 'score') {
              acc.tournament.scores = [
                ...(acc.tournament.scores ?? []),
                {
                  model: String(data.slug ?? ''),
                  label: String(data.label ?? ''),
                  score: Number(data.score ?? 0),
                },
              ];
            }
            if (data.type === 'winner') {
              acc.tournament.winner = String(data.winner ?? '');
              acc.tournament.progress = undefined;
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
            finalTrace = data as unknown as ChatTrace;
            setLastTrace(finalTrace as LastTrace);
          } else {
            const choices = data.choices as Array<{ delta?: { content?: string } }> | undefined;
            const delta = choices?.[0]?.delta;
            if (typeof delta?.content === 'string') {
              acc.content += delta.content;
              setLive({ ...acc });
            }
          }
        }
      }

      const finalContent = acc.content || (acc.errorMsg ? `⚠️ ${acc.errorMsg}` : '(tidak ada output)');

      updateChat(chatId, (c) => ({
        ...c,
        messages: [
          ...c.messages,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: finalContent,
            reasoning:
              Object.values(acc.reasoning).length > 0
                ? Object.values(acc.reasoning).join('\n---\n')
                : undefined,
            trace: finalTrace,
            failed: Boolean(acc.errorMsg),
          },
        ],
      }));
    } catch (error) {
      updateChat(chatId, (c) => ({
        ...c,
        messages: [
          ...c.messages,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: `⚠️ ${String(error)} — pastikan "node server/gateway.mjs" berjalan.`,
            failed: true,
          },
        ],
      }));
    }

    setLive(null);
    setBusy(false);
    taRef.current?.focus();
  };

  const messages = active?.messages ?? [];
  const lastMsgTrace = [...messages].reverse().find((m) => m.trace)?.trace;

  const inputBox = (center: boolean) => (
    <div className={center ? 'g-inputwrap center' : 'g-inputwrap'}>
      <div className="g-input">
        <textarea
          ref={taRef}
          rows={1}
          placeholder="Tanya Otomation…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
        />
        <ModelSelector value={selected} onChange={setSelected} models={models} providers={providers} />
        <button className="g-send" disabled={busy || draft.trim().length === 0} onClick={() => void handleSend()}>
          ➤
        </button>
      </div>
    </div>
  );

  return (
    <div className="g-main">
      <div className="g-chatcol">
        <div className="g-chathead">
          <span className="title">{active?.title ?? 'Otomation Setting'}</span>
          <button
            className={`g-thinkbtn ${thinkingOpen ? 'on' : ''}`}
            onClick={() => setThinkingOpen((o) => !o)}
          >
            🧠 Proses berpikir
          </button>
        </div>

        {messages.length === 0 ? (
          <div className="g-empty">
            <h1>Apa yang bisa saya bantu?</h1>
            {inputBox(true)}
          </div>
        ) : (
          <>
            <div className="g-msgs">
              {messages.map((m) => (
                <div key={m.id} className={`g-msg ${m.role === 'user' ? 'user' : 'ai'}`}>
                  {m.role === 'user' ? (
                    <div className="bubble">{m.content}</div>
                  ) : (
                    <>
                      <Markdown content={m.content} />
                      {m.trace?.tournament && (
                        <details className="g-trace">
                          <summary>🧠 proses seleksi AI</summary>
                          <div style={{ marginTop: 6 }}>
                            mode: {m.trace.tournament.mode ?? 'all'} · tugas:{' '}
                            {m.trace.tournament.taskType} · kandidat:{' '}
                            {(m.trace.tournament.candidates ?? []).length} · pemenang:{' '}
                            {m.trace.tournament.winner ? short(m.trace.tournament.winner) : '-'} ·
                            validasi: {(m.trace.tournament.validation ?? []).join(' → ') || '-'}
                          </div>
                        </details>
                      )}
                      {m.reasoning && (
                        <details className="g-trace">
                          <summary>reasoning mentah</summary>
                          <pre className="g-raw">{m.reasoning}</pre>
                        </details>
                      )}
                    </>
                  )}
                </div>
              ))}
              {live && (
                <div className="g-msg ai">
                  {live.content ? <Markdown content={live.content} /> : <span style={{ opacity: 0.6 }}>…</span>}
                  {busy && <span className="g-cursor">▍</span>}
                </div>
              )}
              <div ref={bottomRef} />
            </div>
            {inputBox(false)}
          </>
        )}
      </div>

      {thinkingOpen && (
        <ThinkingPanel
          live={live}
          lastTrace={lastTrace ?? lastMsgTrace ?? null}
          onClose={() => setThinkingOpen(false)}
        />
      )}
    </div>
  );
}