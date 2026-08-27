/**
 * Agent Executor — Fase 23C.
 * Menjalankan agent dengan config (mode + dials) yang diberikan.
 * Support 3 autonomy levels: plan (PLANNING), step (MANUAL), full (AUTO REMOTE).
 */

import { checkPermission, grantPermission } from './permissions.mjs';

/**
 * Eksekusi single step (untuk mode MANUAL).
 * @param {string} stepDescription - Deskripsi langkah
 * @param {Object} config - Config dari resolveModeConfig
 * @param {Function} callModel - Gateway callModel function
 * @returns {Promise<Object>} step result { success, output, reasoning }
 */
export async function executeStep(stepDescription, config, callModel) {
  const { intelligence, thinking, hallucination } = config;

  const prompt = `Execute this step: ${stepDescription}

Settings:
- Intelligence: ${intelligence.tier} (tournament: ${intelligence.tournament})
- Thinking budget: ${thinking.reasoningMaxTokens} tokens
- Temperature: ${hallucination.temperature}
- Force tools: ${hallucination.forceTools}

Provide the result of this step. If tools are needed, use them.`;

  try {
    const result = await callModel('auto', [{ role: 'user', content: prompt }], {
      maxTokens: thinking.reasoningMaxTokens,
      sampling: { temperature: hallucination.temperature },
    });

    return {
      success: true,
      output: result.content || result.reasoning || '',
      reasoning: result.reasoning || '',
    };
  } catch (error) {
    return {
      success: false,
      error: String(error?.message ?? error),
    };
  }
}

/**
 * Check permission dan minta izin jika belum ada.
 * Dipanggil sebelum operasi berisiko (file delete, network send, dll).
 * @param {string} type - Permission type (lihat permissions.mjs)
 * @param {Function} askUser - Callback yang return { choice: 'persistent'|'session'|'deny' }
 * @returns {Promise<boolean>} true jika diizinkan
 */
export async function ensurePermission(type, askUser) {
  const status = checkPermission(type);

  if (status === 'persistent' || status === 'session') return true;
  if (status === 'denied') return false;

  const response = await askUser(type);

  if (response.choice === 'persistent') {
    grantPermission(type, 'persistent');
    return true;
  }
  if (response.choice === 'session') {
    grantPermission(type, 'session');
    return true;
  }
  return false;
}
