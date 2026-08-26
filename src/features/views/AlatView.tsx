/**
 * Alat — Engine Lab (demo routing lokal).
 * Tier: Standart / High / Max (cheap dihapus).
 */
import { useMemo, useState } from 'react';
import { Canvas } from '../workflow/Canvas';

interface Policy {
  standart: number;
  high: number;
  max: number;
}

const DEFAULT_POLICY: Policy = { standart: 4096, high: 8192, max: 16384 };

const TIER_MODEL: Record<string, string> = {
  standart: 'meta/llama-3.1-8b-instruct',
  high: 'meta/llama-3.1-70b-instruct',
  max: 'meta/llama-3.3-70b-instruct',
};

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function routeDecision(input: string, policy: Policy) {
  const tokens = estimateTokens(input);
  let tier: 'standart' | 'high' | 'max' | null = null;
  let reason: string;

  if (tokens <= policy.standart) {
    tier = 'standart';
    reason = 'Tugas ringan-sedang: model standar berkualitas (bukan model murah).';
  } else if (tokens <= policy.high) {
    tier = 'high';
    reason = 'Tugas menengah-berat: model 70b untuk akurasi tinggi.';
  } else if (tokens <= policy.max) {
    tier = 'max';
    reason = 'Tugas berat: model terbaik + limit token maksimal.';
  } else {
    reason = 'Context melebihi limit max — pecah tugas atau kompres input.';
  }

  return { tier, tokens, reason, model: tier ? TIER_MODEL[tier] : '-' };
}

export function AlatView() {
  const [sample, setSample] = useState('Buat automation untuk mengirim email ketika form masuk.');
  const [policy, setPolicy] = useState<Policy>(DEFAULT_POLICY);

  const decision = useMemo(() => routeDecision(sample, policy), [sample, policy]);

  return (
    <div>
      <h2>Alat — Engine Lab</h2>

      <h3>Sample Input</h3>
      <textarea
        value={sample}
        onChange={(e) => setSample(e.target.value)}
        rows={4}
        style={{ width: '100%' }}
      />

      <h3>9Router Decision</h3>
      <p>
        <strong>Tier:</strong> {decision.tier ?? '-'}
        <br />
        <strong>Model:</strong> {decision.model}
        <br />
        <strong>Estimated tokens:</strong> {decision.tokens}
        <br />
        <strong>Reason:</strong> {decision.reason}
      </p>

      <h3>Router Policy</h3>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <label>
          Standart max tokens:{' '}
          <input
            type="number"
            value={policy.standart}
            onChange={(e) => setPolicy((p) => ({ ...p, standart: Number(e.target.value) || 0 }))}
          />
        </label>
        <label>
          High max tokens:{' '}
          <input
            type="number"
            value={policy.high}
            onChange={(e) => setPolicy((p) => ({ ...p, high: Number(e.target.value) || 0 }))}
          />
        </label>
        <label>
          Max max tokens:{' '}
          <input
            type="number"
            value={policy.max}
            onChange={(e) => setPolicy((p) => ({ ...p, max: Number(e.target.value) || 0 }))}
          />
        </label>
      </div>

      <h3>Workflow Canvas</h3>
      <Canvas />
    </div>
  );
}