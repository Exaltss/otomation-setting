/**
 * Execution panel — trigger eksekusi workflow + laporan transparan.
 * Menampilkan routing, statistik kompresi, durasi, dan output.
 */
import { useState } from 'react';
import { foldResult } from '../../core/result';
import { useAppStore } from '../workflow/store';
import { executeWorkflow, type ExecutionReport } from './executionEngine';

export function ExecutionPanel() {
  const { sampleInput, routerPolicy } = useAppStore();
  const [report, setReport] = useState<ExecutionReport | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

    setBusy(false);
  };

  return (
    <div>
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
    </div>
  );
}