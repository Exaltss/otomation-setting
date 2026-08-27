/**
 * AUTO REMOTE Executor — Fase 23E (dengan context management).
 * Full otonomi: run task tanpa tanya, pakai specialists, silent verify, audit.
 * Context window besar (32K tokens) + auto-compact.
 */

import { selectSpecialists, getRequiredPermissions } from './specialists.mjs';
import { checkPermission, logAudit } from './permissions.mjs';
import { verifyWorkflow } from './verifier.mjs';
import { createContextManager } from './context.mjs';

/**
 * Jalankan satu langkah remote dengan specialist.
 * @param {string} stepDescription - Langkah yang harus dijalankan
 * @param {Object} specialist - Specialist object dari specialists.mjs
 * @param {Object} contextManager - Context manager instance
 * @param {Function} callModel - Gateway callModel function
 * @returns {Promise<Object>} step result
 */
async function runWithSpecialist(stepDescription, specialist, contextManager, callModel) {
  // Tambah user message ke context
  contextManager.addMessage({ role: 'user', content: stepDescription });

  const prompt = `You are a specialist in: ${specialist.description}.

Use your expertise and available tools to complete this task efficiently.
Return the result directly. If you need to call tools, use the standard tool calling format.`;

  contextManager.addMessage({ role: 'system', content: prompt });

  try {
    const result = await callModel('auto', contextManager.getContext(), {
      maxTokens: specialist.sampling.reasoningMaxTokens,
      sampling: { temperature: specialist.sampling.temperature },
    });

    const output = result.content || result.reasoning || '';
    contextManager.addMessage({ role: 'assistant', content: output });

    logAudit({
      type: 'remote_step',
      specialist: specialist.name,
      action: 'execute',
      step: stepDescription.slice(0, 100),
      contextTokens: contextManager.getStats().totalTokens,
    });

    return {
      success: true,
      specialist: specialist.name,
      output,
      reasoning: result.reasoning || '',
    };
  } catch (error) {
    return {
      success: false,
      specialist: specialist.name,
      error: String(error?.message ?? error),
    };
  }
}

/**
 * Jalankan AUTO REMOTE mode untuk satu task.
 * @param {string} task - Task description
 * @param {Function} callModel - Gateway callModel function
 * @param {Object} options - { sessionId, askPermission, silentVerify }
 * @returns {Promise<Object>} execution result
 */
export async function executeRemote(task, callModel, options = {}) {
  const {
    sessionId = `session_${Date.now()}`,
    askPermission = async () => ({ choice: 'deny' }),
    silentVerify = true,
  } = options;

  // 1. Buat context manager untuk AUTO REMOTE (32K tokens)
  const contextManager = createContextManager(sessionId, 'auto_remote');

  // 2. Cek apakah perlu compact sebelum mulai
  if (contextManager.needsCompaction()) {
    const compactResult = await contextManager.compact(callModel);
    if (compactResult.compacted) {
      logAudit({
        type: 'context_compact',
        sessionId,
        tokensBefore: compactResult.tokensBefore,
        tokensAfter: compactResult.tokensAfter,
      });
    }
  }

  // 3. Pilih specialists
  const specialists = selectSpecialists(task);

  // 4. Cek permission untuk semua specialists
  const requiredPerms = getRequiredPermissions(specialists);
  const permissionStatus = {};

  for (const perm of requiredPerms) {
    const status = checkPermission(perm);
    if (status === 'persistent' || status === 'session') {
      permissionStatus[perm] = 'granted';
    } else if (status === 'denied') {
      return {
        success: false,
        error: `Permission '${perm}' denied in this session. Task cannot proceed.`,
        sessionId,
        specialists,
        permissionStatus,
        contextStats: contextManager.getStats(),
      };
    } else {
      const response = await askPermission(perm);
      if (response.choice === 'persistent' || response.choice === 'session') {
        permissionStatus[perm] = response.choice;
      } else {
        return {
          success: false,
          error: `Permission '${perm}' denied by user. Task aborted.`,
          sessionId,
          specialists,
          permissionStatus,
          contextStats: contextManager.getStats(),
        };
      }
    }
  }

  // 5. Eksekusi dengan specialists
  const steps = [];
  for (const specialist of specialists) {
    const result = await runWithSpecialist(task, specialist, contextManager, callModel);
    steps.push(result);

    if (!result.success) {
      return {
        success: false,
        error: `Specialist '${specialist.name}' failed: ${result.error}`,
        sessionId,
        steps,
        specialists,
        permissionStatus,
        contextStats: contextManager.getStats(),
      };
    }

    // Cek context setelah setiap step
    if (contextManager.needsCompaction()) {
      const compactResult = await contextManager.compact(callModel);
      if (compactResult.compacted) {
        logAudit({
          type: 'context_compact',
          sessionId,
          tokensBefore: compactResult.tokensBefore,
          tokensAfter: compactResult.tokensAfter,
        });
      }
    }
  }

  // 6. Silent verify
  let verification = null;
  if (silentVerify) {
    try {
      const combinedOutput = steps.map(s => s.output).join('\n\n---\n\n');
      verification = await verifyWorkflow(
        { task, input: '', results: { remote: combinedOutput } },
        callModel,
      );
    } catch {
      verification = null;
    }
  }

  logAudit({
    type: 'remote_complete',
    sessionId,
    specialists: specialists.map(s => s.name),
    permissions: permissionStatus,
    verified: verification?.verdict || 'skipped',
    contextStats: contextManager.getStats(),
  });

  return {
    success: true,
    sessionId,
    steps,
    specialists: specialists.map(s => s.name),
    permissionStatus,
    verification,
    contextStats: contextManager.getStats(),
  };
}
