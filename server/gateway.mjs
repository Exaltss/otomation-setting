/**
 * otomation-setting AI Gateway — Fusion Tournament v3 (Fase 18).
 * Paralel + quorum, ensemble judge (median 3), task-aware prompts.
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
import { syntaxCheckCode, TOURNAMENT_DEFAULTS } from './lib/tournament.mjs';
import { circuitStatus, clearBreaker, isBroken, tripBreaker } from './lib/circuit.mjs';

const PORT = process.env.PORT ?? 4123;
const PREMIUM_BUDGET = 16384;

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
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

// ---------- discovery gabungan ----------
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

// ---------- fetch upstream ----------
async function fetchUpstream(providerCfg, apiKey, model, messages, { timeoutMs = 120000, maxTokens = 512, stream = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${providerCfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens, stream }),
      signal: controller.signal,
    });
    return { res, timer };
  } catch (error) {
    clearTimeout(timer);
    throw error;
  }
}

const isRetryable = (e) => e.status === 429 || e.status >= 500 || e.status === undefined;

async function callModel(slug, messages, { maxTokens = 512 } = {}) {
  const cfg = readConfig();
  const { provider, model } = parseModelSlug(slug, cfg.providers);
  const providerId = provider ?? 'nvidia';
  const providerCfg = cfg.providers.find((p) => p.id === providerId);
  const apiKey = providerKey(providerId);
  if (!providerCfg || !providerCfg.enabled || !apiKey) {
    throw new Error(`provider "${providerId}" unavailable`);
  }

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const { res, timer } = await fetchUpstream(providerCfg, apiKey, model, messages, { maxTokens, timeoutMs: 90000 });
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
        await sleep(1500);
        continue;
      }
      tripBreaker(slug);
      throw error;
    }
  }
  throw new Error('callModel: retries exhausted');
}

let warmSlug = null;

// ---------- helper ----------
function parseScoreText(text) {
  const m = String(text).match(/SCORE:\s*(\d+)/i);
  if (m) return Math.min(10, parseInt(m[1], 10));
  const n = String(text).match(/\b(10|[0-9])\b/);
  return n ? Math.min(10, parseInt(n[1], 10)) : 5;
}

function extractIssuesText(text) {
  const m = String(text).match(/ISSUES:\s*([^\n]+)/i);
  return m ? m[1].trim() : '';
}

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

// ---------- task-aware prompts (Point 8) ----------
function reasoningPromptFor(taskType, payload) {
  const base = {
    coding: 'Plan the implementation step by step: choose approach, handle edge cases, note correctness checks. Output concise reasoning only.',
    reasoning: 'Solve step by step: identify the right principles, derive carefully, double-check the final result. Output concise reasoning only.',
    writing: 'Plan structure, tone, and key points step by step for the target language. Output concise reasoning only.',
    general: 'Think step by step. Output concise reasoning only.',
  };
  return [
    { role: 'system', content: base[taskType] ?? base.general },
    { role: 'user', content: payload },
  ];
}

function execPromptFor(taskType, payload) {
  const sys = {
    coding: 'Produce ONLY the final complete code in a fenced code block plus a short usage example. No reasoning.',
    reasoning: 'Produce ONLY the final answer with clear concise steps and the final result highlighted. No extra commentary.',
    writing: 'Produce ONLY the final text, in the same language as the request. No reasoning.',
    general: 'Produce ONLY the final complete answer. No reasoning.',
  };
  return [
    { role: 'system', content: sys[taskType] ?? sys.general },
    { role: 'user', content: payload },
  ];
}

/** Stream jawaban; kembalikan {content, reasoning} agar ada fallback. */
async function streamCall(slug, messages, onDelta, { maxTokens = 1024 } = {}) {
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
    timeoutMs: 120000,
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

// ---------- classifier lokal ----------
function classifyTaskLocal(text) {
  const t = String(text).toLowerCase();
  if (['kode', 'code', 'coding', 'fungsi', 'function', 'bug', 'script', 'regex', 'sql', 'python', 'javascript', 'typescript', 'refactor'].some((s) => t.includes(s))) return 'coding';
  if (['analisis', 'analysis', 'mengapa', 'why', 'bandingkan', 'compare', 'strategi', 'rumus', 'matematika', 'hitung'].some((s) => t.includes(s))) return 'reasoning';
  if (['tulis', 'write', 'artikel', 'essay', 'email', 'ringkas', 'summarize', 'terjemah', 'translate'].some((s) => t.includes(s))) return 'writing';
  return 'general';
}

// ---------- TURNAMEN v3: paralel + quorum + ensemble judge ----------
async function handleTournamentStream(ctx, res) {
  const startedAt = Date.now();
  const cfg = ctx.cfg;
  const t = { ...TOURNAMENT_DEFAULTS, ...(cfg.tournament ?? {}) };

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

  const entries = await discoverAll(10000, true);
  if (entries.length === 0) {
    emit('tournament', { type: 'error', message: 'tidak ada provider aktif dengan API key' });
    res.write('data: [DONE]\n\n');
    res.end();
    return true;
  }

  const taskType = classifyTaskLocal(ctx.payload);

  const maxC = t.maxCandidates ?? 24;
  const candidates = entries
    .filter((e) => CHAT_INCLUDE.test(e.id) && !CHAT_EXCLUDE.test(e.id))
    .map((e) => `${e.provider}/${e.id}`)
    .filter((slug) => !isBroken(slug))
    .slice(0, maxC);

  if (candidates.length === 0) {
    emit('tournament', { type: 'error', message: 'tidak ada model chat-capable yang tersedia' });
    res.write('data: [DONE]\n\n');
    res.end();
    return true;
  }

  const projected = ctx.tokens + candidates.length * 100 + 2048;
  const guard = checkBudget(projected, cfg.creditLimitPerDay);
  if (!guard.ok) {
    emit('tournament', { type: 'error', message: guard.error });
    res.write('data: [DONE]\n\n');
    res.end();
    return true;
  }

  const trace = {
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
  };
  emit('tournament', { type: 'fanout', taskType, candidates });

  const reasoningPrompt = reasoningPromptFor(taskType, ctx.payload);

  // ----- 1) EVALUASI PARALEL + QUORUM (Point 1) -----
  const batchSize = Math.max(2, t.batchSize ?? 6);
  const quorumTarget = Math.max(3, Math.ceil(candidates.length * (t.quorumRatio ?? 0.6)));
  const collected = [];
  const doneSet = new Set();
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
      doneSet.add(slug);
      emit('tournament', { type: 'candidate-done', slug, ok: false, error: msg });
      return;
    }

    let acc = '';
    let lastErr = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const { res: up, timer } = await fetchUpstream(providerCfg, apiKey, model, reasoningPrompt, {
          stream: true,
          maxTokens: t.reasoningMaxTokens,
          timeoutMs: 20000,
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
        if (e2?.status === 429) {
          await sleep(1500);
          continue;
        }
        break;
      }
    }

    doneSet.add(slug);
    if (lastErr) {
      if (lastErr.status !== 429) tripBreaker(slug);
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
    sleep(60000).then(() => {
      stop = true;
    }),
  ]);
  await Promise.allSettled(workers);

  const notStarted = queue.slice();
  const alive = collected.filter((r) => r.ok && r.reasoning.trim().length > 0);
  trace.stragglers = [
    ...collected.filter((r) => !r.ok).map((r) => r.slug),
    ...notStarted,
  ];
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

  // ----- 2) ENSEMBLE JUDGE (Point 2): 3 judge, median, tanpa self-judging -----
  const labels = alive.map((r, i) => `Source ${String.fromCharCode(65 + i)}`);
  trace.mapping = alive.map((r, i) => ({ label: labels[i], model: r.slug }));
  emit('tournament', { type: 'mapping', mapping: trace.mapping });

  const premPick = pickModelForTier('premium', entries);
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
            ], { maxTokens: 32 });
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

  // ----- 3) OUTPUT FINAL (task-aware exec prompt + fallback reasoning) -----
  let output = '';
  try {
    const r = await streamCall(winner, execPromptFor(taskType, ctx.payload), answerDelta);
    output = r.content || r.reasoning || '';
    if (!r.content && r.reasoning) answerDelta(r.reasoning);
  } catch {
    output = alive.find((r) => r.slug === winner)?.reasoning ?? '';
    if (output) answerDelta(output);
  }

  // ----- 4) VALIDATION LOOP + REFINE -----
  const validator = judgePool[0];
  for (let loop = 1; loop <= t.maxRefineLoops; loop += 1) {
    let pass = true;
    const issues = [];

    if (taskType === 'coding') {
      const problems = syntaxCheckCode(output);
      if (problems.length > 0) {
        pass = false;
        issues.push(`syntax: ${problems.join(' | ')}`);
      }
    }

    try {
      const judgeOut = await callModel(validator, [
        {
          role: 'system',
          content:
            'Validate: efficient, well-structured, error-free, fully addresses the task. Reply: VERDICT:YES or VERDICT:NO then ISSUES:<text>.',
        },
        { role: 'user', content: `TASK:\n${ctx.payload}\n\nANSWER:\n${output}` },
      ], { maxTokens: 128 });
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
        { role: 'user', content: `Improve the answer. Fix these issues: ${issues.join('; ')}. Output ONLY the improved answer.` },
      ], answerDelta, { maxTokens: 1024 });
      output = r.content || r.reasoning || output;
      if (!r.content && r.reasoning) answerDelta(r.reasoning);
    } catch {
      break;
    }
  }

  const durationMs = Date.now() - startedAt;
  warmSlug = winner;
  const winnerProvider = parseModelSlug(winner, cfg.providers).provider ?? 'nvidia';
  const usage = recordUsage(winnerProvider, ctx.tokens);
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
    tournament: trace,
  });
  res.write('data: [DONE]\n\n');
  res.end();
  return true;
}

// ---------- persiapan pipeline ----------
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
    ? [
        { role: 'system', content: `Compressed context summary: ${compressed.summary}` },
        ...compressed.messages,
      ]
    : compressed.messages;

  return {
    ctx: { cfg, tier, tokens, override, primary, candidates, compressed, finalMessages, payload, forced },
  };
}

async function resolveUpstream(candidates, finalMessages, stream) {
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
        const { res, timer } = await fetchUpstream(providerCfg, apiKey, model, finalMessages, { stream });
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
      message: {
        role: 'assistant',
        content,
        ...(reasoning ? { reasoning_content: reasoning } : {}),
      },
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
  const { providerId, slug, res: upstream, timer, lastError } = await resolveUpstream(
    ctx.candidates,
    ctx.finalMessages,
    false,
  );

  if (!upstream) {
    appendHistory({
      status: 'error',
      provider: 'n/a',
      model: ctx.primary,
      tier: ctx.tier,
      estimatedTokens: ctx.tokens,
      durationMs: Date.now() - startedAt,
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
  const { providerId, slug, res: upstream, timer, lastError } = await resolveUpstream(
    ctx.candidates,
    ctx.finalMessages,
    true,
  );

  if (!upstream) {
    appendHistory({
      status: 'error',
      provider: 'n/a',
      model: ctx.primary,
      tier: ctx.tier,
      estimatedTokens: ctx.tokens,
      durationMs: Date.now() - startedAt,
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
    status: 'ok',
    provider: providerId,
    model: slug,
    tier: ctx.tier,
    estimatedTokens: ctx.tokens,
    durationMs,
    message: (contentAcc || reasoningAcc).slice(0, 140),
  });

  res.write(
    `event: otomation_trace\ndata: ${JSON.stringify({
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
      isReasoningModel: reasoningAcc.length > 0,
      reasoningTokens: estimateTokens(reasoningAcc),
      contentTokens: estimateTokens(contentAcc),
      streamSupported: true,
    })}\n\n`,
  );
  res.end();
}

// ---------- keep-warm ----------
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
    // keep-warm gagal = tidak fatal
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
      json(res, 200, {
        object: 'list',
        data: entries.map((e) => ({ id: `${e.provider}/${e.id}`, object: 'model' })),
      });
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

    if (req.method === 'GET' && url.pathname === '/admin/api/status') {
      const cfg = readConfig();
      json(res, 200, {
        usage: readUsage(),
        history: readHistory().slice(0, 20),
        discoveredModels: catalogCache.entries.length,
        warmModel: warmSlug,
        keys: redactedKeys(),
        circuit: circuitStatus(),
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
  console.log(`otomation-setting AI Gateway (Fase 18: parallel+quorum+ensemble) siap di http://localhost:${PORT}/v1`);
});