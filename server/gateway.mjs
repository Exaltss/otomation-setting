/**
 * otomation-setting AI Gateway — server "otak" (pola FCC).
 * Memegang key, routing, kompresi, credit guard, fallback, admin API.
 * Zero dependency: node:http + fetch bawaan.
 * Semua fetch upstream diberi timeout agar tidak pernah menggantung selamanya.
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  appendHistory,
  checkBudget,
  compressMessages,
  estimateTokens,
  pickModelForTier,
  readConfig,
  readHistory,
  readUsage,
  recordUsage,
  routeTier,
  validateConfig,
  writeConfig,
} from './lib/engine.mjs';

const PORT = process.env.PORT ?? 4123;
const NVIDIA_BASE = 'https://integrate.api.nvidia.com/v1';
const PREMIUM_BUDGET = 16384;

function loadEnv() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const envPath = path.join(here, '..', '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnv();

const NVIDIA_KEY = process.env.VITE_NVIDIA_API_KEY ?? process.env.NVIDIA_API_KEY ?? '';

function json(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

// ---------- discovery (timeout 10 dtk) ----------
const modelCache = { at: 0, models: [] };

async function discoverModels(timeoutMs = 10000) {
  const now = Date.now();
  if (modelCache.models.length > 0 && now - modelCache.at < 60000) {
    return modelCache.models;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${NVIDIA_BASE}/models`, {
      headers: { Authorization: `Bearer ${NVIDIA_KEY}` },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`discovery HTTP ${res.status}`);
    const data = await res.json();
    const models = (data.data ?? []).map((m) => ({ id: m.id }));
    modelCache.at = now;
    modelCache.models = models;
    return models;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- eksekusi NVIDIA (timeout 60 dtk) ----------
async function callNvidia(model, messages, timeoutMs = 60000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${NVIDIA_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${NVIDIA_KEY}`,
      },
      body: JSON.stringify({ model, messages, max_tokens: 512 }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const error = new Error(data?.error?.message ?? `HTTP ${res.status}`);
      error.status = res.status;
      throw error;
    }
    return data?.choices?.[0]?.message?.content ?? '';
  } finally {
    clearTimeout(timer);
  }
}

const isRetryable = (e) => e.status === 429 || e.status >= 500 || e.status === undefined;

async function handleChat(body) {
  const startedAt = Date.now();
  const cfg = readConfig();

  const incoming = Array.isArray(body?.messages) ? body.messages : [];
  if (incoming.length === 0) {
    return { status: 400, body: { error: { message: 'messages array is required' } } };
  }

  const lastUser = [...incoming].reverse().find((m) => m.role === 'user');
  const payload = String(lastUser?.content ?? '');
  if (payload.trim().length === 0) {
    return { status: 400, body: { error: { message: 'empty user message' } } };
  }

  // 1) 9Router
  const { tier, tokens } = routeTier(payload);
  if (tier === null) {
    return {
      status: 400,
      body: { error: { message: 'Context exceeds premium limit. Split the task or compress input.' } },
    };
  }

  // 2) Credit Guard
  const guard = checkBudget(tokens, cfg.creditLimitPerDay);
  if (!guard.ok) {
    return { status: 429, body: { error: { message: guard.error } } };
  }

  // 3) Discovery + resolusi model: override tier -> unggulan -> katalog -> default
  let models = [];
  try {
    models = await discoverModels();
  } catch {
    models = [];
  }
  const override = cfg.tiers?.[tier] ?? null;
  const primary = override ?? pickModelForTier(tier, models) ?? cfg.model;
  const candidates = [primary, ...cfg.fallbackModels.filter((m) => m !== primary)];

  // 4) Compressed Context
  const compressed = compressMessages(incoming, PREMIUM_BUDGET);
  const finalMessages = compressed.summary
    ? [
        { role: 'system', content: `Compressed context summary: ${compressed.summary}` },
        ...compressed.messages,
      ]
    : compressed.messages;

  // 5) Eksekusi: tiap kandidat maksimal 2 percobaan, lalu kandidat berikutnya.
  let output = null;
  let usedModel = null;
  let lastError = null;
  for (const model of candidates) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        output = await callNvidia(model, finalMessages);
        usedModel = model;
        break;
      } catch (error) {
        lastError = error;
        if (!isRetryable(error)) break;
      }
    }
    if (output !== null) break;
  }

  const durationMs = Date.now() - startedAt;

  if (output === null) {
    appendHistory({
      status: 'error',
      provider: 'nvidia',
      model: primary,
      tier,
      estimatedTokens: tokens,
      durationMs,
      message: String(lastError?.message ?? lastError),
    });
    return {
      status: 502,
      body: { error: { message: `All candidates failed: ${lastError?.message ?? lastError}` } },
    };
  }

  // 6) Catat usage + history
  const usage = recordUsage('nvidia', tokens);
  appendHistory({
    status: 'ok',
    provider: 'nvidia',
    model: usedModel,
    tier,
    estimatedTokens: tokens,
    durationMs,
    message: output.slice(0, 140),
  });

  return {
    status: 200,
    body: {
      id: `otom-${Date.now()}`,
      object: 'chat.completions',
      model: usedModel,
      choices: [
        { index: 0, message: { role: 'assistant', content: output }, finish_reason: 'stop' },
      ],
      usage: {
        prompt_tokens: compressed.estimatedTokens,
        completion_tokens: estimateTokens(output),
        total_tokens: compressed.estimatedTokens + estimateTokens(output),
      },
      otomation_trace: {
        tier,
        estimatedTokens: tokens,
        modelUsed: usedModel,
        overrideUsed: override !== null,
        fallbackUsed: usedModel !== primary,
        compressedTokens: compressed.estimatedTokens,
        droppedMessages: compressed.droppedMessages,
        usageToday: usage.totalTokens,
        durationMs,
      },
    },
  };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  if (req.method === 'OPTIONS') {
    json(res, 204, {});
    return;
  }

  if (!NVIDIA_KEY) {
    json(res, 500, { error: { message: 'Gateway: NVIDIA key tidak ditemukan di .env' } });
    return;
  }

  try {
    // ----- OpenAI-compatible -----
    if (req.method === 'GET' && url.pathname === '/v1/models') {
      const models = await discoverModels();
      json(res, 200, { object: 'list', data: models.map((m) => ({ id: m.id, object: 'model' })) });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
      const raw = await readBody(req);
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        json(res, 400, { error: { message: 'invalid JSON body' } });
        return;
      }
      const result = await handleChat(body);
      json(res, result.status, result.body);
      return;
    }

    // ----- Admin API -----
    if (req.method === 'GET' && url.pathname === '/admin/api/config') {
      json(res, 200, readConfig());
      return;
    }

    if (req.method === 'POST' && url.pathname === '/admin/api/config') {
      const raw = await readBody(req);
      let candidate;
      try {
        candidate = JSON.parse(raw);
      } catch {
        json(res, 400, { errors: ['invalid JSON body'] });
        return;
      }
      const errors = validateConfig(candidate);
      if (errors.length > 0) {
        json(res, 422, { errors });
        return;
      }
      const current = readConfig();
      const merged = {
        ...current,
        ...candidate,
        tiers: { ...current.tiers, ...(candidate.tiers ?? {}) },
      };
      writeConfig(merged);
      json(res, 200, merged);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/admin/api/status') {
      json(res, 200, {
        usage: readUsage(),
        history: readHistory().slice(0, 10),
        discoveredModels: modelCache.models.length,
      });
      return;
    }

    json(res, 404, { error: { message: `Gateway: route tidak dikenal ${url.pathname}` } });
  } catch (error) {
    json(res, 502, { error: { message: `Gateway: ${String(error?.message ?? error)}` } });
  }
});

server.listen(PORT, () => {
  console.log(`otomation-setting AI Gateway (brain) siap di http://localhost:${PORT}/v1`);
});