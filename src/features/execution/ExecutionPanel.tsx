/**
 * Execution panel — trigger eksekusi, laporan transparan,
 * pemakaian harian (Credit Guard), dan execution history.
 */
import { useState } from 'react';
import { foldResult } from '../../core/result';
import { useAppStore } from '../workflow/store';
import {
  DEFAULT_CREDIT_POLICY,
  readUsage,
  type UsageSnapshot,
} from './creditGuard';
import {
  clearHistory,
  readHistory,
  type HistoryEntry,
} from './executionHistory';
import { executeWorkflow, type ExecutionReport } from './executionEngine';

export function ExecutionPanel() {
  const { sampleInput, routerPolicy } = useAppStore();
  const [report, setReport] = useState<ExecutionReport | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>(() => readHistory());
  const [usage, setUsage] = useState<UsageSnapshot>(() => readUsage());

  const refresh = () => {
    setHistory(readHistory());
    setUsage(readUsage());
  };

  const handleRun = async () => {
    setBusy(true);
    setReport(null);
    setFailure(null);

    const result = await executeWorkflow({
      payload: sampleInput,
      policy: routerPolicy,
    });

    foldResult(
      result,
      (value) => setReport(value),
      (error) => setFailure(error.message),
    );

    refresh();
    setBusy(false);
  };

  const handleClearHistory = () => {
    clearHistory();
    refresh();
  };

  return (
    <div>
      <p>
        <strong>Today&apos;s usage:</strong> {usage.totalTokens} /{' '}
        {DEFAULT_CREDIT_POLICY.maxTokensPerDay} tokens
      </p>

      <button onClick={handleRun} disabled={busy} style={{ padding: '6px 16px' }}>
        {busy ? 'Running…' : 'Run Workflow'}
      </button>

      {failure !== null && <p style={{ color: 'red' }}>{failure}</p>}

      {report !== null && (
        <div
          style={{
            marginTop: '10px',
            border: '1px solid #333',
            borderRadius: '8px',
            padding: '10px',
          }}
        >
          <p><strong>Provider:</strong> {report.routing.provider} ({report.routing.model})</p>
          <p><strong>Tier:</strong> {report.routing.tier}</p>
          <p><strong>Estimated tokens:</strong> {report.routing.estimatedTokens}</p>
          <p><strong>Context tokens (setelah kompresi):</strong> {report.compressed.estimatedTokens}</p>
          <p><strong>Dropped messages:</strong> {report.compressed.droppedMessages}</p>
          <p><strong>Duration:</strong> {report.durationMs} ms</p>
          <p><strong>Usage after run:</strong> {report.usageAfter} tokens</p>
          <p><strong>Output:</strong></p>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              background: '#111',
              padding: '8px',
              borderRadius: '6px',
            }}
          >
            {report.output}
          </pre>
        </div>
      )}

      <div style={{ marginTop: '16px' }}>
        <h3 style={{ marginBottom: '8px' }}>
          Execution History
          <button
            type="button"
            onClick={handleClearHistory}
            style={{ padding: '2px 8px', marginLeft: '8px' }}
          >
            Clear
          </button>
        </h3>

        {history.length === 0 ? (
          <p>Belum ada eksekusi.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {history.map((entry) => (
              <li
                key={entry.id}
                style={{
                  border: '1px solid #333',
                  borderRadius: '6px',
                  padding: '6px 8px',
                  marginBottom: '6px',
                  fontSize: '12px',
                }}
              >
                <strong style={{ color: entry.status === 'ok' ? '#4ade80' : '#f87171' }}>
                  {entry.status}
                </strong>{' '}
                {new Date(entry.at).toLocaleTimeString()} — {entry.provider ?? 'n/a'}{' '}
                {entry.tier ? `(${entry.tier})` : ''} — {entry.estimatedTokens} token —{' '}
                {entry.durationMs} ms
                <div style={{ opacity: 0.75 }}>{entry.message}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}