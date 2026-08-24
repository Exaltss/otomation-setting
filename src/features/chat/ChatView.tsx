/**
 * Chat — wajah utama aplikasi.
 * User bertanya -> AI dari key primary menjawab.
 * Di bawah jawaban: "proses berpikir" (trace routing/model/kompresi/kredit).
 * Tools di dekat chat: dropdown model (auto = rekomendasi 9Router).
 */
import { useEffect, useRef, useState } from 'react';
import { foldResult } from '../../core/result';
import type { ContextMessage } from '../../domain/automation';
import { useAppStore } from '../workflow/store';
import { executeWorkflow, type ExecutionReport } from '../execution/executionEngine';
import { fetchModels } from '../execution/modelCatalog';
import { getApiKey, isUnlocked } from '../../services/providerService';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  trace?: ExecutionReport;
  failed?: boolean;
}

export function ChatView() {
  const { routerPolicy } = useAppStore();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState('auto');
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Muat katalog model NVIDIA (primary) saat vault terbuka.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!isUnlocked()) {
        return;
      }
      const key = await getApiKey('nvidia');
      if (!key.ok) {
        return;
      }
      const catalog = await fetchModels('nvidia', key.value);
      if (!cancelled && catalog.ok) {
        setModels(catalog.value.map((m) => m.id));
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  const handleSend = async () => {
    const question = draft.trim();
    if (question.length === 0 || busy) {
      return;
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: question,
    };
    const history: ContextMessage[] = messages
      .filter((m) => !m.failed)
      .map((m) => ({ role: m.role, content: m.content }));

    setMessages((prev) => [...prev, userMessage]);
    setDraft('');
    setBusy(true);

    const isOverride = selectedModel !== 'auto';
    const result = await executeWorkflow({
      payload: question,
      policy: routerPolicy,
      history,
      modelOverride: isOverride ? selectedModel : undefined,
      providerOverride: isOverride ? 'nvidia' : undefined,
    });

    foldResult(
      result,
      (report) => {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: report.output,
            trace: report,
          },
        ]);
      },
      (error) => {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: `⚠️ ${error.message}`,
            failed: true,
          },
        ]);
      },
    );

    setBusy(false);
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px' }}>
        <label>
          Model:
          <select
            value={selectedModel}
            onChange={(event) => setSelectedModel(event.target.value)}
            style={{ marginLeft: '6px' }}
          >
            <option value="auto">auto (9Router)</option>
            {models.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
        {!isUnlocked() && (
          <span style={{ fontSize: '12px', opacity: 0.7 }}>
            Unlock vault di menu Setting untuk memuat katalog model.
          </span>
        )}
      </div>

      <div
        style={{
          border: '1px solid #333',
          borderRadius: '8px',
          padding: '12px',
          minHeight: '320px',
          maxHeight: '480px',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}
      >
        {messages.length === 0 && (
          <p style={{ opacity: 0.6 }}>Tanya apa saja — AI dari key primary kamu yang menjawab.</p>
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

            {m.trace && (
              <details style={{ marginTop: '8px', fontSize: '12px', opacity: 0.9 }}>
                <summary style={{ cursor: 'pointer' }}>🧠 proses berpikir</summary>
                <ul style={{ margin: '6px 0 0', paddingLeft: '18px' }}>
                  <li>
                    Router: tier {m.trace.routing.tier} → {m.trace.routing.provider}{' '}
                    ({m.trace.routing.reason})
                  </li>
                  <li>
                    Model: {m.trace.modelUsed}{' '}
                    {m.trace.overrideUsed ? '(pilihan manual)' : '(auto dari katalog key)'}
                  </li>
                  <li>Provider eksekusi: {m.trace.providerUsed}</li>
                  <li>
                    Konteks: {m.trace.compressed.estimatedTokens} token setelah kompresi,{' '}
                    {m.trace.compressed.droppedMessages} pesan lama diringkas
                  </li>
                  <li>Pemakaian hari ini: {m.trace.usageAfter} token</li>
                  <li>Durasi: {m.trace.durationMs} ms</li>
                </ul>
              </details>
            )}
          </div>
        ))}

        {busy && <p style={{ opacity: 0.6 }}>AI sedang berpikir…</p>}
        <div ref={bottomRef} />
      </div>

      <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
        <input
          style={{ flex: 1, padding: '8px' }}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              void handleSend();
            }
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