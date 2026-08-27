/**
 * Mode System — Fase 23A.
 * 4 mode: auto, manual, planning, auto_remote.
 * Memetakan 3 dial (intelligence/thinking/hallucination) ke parameter teknis.
 */

export const MODES = {
  auto: {
    name: 'Auto',
    description: 'Sistem otomatis deteksi pertanyaan dan pilih setting terbaik.',
    autonomy: 'auto',
  },
  manual: {
    name: 'Manual',
    description: 'User atur 3 dial (intelligence/thinking/halusinasi) + konfirmasi per langkah.',
    autonomy: 'step',
  },
  planning: {
    name: 'Planning',
    description: 'Reasoning maksimal. Buat plan dulu, user approve, baru eksekusi.',
    autonomy: 'plan',
  },
  auto_remote: {
    name: 'Auto Remote',
    description: 'Fitur terbaik. Full otonomi (YOLO) + specialists + silent verify.',
    autonomy: 'full',
  },
};

export const INTELLIGENCE_LEVELS = {
  low:    { tier: 'standart', tournament: false },
  medium: { tier: 'standart', tournament: true },
  high:   { tier: 'high',     tournament: true },
  max:    { tier: 'max',      tournament: true },
};

export const THINKING_LEVELS = {
  low:    { reasoningMaxTokens: 128 },
  medium: { reasoningMaxTokens: 512 },
  high:   { reasoningMaxTokens: 2048 },
  max:    { reasoningMaxTokens: 8192 },
};

export const HALLUCINATION_LEVELS = {
  low:    { temperature: 0.7, forceTools: false, verifier: false },
  medium: { temperature: 0.3, forceTools: true,  verifier: 'light' },
  max:    { temperature: 0.1, forceTools: true,  verifier: 'full' },
};

const DEFAULT_DIALS = { intelligence: 'medium', thinking: 'medium', hallucination: 'medium' };
const MAX_DIALS     = { intelligence: 'max',    thinking: 'max',    hallucination: 'max' };

/**
 * Resolve mode + dial user → config teknis final.
 * Dipakai oleh Fase 23B–23E untuk menjalankan agent.
 */
export function resolveModeConfig(mode, userDials = {}) {
  const m = MODES[mode];
  if (!m) return null;

  let dials;
  if (mode === 'manual') {
    // user pegang kendali penuh
    dials = { ...DEFAULT_DIALS, ...userDials };
  } else if (mode === 'auto') {
    // [FIX] auto mode juga accept detection dials dari userDials
    dials = { ...DEFAULT_DIALS, ...userDials };
  } else {
    // planning & auto_remote = max semua (fitur terbaik)
    dials = { ...MAX_DIALS };
  }

  const intelligence = INTELLIGENCE_LEVELS[dials.intelligence] ?? INTELLIGENCE_LEVELS.medium;
  const thinking     = THINKING_LEVELS[dials.thinking] ?? THINKING_LEVELS.medium;
  const hallucination= HALLUCINATION_LEVELS[dials.hallucination] ?? HALLUCINATION_LEVELS.medium;

  return {
    mode,
    autonomy: m.autonomy,
    dials,
    intelligence,
    thinking,
    hallucination,
  };
}
