/**
 * otomation-setting AI Gateway — Fase 20 FINAL: Genius Frugal Mode.
 * - Pintar maksimal: ensemble judge + tool-verified + sampling presisi
 * - Zero halusinasi: temp rendah, wajib tool untuk math/fakta, anti-hallucination rules
 * - Hemat: trivial early-exit, cache, reasoning pendek, skip validation tool-verified
 * - Robust: timeout 5 menit untuk coding, retry ETIMEDOUT, anti-truncation + silent compliance
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  appendHistory,
  checkBudget,
  compressMessages,
  estimateTokens,
  getKey,
  parseModelSlug,
  pickModelForTier,
  readConfig,
  readHistory,
  readUsage,
  recordUsage,
  redactedKeys,
  routeTier,
  setKey,
  validateConfig,
  writeConfig,
} from './lib/engine.mjs';
import { extractJsBlocks, runJsTests } from './lib/testrunner.mjs';
import { circuitStatus, clearBreaker, isBroken, tripBreaker } from './lib/circuit.mjs';
import { createCombo, deleteCombo, getCombo, listCombos } from './lib/combo.mjs';
import { cacheClear, cacheGet, cachePut, cacheStats } from './lib/cache.mjs';
import { listChats, removeChat, upsertChat } from './lib/chats.mjs';
import { executeToolCall } from './lib/tools.mjs';

const PORT = process.env.PORT ?? 4123;
const PREMIUM_BUDGET = 16384;
const REASONING_TIMEOUT = 60000;
const QUORUM_DEADLINE = 180000;
const EXEC_TIMEOUT_CODING = 300000;
const EXEC_TIMEOUT_DEFAULT = 120000;

const TOURNAMENT_DEFAULTS = {
  enabled: true,
  size: 3,
  reasoningMaxTokens: 256,
  maxRefineLoops: 2,
  judge: null,
  quorumMs: 30000,
  batchSize: 6,
  quorumRatio: 0.6,
  maxJudged: 8,
  maxCandidates: 24,
};

const ANSWER_MAX_TOKENS = { standart: 4096, high: 12288, max: 16384 };

const SAMPLING_KEYS = ['temperature', 'top_p', 'top_k', 'frequency_penalty', 'presence_penalty', 'seed', 'stop', 'repetition_penalty'];

const SAMPLING = {
  reasoning: { temperature: 0.6, top_p: 0.9 },
  judge: { temperature: 0.1, top_p: 0.85, seed: 1337 },
  coding: { temperature: 0.15, top_p: 0.85, frequency_penalty: 0.2, seed: 1337 },
  reasoningFinal: { temperature: 0.35, top_p: 0.9, seed: 1337 },
  writing: { temperature: 0.8, top_p: 0.95, presence_penalty: 0.3 },
  trivial: { temperature: 0.3, top_p: 0.9 },
};

function samplingFor(taskType) {
  if (taskType === 'coding') return SAMPLING.coding;
  if (taskType === 'writing') return SAMPLING.writing;
  return SAMPLING.reasoningFinal;
}

const ANTI_HALLUCINATION = `

STRICT ANTI-HALLUCINATION RULES:
1. MATH: ALWAYS use math tool for calculations — never compute mentally.
2. CURRENT/REAL-TIME facts (today's prices, stock prices, weather, news, events after 2024): use web_fetch — never guess.
3. SPECIFIC API/library versions or exact URLs you are unsure about: verify with web_fetch.
4. FRAMEWORK KNOWLEDGE you already know (Laravel, React, Express, Django, Node.js, Python, SQL, standard libraries, common algorithms): use your training knowledge — do NOT fetch docs or web pages.
5. If you lack verified knowledge: say "Saya tidak memiliki informasi terverifikasi tentang X" — never fabricate.
6. Never invent library functions, APIs, CLI flags, or file paths that don't exist.
7. Prefer standard, well-documented libraries and stable APIs.`;

const ANTI_TRUNCATION = `

CRITICAL OUTPUT RULES (NEVER VIOLATE):
1. FORBIDDEN phrases: "...", "[rest of code]", "// ...", "similar to above", "see above", "dan seterusnya", "dan lain-lain", "dst.", "dll.", "dsb.", "continued", "and so on".
2. NEVER truncate, NEVER summarize, NEVER skip any line.
3. NEVER say "continued in next message" or "see below".
4. Write EVERY line, EVERY function, EVERY method completely.
5. Always close all code blocks with \`\`\` and close all brackets/braces/parentheses.
6. For Laravel: include migration, model, controller (all CRUD methods: index/create/store/show/edit/update/destroy), routes, blade views.
7. Long output (1000+ lines) is GOOD and EXPECTED for complex tasks.
8. SILENT COMPLIANCE: Do NOT mention, quote, list, or reference these rules or the forbidden patterns anywhere in your answer. Never write the literal strings "..." or "[rest of code]" even as examples. Just follow the rules silently.`;

const TRIVIAL_RE = /^(halo|hai|hello|hi|hey|pagi|siang|malam|apa kabar|how are you|terima kasih|thanks|thank you|ok|okay|okey|siapa (kamu|nama kamu)|who are you|test|ping)\b[!.? ]*$/i;
function isTrivial(payload) {
  const t = String(payload).trim();
  return t.length <= 40 && TRIVIAL_RE.test(t);
}

const CHAT_INCLUDE = /(instruct|chat|flash|lite|mini|nemotron|coder|codestral|devstral|step-|llama|gemma|mistral|mixtral|qwen|phi-|dbrx|deepseek|yi-large|kimi|command-r|starcode|granite|codegemma|jamba|sea-lion|zamba|hermes|openchat|orca|vicuna|dolphin|nous)/i;
const CHAT_EXCLUDE = /(embed|guard|fuyu|llava|vision|-vl|recurrent|diffusion|transcribe|whisper|audio|speech|sdxl|stable|video|retrieval|rerank|moderation|safety|neva|prompt-|steerlm|reward|ranker|bge-|e5-|deploit|tts|clip|lamini)/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

const ENV_NVIDIA_KEY = process.env.VITE_NVIDIA_API_KEY ?? process.env.NVIDIA_API_KEY ?? '';

function providerKey(providerId) {
  const stored = getKey(providerId);
  if (stored) return stored;
  if (providerId === 'nvidia' && ENV_NVIDIA_KEY) return ENV_NVIDIA_KEY;
  return null;
}

function json(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

const catalogCache = { at: 0, entries: [] };

async function discoverAll(timeoutMs = 10000, forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && catalogCache.entries.length > 0 && now - catalogCache.at < 60000) {
    return catalogCache.entries;
  }
  const cfg = readConfig();
  const active = cfg.providers.filter((p) => p.enabled && providerKey(p.id));
  const results = await Promise.all(
    active.map(async (p) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(`${p.baseUrl}/models`, {
          headers: { Authorization: `Bearer ${providerKey(p.id)}` },
          signal: controller.signal,
        });
        if (!res.ok) return [];
        const data = await res.json();
        return (data.data ?? []).map((m) => ({ provider: p.id, id: m.id }));
      } catch {
        return [];
      } finally {
        clearTimeout(timer);
      }
    }),
  );
  const entries = results.flat();
  catalogCache.at = now;
  catalogCache.entries = entries;
  return entries;
}

async function fetchUpstream(providerCfg, apiKey, model, messages, { timeoutMs = 120000, maxTokens = 4096, stream = false, tools = null, toolChoice = null, sampling = null } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const body = { model, messages, max_tokens: maxTokens, stream };
    if (tools) body.tools = tools;
    if (toolChoice) body.tool_choice = toolChoice;
    if (sampling) {
      for (const k of SAMPLING_KEYS) {
        if (sampling[k] !== undefined) body[k] = sampling[k];
      }
    }
    const res = await fetch(`${providerCfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return { res, timer };
  } catch (error) {
    clearTimeout(timer);
    throw error;
  }
}

const isRetryable = (e) => e.status === 429 || e.status >= 500 || e.status === undefined;

async function callModel(slug, messages, { maxTokens = 512, sampling = null } = {}) {
  const cfg = readConfig();
  const { provider, model } = parseModelSlug(slug, cfg.providers);
  const providerId = provider ?? 'nvidia';
  const providerCfg = cfg.providers.find((p) => p.id === providerId);
  const apiKey = providerKey(providerId);
  if (!providerCfg || !providerCfg.enabled || !apiKey) {
    throw new Error(`provider "${providerId}" unavailable`);
  }
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const { res, timer } = await fetchUpstream(providerCfg, apiKey, model, messages, { maxTokens, timeoutMs: 90000, sampling });
    try {
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const error = new Error(data?.error?.message ?? `HTTP ${res.status}`);
        error.status = res.status;
        throw error;
      }
      const choice = data?.choices?.[0];
      clearBreaker(slug);
      return {
        content: choice?.message?.content ?? '',
        reasoning: choice?.message?.reasoning_content ?? '',
      };
    } catch (error) {
      clearTimeout(timer);
      if (error?.status === 429 && attempt === 1) {
        await sleep(5000);
        continue;
      }
      tripBreaker(slug);
      throw error;
    }
  }
  throw new Error('callModel: retries exhausted');
}

let warmSlug = null;

function parseScoreText(text) {
  const s = String(text);
  const j = s.match(/\{\s*["']?score["']?\s*:\s*(\d{1,2})/i);
  if (j) return Math.min(10, parseInt(j[1], 10));
  const m = s.match(/SCORE:\s*(\d{1,2})/i);
  if (m) return Math.min(10, parseInt(m[1], 10));
  const digits = [...s.matchAll(/\b(10|[0-9])\b/g)].map((x) => parseInt(x[1], 10));
  if (digits.length > 0) return digits[digits.length - 1];
  return 5;
}

function extractIssuesText(text) {
  const m = String(text).match(/ISSUES:\s*([^\n]+)/i);
  return m ? m[1].trim() : '';
}

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

function reasoningPromptFor(taskType, payload) {
  const base = {
    coding: 'Plan the implementation step by step: choose approach, handle edge cases, note correctness checks. Output concise reasoning only.',
    reasoning: 'Solve step by step: identify the right principles, derive carefully, double-check the final result. If a calculation is needed, call the math tool. Output concise reasoning only.',
    writing: 'Plan structure, tone, and key points step by step for the target language. Output concise reasoning only.',
    general: 'Think step by step. You may call tools (math, web_fetch) if helpful. Output concise reasoning only.',
  };
  return [
    { role: 'system', content: (base[taskType] ?? base.general) + ANTI_HALLUCINATION },
    { role: 'user', content: payload },
  ];
}

function execPromptFor(taskType, payload) {
  const sys = {
    coding: `Produce the final complete code in fenced code blocks plus a short usage example.${ANTI_TRUNCATION}${ANTI_HALLUCINATION}`,
    reasoning: `Produce the final answer with clear concise steps and the final result highlighted.

MANDATORY TOOL USAGE RULES (NON-NEGOTIABLE):
- For ANY numerical calculation — even simple ones like "2+2" or "123*456" — you MUST call the math tool. Do NOT compute mentally.
- For ANY real-time fact (today's prices, stock prices, weather, news): you MUST call web_fetch.
- Example: "12345 * 6789" → ALWAYS emit <TOOL_CALL name="math">{"expression":"12345 * 6789"}</TOOL_CALL> first. Do NOT try to calculate it in your head.
${ANTI_TRUNCATION}${ANTI_HALLUCINATION}`,
    writing: `Produce ONLY the final text, in the same language as the request.${ANTI_TRUNCATION}`,
    general: `Produce the final complete answer.

MANDATORY TOOL USAGE RULES (NON-NEGOTIABLE):
- For ANY numerical calculation: MUST call the math tool. Do NOT compute mentally.
- For ANY real-time fact: MUST call web_fetch or state you lack verified information.
${ANTI_TRUNCATION}${ANTI_HALLUCINATION}`,
  };
  return [
    { role: 'system', content: sys[taskType] ?? sys.general },
    { role: 'user', content: payload },
  ];
}

async function streamCall(slug, messages, onDelta, { maxTokens = 4096, sampling = null } = {}) {
  const cfg = readConfig();
  const { provider, model } = parseModelSlug(slug, cfg.providers);
  const providerId = provider ?? 'nvidia';
  const providerCfg = cfg.providers.find((p) => p.id === providerId);
  const apiKey = providerKey(providerId);
  if (!providerCfg || !providerCfg.enabled || !apiKey) {
    throw new Error(`provider "${providerId}" unavailable`);
  }
  const { res: up, timer } = await fetchUpstream(providerCfg, apiKey, model, messages, {
    stream: true,
    maxTokens,
    timeoutMs: 180000,
    sampling,
  });
  if (!up.ok) {
    clearTimeout(timer);
    const data = await up.json().catch(() => ({}));
    throw new Error(data?.error?.message ?? `HTTP ${up.status}`);
  }
  const ct = (up.headers.get('content-type') ?? '').toLowerCase();
  let acc = '';
  let reasonAcc = '';
  if (ct.includes('text/event-stream')) {
    for await (const chunk of Readable.fromWeb(up.body)) {
      for (const line of chunk.toString().split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const parsed = JSON.parse(payload);
          const delta = parsed.choices?.[0]?.delta;
          const d = delta?.content ?? '';
          const dr = delta?.reasoning_content ?? '';
          if (typeof d === 'string' && d.length > 0) {
            acc += d;
            onDelta(d);
          }
          if (typeof dr === 'string' && dr.length > 0) reasonAcc += dr;
        } catch {
          // skip
        }
      }
    }
  } else {
    const data = await up.json().catch(() => ({}));
    acc = data?.choices?.[0]?.message?.content ?? '';
    reasonAcc = data?.choices?.[0]?.message?.reasoning_content ?? '';
    if (acc) onDelta(acc);
  }
  clearTimeout(timer);
  clearBreaker(slug);
  return { content: acc, reasoning: reasonAcc };
}

async function handleTournamentStream(ctx, res) {
  const startedAt = Date.now();
  const cfg = ctx.cfg;
  const t = { ...TOURNAMENT_DEFAULTS, ...(cfg.tournament ?? {}) };
  const answerMax = ANSWER_MAX_TOKENS[ctx.tier] ?? 4096;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  const streamId = `otom-${Date.now()}`;
  const emit = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const answerDelta = (content) =>
    res.write(
      `data: ${JSON.stringify({
        id: streamId,
        object: 'chat.completions',
        choices: [{ index: 0, delta: { content }, finish_reason: null }],
      })}\n\n`,
    );

  if (!ctx.noCache) {
    const cached = cacheGet(ctx.payload);
    if (cached) {
      console.log(`[cache] HIT (${cached.fuzzy ? 'fuzzy' : 'exact'}) age=${Math.round(cached.ageMs / 1000)}s`);
      emit('tournament', { type: 'cache', hit: true, fuzzy: cached.fuzzy, source: cached.value.modelUsed });
      const content = cached.value.content ?? '';
      const chunkSize = 24;
      for (let i = 0; i < content.length; i += chunkSize) {
        answerDelta(content.slice(i, i + chunkSize));
      }
      const durationMs = Date.now() - startedAt;
      appendHistory({
        status: 'ok',
        provider: cached.value.providerUsed ?? 'cache',
        model: cached.value.modelUsed ?? 'cache',
        tier: ctx.tier,
        estimatedTokens: 0,
        durationMs,
        message: content.slice(0, 140),
        tournament: { cacheHit: true },
      });
      emit('otomation_trace', {
        tier: ctx.tier,
        estimatedTokens: 0,
        modelUsed: cached.value.modelUsed ?? 'cache',
        providerUsed: cached.value.providerUsed ?? 'cache',
        durationMs,
        cacheHit: true,
        cacheFuzzy: cached.fuzzy,
      });
      res.write('data: [DONE]\n\n');
      res.end();
      return true;
    }
    console.log('[cache] miss');
  }

  const entries = await discoverAll(10000, true);

  if (isTrivial(ctx.payload)) {
    console.log('[trivial] early-exit, skip tournament');
    emit('tournament', { type: 'trivial', mode: 'early-exit' });
    const slug = warmSlug && !isBroken(warmSlug) ? warmSlug : (pickModelForTier('standart', entries) ?? ctx.primary);
    let output = '';
    try {
      const r = await streamCall(slug, [
        { role: 'system', content: 'You are a helpful assistant. Answer briefly, accurately, and honestly.' + ANTI_HALLUCINATION },
        { role: 'user', content: ctx.payload },
      ], (d) => { output += d; answerDelta(d); }, { maxTokens: 512, sampling: SAMPLING.trivial });
      output = r.content || output;
    } catch (e) {
      output = `Halo! Saya siap membantu. (mode ringan: ${String(e?.message ?? e).slice(0, 80)})`;
      answerDelta(output);
    }
    const durationMs = Date.now() - startedAt;
    const provUsed = parseModelSlug(slug, cfg.providers).provider ?? 'nvidia';
    cachePut(ctx.payload, { content: output, modelUsed: slug, providerUsed: provUsed });
    appendHistory({ status: 'ok', provider: provUsed, model: slug, tier: ctx.tier, estimatedTokens: ctx.tokens, durationMs, message: output.slice(0, 140), tournament: { mode: 'trivial' } });
    emit('otomation_trace', { tier: ctx.tier, estimatedTokens: ctx.tokens, modelUsed: slug, providerUsed: provUsed, durationMs, cacheHit: false, mode: 'trivial' });
    res.write('data: [DONE]\n\n');
    res.end();
    return true;
  }

  let baseSlugs;
  let mode = 'all';
  if (ctx.comboId) {
    const combo = getCombo(ctx.comboId);
    baseSlugs = combo ? combo.models : [];
    mode = combo ? `combo:${combo.name}` : 'combo:missing';
  } else if (ctx.fusionProvider) {
    baseSlugs = entries
      .filter((e) => e.provider === ctx.fusionProvider && CHAT_INCLUDE.test(e.id) && !CHAT_EXCLUDE.test(e.id))
      .map((e) => `${e.provider}/${e.id}`);
    mode = `fusion:${ctx.fusionProvider}`;
  } else {
    baseSlugs = entries
      .filter((e) => CHAT_INCLUDE.test(e.id) && !CHAT_EXCLUDE.test(e.id))
      .map((e) => `${e.provider}/${e.id}`);
  }

  const maxC = t.maxCandidates ?? 24;
  const candidates = baseSlugs.filter((slug) => !isBroken(slug)).slice(0, maxC);

  if (warmSlug && candidates.includes(warmSlug)) {
    candidates.splice(candidates.indexOf(warmSlug), 1);
    candidates.unshift(warmSlug);
  }

  if (candidates.length === 0) {
    emit('tournament', { type: 'error', message: `tidak ada kandidat untuk mode ${mode}` });
    res.write('data: [DONE]\n\n');
    res.end();
    return true;
  }

  const { taskType } = routeTier(ctx.payload);

  const projected = ctx.tokens + candidates.length * 100 + 2048;
  const guard = checkBudget(projected, cfg.creditLimitPerDay);
  if (!guard.ok) {
    emit('tournament', { type: 'error', message: guard.error });
    res.write('data: [DONE]\n\n');
    res.end();
    return true;
  }

  const trace = {
    mode,
    taskType,
    candidates,
    scores: [],
    winner: null,
    refineLoops: 0,
    validation: [],
    reasoningText: '',
    stragglers: [],
    synthesis: false,
    mapping: [],
    judges: [],
    quorumReached: false,
    tests: [],
    toolCalls: [],
    retries: 0,
  };
  emit('tournament', { type: 'fanout', taskType, candidates, mode });

  const reasoningPrompt = reasoningPromptFor(taskType, ctx.payload);
  const batchSize = Math.max(2, t.batchSize ?? 6);
  const quorumTarget = Math.max(1, Math.ceil(candidates.length * (t.quorumRatio ?? 0.6)));
  const collected = [];
  let okCount = 0;
  let startedCount = 0;
  let stop = false;

  const runOne = async (slug) => {
    startedCount += 1;
    emit('tournament', { type: 'progress', index: startedCount - 1, total: candidates.length, slug });
    const { provider, model } = parseModelSlug(slug, cfg.providers);
    const providerId = provider ?? 'nvidia';
    const providerCfg = cfg.providers.find((p) => p.id === providerId);
    const apiKey = providerKey(providerId);
    if (!providerCfg || !providerCfg.enabled || !apiKey) {
      const msg = `provider "${providerId}" unavailable`;
      collected.push({ slug, ok: false, error: msg });
      emit('tournament', { type: 'candidate-done', slug, ok: false, error: msg });
      return;
    }

    let acc = '';
    let lastErr = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const { res: up, timer } = await fetchUpstream(providerCfg, apiKey, model, reasoningPrompt, {
          stream: true,
          maxTokens: t.reasoningMaxTokens,
          timeoutMs: REASONING_TIMEOUT,
          sampling: SAMPLING.reasoning,
        });
        if (!up.ok) {
          clearTimeout(timer);
          const data = await up.json().catch(() => ({}));
          const err = new Error(data?.error?.message ?? `HTTP ${up.status}`);
          err.status = up.status;
          throw err;
        }
        const ct = (up.headers.get('content-type') ?? '').toLowerCase();
        acc = '';
        if (ct.includes('text/event-stream')) {
          for await (const chunk of Readable.fromWeb(up.body)) {
            for (const line of chunk.toString().split('\n')) {
              const trimmed = line.trim();
              if (!trimmed.startsWith('data:')) continue;
              const payload = trimmed.slice(5).trim();
              if (payload === '[DONE]') continue;
              try {
                const parsed = JSON.parse(payload);
                const delta = parsed.choices?.[0]?.delta;
                const d = delta?.reasoning_content ?? delta?.content ?? '';
                if (typeof d === 'string' && d.length > 0) {
                  acc += d;
                  emit('reasoning', { slug, delta: d });
                }
              } catch {
                // skip
              }
            }
          }
        } else {
          const data = await up.json().catch(() => ({}));
          const msg = data?.choices?.[0]?.message;
          acc = msg?.reasoning_content ?? msg?.content ?? '';
          if (acc) emit('reasoning', { slug, delta: acc });
        }
        clearTimeout(timer);
        clearBreaker(slug);
        lastErr = null;
        break;
      } catch (e2) {
        lastErr = e2;
        const st = e2?.status;
        if (st === 404) break;
        if (st === 429) {
          await sleep(5000 * attempt);
          continue;
        }
        if (st === undefined || st >= 500) {
          await sleep(2000);
          continue;
        }
        break;
      }
    }

    if (lastErr) {
      if (lastErr.status !== 429 && lastErr.status !== 404) tripBreaker(slug);
      const msg = String(lastErr?.message ?? lastErr);
      collected.push({ slug, ok: false, error: msg });
      emit('tournament', { type: 'candidate-done', slug, ok: false, error: msg });
    } else {
      okCount += 1;
      collected.push({ slug, ok: true, reasoning: acc });
      emit('tournament', { type: 'candidate-done', slug, ok: true });
    }
  };

  const queue = [...candidates];
  const workers = Array.from({ length: Math.min(batchSize, queue.length) }, async () => {
    while (queue.length > 0 && !stop) {
      const slug = queue.shift();
      await runOne(slug);
    }
  });

  const quorumWait = (async () => {
    while (okCount < quorumTarget && !stop) await sleep(200);
  })();

  await Promise.race([
    Promise.all(workers),
    quorumWait.then(() => {
      stop = true;
      trace.quorumReached = true;
    }),
    sleep(QUORUM_DEADLINE).then(() => {
      stop = true;
    }),
  ]);
  await Promise.allSettled(workers);

  const notStarted = queue.slice();
  const alive = collected.filter((r) => r.ok && r.reasoning.trim().length > 0);
  trace.stragglers = [...collected.filter((r) => !r.ok).map((r) => r.slug), ...notStarted];
  trace.reasoningText = alive.map((r) => `== ${r.slug} ==\n${r.reasoning}`).join('\n\n');
  emit('tournament', {
    type: 'quorum',
    alive: alive.map((r) => r.slug),
    stragglers: trace.stragglers,
    quorumReached: trace.quorumReached,
  });

  if (alive.length === 0) {
    emit('tournament', { type: 'error', message: 'semua model gagal pada tahap reasoning' });
    appendHistory({
      status: 'error',
      provider: 'n/a',
      model: ctx.primary,
      tier: ctx.tier,
      estimatedTokens: ctx.tokens,
      durationMs: Date.now() - startedAt,
      message: 'fusion: no survivor',
      tournament: trace,
    });
    res.write('data: [DONE]\n\n');
    res.end();
    return true;
  }

  const labels = alive.map((r, i) => `Source ${String.fromCharCode(65 + i)}`);
  trace.mapping = alive.map((r, i) => ({ label: labels[i], model: r.slug }));
  emit('tournament', { type: 'mapping', mapping: trace.mapping });

  const premPick = pickModelForTier('max', entries);
  const judgePool = [];
  if (alive.some((r) => r.slug === premPick)) judgePool.push(premPick);
  for (const r of alive) {
    if (judgePool.length >= 3) break;
    if (!judgePool.includes(r.slug)) judgePool.push(r.slug);
  }
  if (judgePool.length === 0) judgePool.push(alive[0].slug);
  trace.judges = judgePool;
  emit('tournament', { type: 'judges', judges: judgePool });

  const judged = [...alive]
    .sort((a, b) => b.reasoning.length - a.reasoning.length)
    .slice(0, t.maxJudged ?? 8);

  const scoreOf = new Map();
  await Promise.all(
    judged.map(async (r) => {
      const perJudge = await Promise.all(
        judgePool.map(async (j) => {
          if (j === r.slug) return null;
          try {
            const o = await callModel(j, [
              { role: 'system', content: 'Score this reasoning 0-10 for correctness and clarity. Reply exactly: SCORE:<n> and nothing else.' },
              { role: 'user', content: r.reasoning },
            ], { maxTokens: 32, sampling: SAMPLING.judge });
            return parseScoreText(o.content || o.reasoning || '');
          } catch {
            return null;
          }
        }),
      );
      const vals = perJudge.filter((v) => v !== null);
      const score = vals.length > 0 ? median(vals) : 5;
      scoreOf.set(r.slug, score);
      const label = labels[alive.indexOf(r)];
      trace.scores.push({ model: r.slug, label, score, votes: vals });
      emit('tournament', { type: 'score', slug: r.slug, label, score });
    }),
  );

  let winner = judged[0].slug;
  let best = -1;
  for (const r of judged) {
    const s = scoreOf.get(r.slug) ?? 5;
    if (s > best) {
      best = s;
      winner = r.slug;
    }
  }
  trace.winner = winner;
  emit('tournament', { type: 'winner', winner, synthesis: false });

  // ----- 3) AGENT MODE dengan retry ETIMEDOUT -----
  let output = '';
  let toolLoopCount = 0;
  const MAX_TOOL_LOOPS = 5;

  const messagesForModel = [...execPromptFor(taskType, ctx.payload)];
  const allowTools = taskType === 'coding' || taskType === 'reasoning';

  if (allowTools) {
    messagesForModel[0].content += `

You have access to these tools:
- math: evaluate math expressions, params {"expression": "..."} — ALWAYS use for calculations
- web_fetch: fetch URL content, params {"url": "..."} — ALWAYS use for current facts
- file_rw: read/write files, params {"action":"read|write","filename":"...","content":"..."}
- js_sandbox: run JavaScript in safe sandbox, params {"code": "..."} — use to TEST your code
- http_request: make HTTP request, params {"url":"...","method":"GET|POST"}

When you need a tool, output EXACTLY one block like this and stop:
<TOOL_CALL name="math">{"expression": "25 * 37"}</TOOL_CALL>

The system will execute it and reply with <TOOL_RESULT>...</TOOL_RESULT>.
Then continue to the final answer. Never include TOOL_CALL blocks in the final answer.`;
  }

  const cfgForTool = readConfig();
  const { provider: winProvider, model: winModel } = parseModelSlug(winner, cfgForTool.providers);
  const winProviderId = winProvider ?? 'nvidia';
  const winProviderCfg = cfgForTool.providers.find((p) => p.id === winProviderId);
  const winApiKey = providerKey(winProviderId);
  const execSampling = samplingFor(taskType);
  const execTimeout = taskType === 'coding' ? EXEC_TIMEOUT_CODING : EXEC_TIMEOUT_DEFAULT;

  const makeFilter = (onSafe) => {
    const OPEN = '<TOOL_CALL';
    const CLOSE = '</TOOL_CALL>';
    let held = '';
    let inCall = false;
    const tailPrefixLen = (s) => {
      let max = 0;
      for (let k = 1; k < OPEN.length; k += 1) {
        if (s.endsWith(OPEN.slice(0, k))) max = k;
      }
      return max;
    };
    return {
      push(chunk) {
        held += chunk;
        for (;;) {
          if (!inCall) {
            const oi = held.indexOf(OPEN);
            if (oi === -1) {
              const keep = tailPrefixLen(held);
              const sendable = held.slice(0, held.length - keep);
              if (sendable) onSafe(sendable);
              held = held.slice(held.length - keep);
              return;
            }
            if (oi > 0) onSafe(held.slice(0, oi));
            held = held.slice(oi);
            inCall = true;
            continue;
          }
          const ci = held.indexOf(CLOSE);
          if (ci === -1) return;
          held = held.slice(ci + CLOSE.length);
          inCall = false;
        }
      },
      flush() {
        if (!inCall && held) onSafe(held);
        held = '';
        inCall = false;
      },
    };
  };

  try {
    if (!winProviderCfg || !winProviderCfg.enabled || !winApiKey) {
      throw new Error(`provider "${winProviderId}" unavailable`);
    }

    let streamRetryCount = 0;
    const MAX_STREAM_RETRIES = 2;

    while (toolLoopCount <= MAX_TOOL_LOOPS) {
      let loopContent = '';
      const filter = makeFilter((safeText) => {
        output += safeText;
        answerDelta(safeText);
      });

      let up, timer;
      try {
        const result = await fetchUpstream(winProviderCfg, winApiKey, winModel, messagesForModel, {
          stream: true,
          maxTokens: answerMax,
          timeoutMs: execTimeout,
          sampling: execSampling,
        });
        up = result.res;
        timer = result.timer;

        if (!up.ok) {
          clearTimeout(timer);
          const data = await up.json().catch(() => ({}));
          throw new Error(data?.error?.message ?? `HTTP ${up.status}`);
        }

        streamRetryCount = 0;

        const ct = (up.headers.get('content-type') ?? '').toLowerCase();
        if (ct.includes('text/event-stream')) {
          for await (const chunk of Readable.fromWeb(up.body)) {
            for (const line of chunk.toString().split('\n')) {
              const trimmed = line.trim();
              if (!trimmed.startsWith('data:')) continue;
              const payload = trimmed.slice(5).trim();
              if (payload === '[DONE]') continue;
              try {
                const parsed = JSON.parse(payload);
                const d = parsed.choices?.[0]?.delta?.content ?? '';
                if (typeof d === 'string' && d.length > 0) {
                  loopContent += d;
                  filter.push(d);
                }
              } catch {
                // skip
              }
            }
          }
        } else {
          const data = await up.json().catch(() => ({}));
          loopContent = data?.choices?.[0]?.message?.content ?? '';
          filter.push(loopContent);
        }
        clearTimeout(timer);
        filter.flush();
      } catch (streamError) {
        if (timer) clearTimeout(timer);
        const errMsg = String(streamError?.message ?? streamError);
        const isTimeout = streamError?.code === 'ETIMEDOUT' ||
                          streamError?.cause?.code === 'ETIMEDOUT' ||
                          errMsg.includes('ETIMEDOUT') ||
                          errMsg.includes('aborted');

        if (isTimeout && streamRetryCount < MAX_STREAM_RETRIES) {
          streamRetryCount += 1;
          trace.retries += 1;
          console.log(`[agent] stream timeout/network error, retry ${streamRetryCount}/${MAX_STREAM_RETRIES}...`);
          emit('tournament', { type: 'retry', reason: 'timeout', attempt: streamRetryCount });
          await sleep(3000 * streamRetryCount);
          continue;
        }

        throw streamError;
      }

      messagesForModel.push({ role: 'assistant', content: loopContent });

      const loopToolCalls = [];
      const re = /<TOOL_CALL name="([^"]+)">([\s\S]*?)<\/TOOL_CALL>/g;
      let m;
      while ((m = re.exec(loopContent)) !== null) {
        let toolParams = {};
        try {
          toolParams = JSON.parse(m[2]);
        } catch {
          toolParams = {};
        }
        loopToolCalls.push({ name: m[1], params: toolParams });
      }

      if (loopToolCalls.length === 0 || toolLoopCount === MAX_TOOL_LOOPS) break;

      toolLoopCount += 1;
      console.log(`[agent] loop ${toolLoopCount}: ${loopToolCalls.length} tool calls`);
      emit('tournament', { type: 'tool_calls', count: loopToolCalls.length, loop: toolLoopCount });

      const resultLines = [];
      for (const tc of loopToolCalls) {
        console.log(`[tool] calling ${tc.name} with`, tc.params);
        emit('tournament', { type: 'tool_call', name: tc.name, params: tc.params });
        const result = await executeToolCall(tc.name, tc.params);
        console.log(`[tool] ${tc.name} result:`, result);
        emit('tournament', { type: 'tool_result', name: tc.name, result });
        trace.toolCalls.push({ name: tc.name, params: tc.params, result });
        resultLines.push(`<TOOL_RESULT name="${tc.name}">${JSON.stringify(result)}</TOOL_RESULT>`);
      }

      messagesForModel.push({
        role: 'user',
        content: `${resultLines.join('\n')}\nContinue and produce the final answer now. Do not output TOOL_CALL blocks unless another tool is needed.`,
      });
    }
  } catch (e) {
    if (!output) {
      output = alive.find((r) => r.slug === winner)?.reasoning ?? `Error: ${String(e?.message ?? e)}`;
      answerDelta(output);
    }
    console.error('[agent] error:', e);
  }

  // ----- 3.5) CONTINUATION DETECTION -----
  const openFences = (output.match(/```/g) ?? []).length;
  const codeStarts = (output.match(/```\w+\n/g) ?? []).length;
  const isTruncated = taskType === 'coding' && codeStarts > 0 && openFences % 2 !== 0;
  if (isTruncated && output.length > 500) {
    console.log('[continuation] detected truncated output, asking model to continue');
    emit('tournament', { type: 'continuation', reason: 'truncated code' });
    messagesForModel.push({ role: 'assistant', content: output });
    messagesForModel.push({
      role: 'user',
      content: 'Your previous response was cut off mid-code. Continue EXACTLY from where you stopped. Do NOT repeat any code you already wrote. Do NOT add explanations. Just output the remaining code until all fences and brackets are properly closed.',
    });
    try {
      const filter2 = makeFilter((safeText) => {
        output += safeText;
        answerDelta(safeText);
      });
      const { res: up2, timer: timer2 } = await fetchUpstream(winProviderCfg, winApiKey, winModel, messagesForModel, {
        stream: true,
        maxTokens: answerMax,
        timeoutMs: execTimeout,
        sampling: execSampling,
      });
      if (up2.ok) {
        const ct2 = (up2.headers.get('content-type') ?? '').toLowerCase();
        if (ct2.includes('text/event-stream')) {
          for await (const chunk of Readable.fromWeb(up2.body)) {
            for (const line of chunk.toString().split('\n')) {
              const trimmed = line.trim();
              if (!trimmed.startsWith('data:')) continue;
              const payload = trimmed.slice(5).trim();
              if (payload === '[DONE]') continue;
              try {
                const parsed = JSON.parse(payload);
                const d = parsed.choices?.[0]?.delta?.content ?? '';
                if (typeof d === 'string' && d.length > 0) filter2.push(d);
              } catch {
                // skip
              }
            }
          }
        }
        clearTimeout(timer2);
        filter2.flush();
      }
    } catch (e) {
      console.error('[continuation] failed:', e.message);
    }
  }

  // ----- 4) VALIDATION (SMART SKIP) -----
  const toolVerified = trace.toolCalls.length > 0 && output.trim().length > 10;
  if (toolVerified) {
    console.log('[validation] skipped: tool-verified answer');
    trace.validation.push('skipped (tool-verified)');
    emit('tournament', { type: 'validation', validation: trace.validation });
  } else {
    const validator = judgePool[0];
    for (let loop = 1; loop <= t.maxRefineLoops; loop += 1) {
      let pass = true;
      const issues = [];

      if (taskType === 'coding') {
        const blocks = extractJsBlocks(output);
        for (let bi = 0; bi < blocks.length; bi += 1) {
          const r = runJsTests(blocks[bi]);
          trace.tests.push({ block: bi + 1, ...r });
          console.log(`[testrunner] block ${bi + 1}:`, r);
          if (!r.syntaxOk) {
            pass = false;
            issues.push(`block ${bi + 1} syntax: ${r.stderr}`);
          } else if (r.ran && r.execOk === false) {
            pass = false;
            issues.push(`block ${bi + 1} runtime: ${r.stderr || 'exit non-zero'}`);
          }
        }
        const passed = trace.tests.filter((x) => x.execOk === true).length;
        const skipped = trace.tests.filter((x) => x.execOk === null).length;
        trace.validation.push(`tests: ${passed}/${trace.tests.length} passed, ${skipped} skipped`);
      }

      try {
        const validatorPrompt = taskType === 'coding'
          ? `You are a senior code reviewer. Validate this code answer:
- Is the code syntactically correct?
- Does it fully address the task (all requested files/components)?
- Is the output complete (no "...", no "continued in next message")?
- For Laravel/Express/Django: does it include migration, model, controller, routes, views?

IMPORTANT: If the code is complete and correct, always say VERDICT:YES even if it is long.
Length is NOT a defect — completeness is the goal.

Reply exactly: VERDICT:YES or VERDICT:NO then ISSUES:<brief text if NO>.`
          : `Validate: efficient, well-structured, error-free, fully addresses the task, answer complete and not truncated.
Reply: VERDICT:YES or VERDICT:NO then ISSUES:<text>.`;

        const judgeOut = await callModel(validator, [
          { role: 'system', content: validatorPrompt },
          { role: 'user', content: `TASK:\n${ctx.payload}\n\nANSWER:\n${output.slice(0, 12000)}` },
        ], { maxTokens: 128, sampling: SAMPLING.judge });
        const vt = judgeOut.content || judgeOut.reasoning || '';
        const okJ = /VERDICT:\s*YES/i.test(vt);
        if (!okJ) {
          pass = false;
          issues.push(extractIssuesText(vt) || 'judge rejected');
        }
        trace.validation.push(`loop${loop}: ${okJ ? 'YES' : 'NO'}`);
      } catch {
        trace.validation.push(`loop${loop}: YES (judge unreachable)`);
      }
      emit('tournament', { type: 'validation', validation: trace.validation });

      if (pass) break;
      trace.refineLoops = loop;
      if (loop === t.maxRefineLoops) break;

      emit('tournament', { type: 'refine', issues });
      res.write(`event: answer_reset\ndata: {}\n\n`);
      try {
        const r = await streamCall(winner, [
          ...execPromptFor(taskType, ctx.payload),
          { role: 'assistant', content: output },
          { role: 'user', content: `Improve the answer. Fix these issues: ${issues.join('; ')}. Output ONLY the improved COMPLETE answer, do not truncate.` },
        ], answerDelta, { maxTokens: answerMax, sampling: execSampling });
        output = r.content || r.reasoning || output;
        if (!r.content && r.reasoning) answerDelta(r.reasoning);
      } catch {
        break;
      }
    }
  }

  const durationMs = Date.now() - startedAt;
  warmSlug = winner;
  const winnerProvider = parseModelSlug(winner, cfgForTool.providers).provider ?? 'nvidia';
  const usage = recordUsage(winnerProvider, ctx.tokens);

  cachePut(ctx.payload, {
    content: output,
    modelUsed: winner,
    providerUsed: winnerProvider,
  });
  console.log('[cache] stored');

  appendHistory({
    status: 'ok',
    provider: winnerProvider,
    model: winner,
    tier: ctx.tier,
    estimatedTokens: ctx.tokens,
    durationMs,
    message: output.slice(0, 140),
    tournament: trace,
  });

  emit('otomation_trace', {
    tier: ctx.tier,
    estimatedTokens: ctx.tokens,
    modelUsed: winner,
    providerUsed: winnerProvider,
    compressedTokens: ctx.compressed.estimatedTokens,
    droppedMessages: ctx.compressed.droppedMessages,
    usageToday: usage.totalTokens,
    durationMs,
    isReasoningModel: true,
    cacheHit: false,
    tournament: trace,
  });
  res.write('data: [DONE]\n\n');
  res.end();
  return true;
}

function prepareChat(body) {
  const cfg = readConfig();
  const incoming = Array.isArray(body?.messages) ? body.messages : [];
  if (incoming.length === 0) {
    return { error: { status: 400, body: { error: { message: 'messages array is required' } } } };
  }
  const lastUser = [...incoming].reverse().find((m) => m.role === 'user');
  const payload = String(lastUser?.content ?? '');
  if (payload.trim().length === 0) {
    return { error: { status: 400, body: { error: { message: 'empty user message' } } } };
  }
  const forced =
    typeof body.model === 'string' && body.model && body.model !== 'auto' ? body.model : null;
  const fusionProvider = typeof body.fusionProvider === 'string' && body.fusionProvider ? body.fusionProvider : null;
  const comboId = typeof body.comboId === 'string' && body.comboId ? body.comboId : null;
  const noCache = body.noCache === true;

  const { tier, tokens } = routeTier(payload);
  if (tier === null) {
    return {
      error: {
        status: 400,
        body: { error: { message: 'Context exceeds premium limit. Split the task or compress input.' } },
      },
    };
  }
  const guard = checkBudget(tokens, cfg.creditLimitPerDay);
  if (!guard.ok) {
    return { error: { status: 429, body: { error: { message: guard.error } } } };
  }
  const override = cfg.tiers?.[tier] ?? null;
  const primary = forced ?? override ?? pickModelForTier(tier, catalogCache.entries) ?? cfg.model;
  const candidates = forced ? [forced] : [primary, ...cfg.fallbackModels.filter((m) => m !== primary)];

  const compressed = compressMessages(incoming, PREMIUM_BUDGET);
  const finalMessages = compressed.summary
    ? [{ role: 'system', content: `Compressed context summary: ${compressed.summary}` }, ...compressed.messages]
    : compressed.messages;

  return {
    ctx: { cfg, tier, tokens, override, primary, candidates, compressed, finalMessages, payload, forced, fusionProvider, comboId, noCache },
  };
}

async function resolveUpstream(candidates, finalMessages, stream, maxTokens) {
  const cfg = readConfig();
  let lastError = null;
  for (const slug of candidates) {
    const { provider, model } = parseModelSlug(slug, cfg.providers);
    const providerId = provider ?? 'nvidia';
    const providerCfg = cfg.providers.find((p) => p.id === providerId);
    const apiKey = providerKey(providerId);
    if (!providerCfg || !providerCfg.enabled || !apiKey) {
      lastError = new Error(`provider "${providerId}" not enabled or no key`);
      continue;
    }
    let slugSucceeded = false;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const { res, timer } = await fetchUpstream(providerCfg, apiKey, model, finalMessages, { stream, maxTokens });
        if (!res.ok) {
          clearTimeout(timer);
          const data = await res.json().catch(() => ({}));
          const error = new Error(data?.error?.message ?? `HTTP ${res.status}`);
          error.status = res.status;
          lastError = error;
          if (!isRetryable(error)) break;
          continue;
        }
        clearBreaker(slug);
        slugSucceeded = true;
        return { providerId, model, slug, res, timer };
      } catch (error) {
        lastError = error;
        if (!isRetryable(error)) break;
      }
    }
    if (!slugSucceeded && lastError) tripBreaker(slug);
  }
  return { providerId: null, model: null, slug: null, res: null, timer: null, lastError };
}

function buildSuccessBody(ctx, providerId, slug, choice, reasoning, content, durationMs, streamSupported, tournament) {
  const usage = recordUsage(providerId, ctx.tokens);
  appendHistory({
    status: 'ok',
    provider: providerId,
    model: slug,
    tier: ctx.tier,
    estimatedTokens: ctx.tokens,
    durationMs,
    message: (content || reasoning).slice(0, 140),
    ...(tournament ? { tournament } : {}),
  });
  return {
    id: `otom-${Date.now()}`,
    object: 'chat.completions',
    model: slug,
    choices: [{
      index: 0,
      message: { role: 'assistant', content, ...(reasoning ? { reasoning_content: reasoning } : {}) },
      finish_reason: choice?.finish_reason ?? 'stop',
    }],
    usage: {
      prompt_tokens: ctx.compressed.estimatedTokens,
      completion_tokens: estimateTokens(content) + estimateTokens(reasoning),
      total_tokens: ctx.compressed.estimatedTokens + estimateTokens(content) + estimateTokens(reasoning),
    },
    otomation_trace: {
      tier: ctx.tier,
      estimatedTokens: ctx.tokens,
      modelUsed: slug,
      providerUsed: providerId,
      overrideUsed: ctx.override !== null || ctx.forced !== null,
      fallbackUsed: slug !== ctx.primary,
      compressedTokens: ctx.compressed.estimatedTokens,
      droppedMessages: ctx.compressed.droppedMessages,
      usageToday: usage.totalTokens,
      durationMs,
      isReasoningModel: reasoning.length > 0,
      reasoningTokens: estimateTokens(reasoning),
      streamSupported,
      ...(tournament ? { tournament } : {}),
    },
  };
}

async function handleBuffered(ctx, res) {
  const startedAt = Date.now();
  const answerMax = ANSWER_MAX_TOKENS[ctx.tier] ?? 4096;
  const { providerId, slug, res: upstream, timer, lastError } = await resolveUpstream(ctx.candidates, ctx.finalMessages, false, answerMax);
  if (!upstream) {
    appendHistory({
      status: 'error', provider: 'n/a', model: ctx.primary, tier: ctx.tier,
      estimatedTokens: ctx.tokens, durationMs: Date.now() - startedAt,
      message: String(lastError?.message ?? lastError),
    });
    json(res, 502, { error: { message: `All candidates failed: ${lastError?.message ?? lastError}` } });
    return;
  }
  try {
    const data = await upstream.json().catch(() => ({}));
    const choice = data?.choices?.[0];
    const content = choice?.message?.content ?? '';
    const reasoning = choice?.message?.reasoning_content ?? '';
    warmSlug = slug;
    json(res, 200, buildSuccessBody(ctx, providerId, slug, choice, reasoning, content, Date.now() - startedAt, false));
  } finally {
    clearTimeout(timer);
  }
}

async function handleStream(ctx, res) {
  const startedAt = Date.now();
  const answerMax = ANSWER_MAX_TOKENS[ctx.tier] ?? 4096;
  const { providerId, slug, res: upstream, timer, lastError } = await resolveUpstream(ctx.candidates, ctx.finalMessages, true, answerMax);
  if (!upstream) {
    appendHistory({
      status: 'error', provider: 'n/a', model: ctx.primary, tier: ctx.tier,
      estimatedTokens: ctx.tokens, durationMs: Date.now() - startedAt,
      message: String(lastError?.message ?? lastError),
    });
    json(res, 502, { error: { message: `All candidates failed: ${lastError?.message ?? lastError}` } });
    return;
  }
  const contentType = (upstream.headers.get('content-type') ?? '').toLowerCase();
  const isSse = contentType.includes('text/event-stream');
  if (!isSse) {
    try {
      const data = await upstream.json().catch(() => ({}));
      const choice = data?.choices?.[0];
      const content = choice?.message?.content ?? '';
      const reasoning = choice?.message?.reasoning_content ?? '';
      warmSlug = slug;
      json(res, 200, buildSuccessBody(ctx, providerId, slug, choice, reasoning, content, Date.now() - startedAt, false));
    } finally {
      clearTimeout(timer);
    }
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  let contentAcc = '';
  let reasoningAcc = '';
  try {
    for await (const chunk of Readable.fromWeb(upstream.body)) {
      res.write(chunk);
      for (const line of chunk.toString().split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const parsed = JSON.parse(payload);
          const delta = parsed.choices?.[0]?.delta;
          if (!delta) continue;
          if (typeof delta.content === 'string') contentAcc += delta.content;
          if (typeof delta.reasoning_content === 'string') reasoningAcc += delta.reasoning_content;
        } catch {
          // skip
        }
      }
    }
  } finally {
    clearTimeout(timer);
  }
  const durationMs = Date.now() - startedAt;
  warmSlug = slug;
  const usage = recordUsage(providerId, ctx.tokens);
  appendHistory({
    status: 'ok', provider: providerId, model: slug, tier: ctx.tier,
    estimatedTokens: ctx.tokens, durationMs, message: (contentAcc || reasoningAcc).slice(0, 140),
  });
  res.write(
    `event: otomation_trace\ndata: ${JSON.stringify({
      tier: ctx.tier, estimatedTokens: ctx.tokens, modelUsed: slug, providerUsed: providerId,
      overrideUsed: ctx.override !== null || ctx.forced !== null, fallbackUsed: slug !== ctx.primary,
      compressedTokens: ctx.compressed.estimatedTokens, droppedMessages: ctx.compressed.droppedMessages,
      usageToday: usage.totalTokens, durationMs, isReasoningModel: reasoningAcc.length > 0,
      reasoningTokens: estimateTokens(reasoningAcc), contentTokens: estimateTokens(contentAcc), streamSupported: true,
    })}\n\n`,
  );
  res.end();
}

let lastPingAt = 0;
setInterval(async () => {
  const cfg = readConfig();
  const now = Date.now();
  if (!cfg.keepWarm || !warmSlug) return;
  if (now - lastPingAt < cfg.keepWarmIntervalMs) return;
  lastPingAt = now;
  const { provider, model } = parseModelSlug(warmSlug, cfg.providers);
  const providerId = provider ?? 'nvidia';
  const providerCfg = cfg.providers.find((p) => p.id === providerId);
  const apiKey = providerKey(providerId);
  if (!providerCfg || !apiKey) return;
  try {
    const { timer } = await fetchUpstream(providerCfg, apiKey, model, [{ role: 'user', content: 'ping' }], {
      timeoutMs: 30000,
      maxTokens: 1,
    });
    clearTimeout(timer);
  } catch {
    // tidak fatal
  }
}, 60000).unref();

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  if (req.method === 'OPTIONS') {
    json(res, 204, {});
    return;
  }
  try {
    if (req.method === 'GET' && url.pathname === '/v1/models') {
      const entries = await discoverAll();
      json(res, 200, { object: 'list', data: entries.map((e) => ({ id: `${e.provider}/${e.id}`, object: 'model' })) });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
      discoverAll().catch(() => {});
      const raw = await readBody(req);
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        json(res, 400, { error: { message: 'invalid JSON body' } });
        return;
      }
      const prepared = prepareChat(body);
      if (prepared.error) {
        json(res, prepared.error.status, prepared.error.body);
        return;
      }
      const t = { ...TOURNAMENT_DEFAULTS, ...(prepared.ctx.cfg.tournament ?? {}) };
      const tournamentRequested =
        body.otomation_tournament !== false && t.enabled && !prepared.ctx.forced;
      if (tournamentRequested && body.stream === true) {
        const handled = await handleTournamentStream(prepared.ctx, res);
        if (handled) return;
      }
      if (body.stream === true) {
        await handleStream(prepared.ctx, res);
      } else {
        await handleBuffered(prepared.ctx, res);
      }
      return;
    }

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
        providers: Array.isArray(candidate.providers) ? candidate.providers : current.providers,
        tournament: { ...current.tournament, ...(candidate.tournament ?? {}) },
      };
      writeConfig(merged);
      json(res, 200, merged);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/admin/api/keys') {
      json(res, 200, { keys: redactedKeys() });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/admin/api/keys') {
      const raw = await readBody(req);
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        json(res, 400, { error: { message: 'invalid JSON body' } });
        return;
      }
      const { provider, key } = body ?? {};
      if (typeof provider !== 'string' || typeof key !== 'string' || key.trim().length === 0) {
        json(res, 422, { error: { message: 'provider and non-empty key are required' } });
        return;
      }
      setKey(provider.trim(), key.trim());
      json(res, 200, { keys: redactedKeys() });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/admin/api/combos') {
      json(res, 200, { combos: listCombos() });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/admin/api/combos') {
      const raw = await readBody(req);
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        json(res, 400, { error: { message: 'invalid JSON body' } });
        return;
      }
      const { name, models } = body ?? {};
      if (typeof name !== 'string' || name.trim().length === 0 || !Array.isArray(models) || models.length === 0) {
        json(res, 422, { error: { message: 'name and non-empty models array are required' } });
        return;
      }
      json(res, 200, createCombo(name.trim(), models));
      return;
    }

    if (req.method === 'DELETE' && url.pathname.startsWith('/admin/api/combos/')) {
      const id = url.pathname.split('/').pop() ?? '';
      deleteCombo(id);
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/admin/api/cache') {
      json(res, 200, cacheStats());
      return;
    }

    if (req.method === 'DELETE' && url.pathname === '/admin/api/cache') {
      cacheClear();
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/admin/api/chats') {
      json(res, 200, { chats: listChats() });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/admin/api/chats') {
      const raw = await readBody(req);
      let chat;
      try {
        chat = JSON.parse(raw);
      } catch {
        json(res, 400, { error: { message: 'invalid JSON body' } });
        return;
      }
      if (typeof chat?.id !== 'string' || !Array.isArray(chat?.messages)) {
        json(res, 422, { error: { message: 'chat.id and chat.messages are required' } });
        return;
      }
      json(res, 200, upsertChat(chat));
      return;
    }

    if (req.method === 'DELETE' && url.pathname.startsWith('/admin/api/chats/')) {
      const id = url.pathname.split('/').pop() ?? '';
      removeChat(id);
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/admin/api/status') {
      const cfg = readConfig();
      json(res, 200, {
        usage: readUsage(),
        history: readHistory().slice(0, 20),
        discoveredModels: catalogCache.entries.length,
        warmModel: warmSlug,
        keys: redactedKeys(),
        circuit: circuitStatus(),
        cache: cacheStats(),
        providers: cfg.providers.map((p) => ({
          id: p.id,
          baseUrl: p.baseUrl,
          enabled: p.enabled,
          hasKey: providerKey(p.id) !== null,
        })),
        creditLimitPerDay: cfg.creditLimitPerDay,
      });
      return;
    }

    json(res, 404, { error: { message: `Gateway: route tidak dikenal ${url.pathname}` } });
  } catch (error) {
    json(res, 502, { error: { message: `Gateway: ${String(error?.message ?? error)}` } });
  }
});

server.listen(PORT, () => {
  console.log(`otomation-setting AI Gateway (Genius Frugal Mode + silent compliance) siap di http://localhost:${PORT}/v1`);
});