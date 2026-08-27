/**
 * Agent Executor — Fase 23C.
 * Menjalankan agent dengan config (mode + dials) yang diberikan.
 * Support 3 autonomy levels: plan (PLANNING), step (MANUAL), full (AUTO REMOTE).
 */

import { executeToolCall } from '../tools.mjs';
import { verifyWorkflow } from './verifier.mjs';
import { checkPermission, grantPermission } from './permissions.mjs';

/**
 * Eksekusi single step (untuk mode MANUAL).
 * @param {string} stepDescription - Deskripsi langkah
 * @param {Object} config - Config dari resolveModeConfig
 * @param {Function} callModel - Gateway callModel function
 * @returns {Promise<Object>} step result
 */
export async function executeStep(stepDescription, config, callModel) {
  const { intelligence, thinking, hallucination } = config;
  
  // Build prompt dengan setting yang dipilih
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
 * Eksekusi full workflow (untuk mode AUTO REMOTE).
 * @param {Object} workflow - Workflow definition
 * @param {Object} config - Config dari resolveModeConfig
 * @param {Function} callModel - Gateway callModel function
 * @returns {Promise<Object>} execution result
 */
export async function executeFullWorkflow(workflow, config, callModel) {
  // Untuk fase ini, kita return placeholder
  // Nanti di Fase 23E akan integrasi dengan workflow engine
  return {
    success: true,
    message: 'AUTO REMOTE mode: full execution with specialists (to be implemented in 23E)',
    workflow,
    config,
  };
}

/**
 * Check permission dan minta izin jika belum ada.
 * @param {string} type - Permission type
 * @param {Function} askUser - Callback untuk tanya user
 * @returns {Promise<boolean>} true jika diizinkan
 */
export async function ensurePermission(type, askUser) {
  const status = checkPermission(type);
  
  if (status === 'persistent' || status === 'session') {
    return true; // sudah ada izin
  }
  
  if (status === 'denied') {
    return false; // ditolak di sesi ini
  }
  
  // Perlu tanya user
  const response = await askUser(type);
  
  if (response.choice === 'persistent') {
    grantPermission(type, 'persistent');
    return true;
  } else if (response.choice === 'session') {
    grantPermission(type, 'session');
    return true;
  } else {
    return false; // ditolak
  }
}
