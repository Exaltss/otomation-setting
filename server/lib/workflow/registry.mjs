/**
 * Node registry — execute(inputItems, params, ctx) → outputItems
 */
import { executeToolCall } from '../tools.mjs';
import { toItems, resolveTemplate, resolveParams } from './items.mjs';

function contextToItems(context) {
  if (typeof context === 'string') {
    const trimmed = context.trim();
    const looksLikeJson =
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'));
    if (looksLikeJson) {
      try {
        return toItems(JSON.parse(trimmed));
      } catch {
        // bukan JSON valid
      }
    }
  }
  return toItems(context);
}

/**
 * [FIX A] Interpret hasil js_sandbox: throw pada runtime error,
 * parse stdout JSON menjadi object items agar downstream clean.
 */
function interpretSandboxResult(result) {
  if (result?.error) throw new Error(result.error);
  if (result.exitCode !== 0) {
    throw new Error(`code exited ${result.exitCode}: ${result.stderr || 'runtime error'}`);
  }
  const stdout = (result.stdout ?? '').trim();
  try {
    return toItems(JSON.parse(stdout));
  } catch {
    return toItems({ stdout, stderr: result.stderr ?? '', exitCode: result.exitCode });
  }
}

const isSandboxResult = (r) =>
  r !== null && typeof r === 'object' && 'stdout' in r && 'exitCode' in r;

export const NODE_REGISTRY = {
  trigger: {
    label: 'Trigger',
    execute: async (_items, params) => contextToItems(params?.context ?? ''),
  },

  ai: {
    label: 'AI Reasoning',
    execute: async (items, params, ctx) => {
      const prompt = resolveTemplate(params?.prompt ?? '', items);
      if (!prompt.trim()) throw new Error('prompt kosong');
      const result = await ctx.callModel(params?.model ?? 'auto', [
        { role: 'user', content: prompt },
      ]);
      const text = result.content || result.reasoning || '';
      if (!text) throw new Error('AI tidak menghasilkan output');
      return toItems(text);
    },
  },

  tool: {
    label: 'Tool',
    execute: async (items, params) => {
      const toolName = params?.toolName;
      if (!toolName) throw new Error('toolName wajib diisi');
      const resolved = resolveParams(params?.params ?? {}, items);
      const result = await executeToolCall(toolName, resolved);
      if (result && result.error) throw new Error(result.error);
      // [FIX A] sandbox via tool node diperlakukan sama dengan code node
      if (isSandboxResult(result)) return interpretSandboxResult(result);
      return toItems(result);
    },
  },

  code: {
    label: 'Code',
    execute: async (items, params) => {
      const code = resolveTemplate(params?.code ?? '', items);
      if (!code.trim()) throw new Error('code kosong');
      const result = await executeToolCall('js_sandbox', { code });
      return interpretSandboxResult(result);
    },
  },

  set: {
    label: 'Set / Transform',
    execute: async (items, params) => toItems(resolveParams(params?.value ?? {}, items)),
  },

  output: {
    label: 'Output',
    execute: async (items) => items,
  },
};

export const NODE_TYPES = Object.keys(NODE_REGISTRY);