/**
 * AUTO REMOTE Executor — Fase 23E.
 * Full otonomi: run task tanpa tanya, pakai specialists, silent verify, audit.
 */

import { executeToolCall } from '../tools.mjs';
import { selectSpecialists, getRequiredPermissions } from './specialists.mjs';
import { checkPermission, logAudit } from './permissions.mjs';
import { verifyWorkflow } from './verifier.mjs';

/**
 * Jalankan satu langkah remote dengan specialist.
 * @param {string} stepDescription - Langkah yang harus dijalankan
 * @param {Object} specialist - Specialist object dari specialists.mjs
 * @param {Function} callModel - Gateway callModel function
 * @returns {Promise<Object>} step result
 */
async function runWithSpecialist(stepDescription, specialist, callModel) {
  const prompt = `You are a specialist in: ${specialist.description}.

TASK: ${stepDescription}

Use your expertise and available tools to complete this task efficiently.
Return the result directly. If you need to call tools, use the standard tool calling format.`;

  try {
    const result = await callModel('auto', [{ role: 'user', content: prompt }], {
      maxTokens: specialist.sampling.reasoningMaxTokens,
      sampling: { temperature: specialist.sampling.temperature },
    });

    logAudit({
      type: 'remote_step',
      specialist: specialist.name,
      action: 'execute',
      step: stepDescription.slice(0, 100),
    });

    return {
      success: true,
      specialist: specialist.name,
      output: result.content || result.reasoning || '',
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
 * @param {Object} options - { askPermission, silentVerify }
 * @returns {Promise<Object>} execution result
 */
export async function executeRemote(task, callModel, options = {}) {
  const { askPermission = async () => ({ choice: 'deny' }), silentVerify = true } = options;

  // 1. Pilih specialists
  const specialists = selectSpecialists(task);

  // 2. Cek permission untuk semua specialists
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
        specialists,
        permissionStatus,
      };
    } else {
      // Perlu tanya user
      const response = await askPermission(perm);
      if (response.choice === 'persistent' || response.choice === 'session') {
        permissionStatus[perm] = response.choice;
      } else {
        return {
          success: false,
          error: `Permission '${perm}' denied by user. Task aborted.`,
          specialists,
          permissionStatus,
        };
      }
    }
  }

  // 3. Eksekusi dengan specialists (sequential untuk fase ini)
  const steps = [];
  for (const specialist of specialists) {
    const result = await runWithSpecialist(task, specialist, callModel);
    steps.push(result);

    // Early exit kalau gagal
    if (!result.success) {
      return {
        success: false,
        error: `Specialist '${specialist.name}' failed: ${result.error}`,
        steps,
        specialists,
        permissionStatus,
      };
    }
  }

  // 4. Silent verify (optional) — cek hasil dengan verifier
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
    specialists: specialists.map(s => s.name),
    permissions: permissionStatus,
    verified: verification?.verdict || 'skipped',
  });

  return {
    success: true,
    steps,
    specialists: specialists.map(s => s.name),
    permissionStatus,
    verification,
  };
}
