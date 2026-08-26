/**
 * Server-side engine — 9Router, kompresi, credit guard, multi-provider registry.
 * Tier: standart / high / max. Routing task-aware.
 * Model default: nvidia/nvidia/nemotron-3-super-120b-a12b.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

export const DEFAULT_POLICY = {
  standartMaxTokens: 4096,
  highMaxTokens: 8192,
  maxMaxTokens: 16384,
};

const COMPLEXITY_KEYWORDS = [
  'analisis', 'analysis', 'reasoning', 'audit',
  'arsitek', 'architect', 'strategi', 'strategy', 'refactor',
];

const HEAVY_KEYWORDS = [
  'lengkap', 'complete', 'full', 'penuh',
  'CRUD', 'crud', 'create read update delete',
  'migrasi', 'migration', 'controller', 'model',
  'database', 'program', 'aplikasi', 'application',
  'laravel', 'django', 'express', 'flask', 'fastapi',
  'full stack', 'full-stack', 'end-to-end',
  'microservices', 'monolith', 'arsitektur', 'architecture',
  'design pattern', 'scalability', 'performance', 'optimization',
  'distributed system', 'load balancing', 'caching',
];

const MAX_KEYWORDS = [
  'lengkap', 'complete', 'full', 'CRUD', 'crud',
  'laravel', 'django', 'full stack', 'full-stack',
  'aplikasi', 'application', 'program lengkap',
];

/** EKSPORT: dipakai oleh tournament & gateway */
export function estimateTokens(text) {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

/** EKSPORT: klasifikasi tugas (konsolidasi dari 3 versi lama) */
export function classifyTask(text) {
  const t = String(text).toLowerCase();
  if (['kode', 'code', 'coding', 'fungsi', 'function', 'bug', 'script', 'regex', 'sql', 'python', 'javascript', 'typescript', 'refactor', 'laravel', 'program'].some((s) => t.includes(s))) return 'coding';
  if (['analisis', 'analysis', 'mengapa', 'why', 'bandingkan', 'compare', 'strategi', 'rumus', 'matematika', 'hitung', 'microservices', 'monolith', 'arsitektur', 'architecture'].some((s) => t.includes(s))) return 'reasoning';
  if (['tulis', 'write', 'artikel', 'essay', 'email', 'ringkas', 'summarize', 'terjemah', 'translate'].some((s) => t.includes(s))) return 'writing';
  return 'general';
}

export function routeTier(input, policy = DEFAULT_POLICY) {
  const normalized = String(input).toLowerCase();
  const taskType = classifyTask(input);
  const complex = COMPLEXITY_KEYWORDS.some((k) => normalized.includes(k));
  const heavy = HEAVY_KEYWORDS.some((k) => normalized.toLowerCase().includes(k));
  const maxWorthy = MAX_KEYWORDS.some((k) => normalized.toLowerCase().includes(k));

  let tokens = estimateTokens(input) + (complex ? 1000 : 0);

  // TASK-AWARE OVERRIDE: coding kompleks → paksa ke high/max
  let forcedTier = null;
  if (taskType === 'coding') {
    if (maxWorthy) forcedTier = 'max';
    else if (heavy) forcedTier = 'high';
    else forcedTier = 'high'; // coding selalu minimal high (output kode panjang)
  } else if (taskType === 'reasoning' && heavy) {
    forcedTier = 'high';
  } else if (taskType === 'writing' && maxWorthy) {
    forcedTier = 'high';
  }

  let tier = null;
  if (forcedTier) {
    tier = forcedTier;
  } else if (tokens <= policy.standartMaxTokens) {
    tier = 'standart';
  } else if (tokens <= policy.highMaxTokens) {
    tier = 'high';
  } else if (tokens <= policy.maxMaxTokens) {
    tier = 'max';
  }

  return { tier, tokens, taskType, forced: !!forcedTier };
}

export function parseModelSlug(slug, providers = []) {
  const parts = String(slug).split('/');
  if (parts.length < 2) return { provider: null, model: slug };
  const known = providers.some((p) => p.id === parts[0]);
  if (known || parts.length >= 2) {
    return { provider: parts[0], model: parts.slice(1).join('/') };
  }
  return { provider: null, model: slug };
}

const CHEAP_SIGNALS = ['nano', '4b', '8b', 'small', 'mini', 'flash'];
const PREMIUM_SIGNALS = ['ultra', '405b', '70b', 'nemotron', 'large', 'super'];

const PREFERRED_SLUGS = {
  standart: [
    'nvidia/meta/llama-3.1-8b-instruct',
    'nvidia/meta/llama-3.1-70b-instruct',
  ],
  high: [
    'nvidia/meta/llama-3.1-70b-instruct',
    'nvidia/meta/llama-3.3-70b-instruct',
  ],
  max: [
    'nvidia/nvidia/nemotron-3-super-120b-a12b',
    'nvidia/meta/llama-3.3-70b-instruct',
    'nvidia/nvidia/llama-3.1-nemotron-70b-instruct',
  ],
};

export function normalizeModelId(id) {
  if (typeof id !== 'string') return id;
  return id.startsWith('nvidia_nim/') ? id.slice('nvidia_nim/'.length) : id;
}

export function pickModelForTier(tier, entries) {
  if (!entries.length) return null;
  const slugs = entries.map((e) => `${e.provider}/${e.id}`);

  for (const pref of PREFERRED_SLUGS[tier] ?? []) {
    if (slugs.includes(pref)) return pref;
  }

  const signals = tier === 'standart' ? CHEAP_SIGNALS : PREMIUM_SIGNALS;
  for (const s of signals) {
    const hit = entries.find((e) => e.id.toLowerCase().includes(s));
    if (hit) return `${hit.provider}/${hit.id}`;
  }

  return slugs[0];
}

export function compressMessages(messages, maxTokens) {
  const sanitized = (messages ?? []).filter(
    (m) => m && typeof m.content === 'string' && m.content.trim().length > 0,
  );
  const total = sanitized.reduce((sum, m) => sum + estimateTokens(m.content), 0);

  if (total <= maxTokens) {
    return { messages: sanitized, summary: '', estimatedTokens: total, droppedMessages: 0 };
  }

  const recent = [];
  let recentTokens = 0;
  const recentBudget = Math.floor(maxTokens * 0.7);
  for (let i = sanitized.length - 1; i >= 0; i -= 1) {
    const t = estimateTokens(sanitized[i].content);
    if (recentTokens + t > recentBudget) break;
    recent.unshift(sanitized[i]);
    recentTokens += t;
  }

  const dropped = sanitized.length - recent.length;
  const old = sanitized.slice(0, dropped);
  const summaryBudget = Math.max(0, maxTokens - recentTokens);

  let summary = '';
  if (summaryBudget > 0 && old.length > 0) {
    const src = old.map((m) => `${m.role}: ${m.content}`).join(' | ');
    summary = (`Summary of ${old.length} older messages: ${src}`).slice(0, summaryBudget * 4);
  }

  return {
    messages: recent,
    summary,
    estimatedTokens: recentTokens + estimateTokens(summary),
    droppedMessages: dropped,
  };
}

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(file, fallback) {
  ensureDataDir();
  const p = path.join(DATA_DIR, file);
  if (!existsSync(p)) return fallback;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  ensureDataDir();
  writeFileSync(path.join(DATA_DIR, file), JSON.stringify(value, null, 2));
}

export function readKeys() {
  return readJson('keys.json', {});
}

export function setKey(provider, key) {
  const keys = readKeys();
  keys[provider] = key;
  writeJson('keys.json', keys);
}

export function getKey(provider) {
  return readKeys()[provider] ?? null;
}

export function redactedKeys() {
  return Object.entries(readKeys()).map(([provider, key]) => ({
    provider,
    redacted:
      typeof key === 'string' && key.length > 8
        ? `${key.slice(0, 4)}…${key.slice(-4)}`
        : '********',
  }));
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function readUsage() {
  const usage = readJson('usage.json', null);
  if (usage && usage.date === today()) return usage;
  return { date: today(), totalTokens: 0, perProvider: {} };
}

export function checkBudget(tokens, limit) {
  const usage = readUsage();
  const projected = usage.totalTokens + tokens;
  if (projected > limit) {
    return {
      ok: false,
      error: `Credit Guard: projected ${projected} tokens exceeds daily limit ${limit}. Used today: ${usage.totalTokens}.`,
    };
  }
  return { ok: true, usage };
}

export function recordUsage(provider, tokens) {
  const usage = readUsage();
  const next = {
    date: usage.date,
    totalTokens: usage.totalTokens + tokens,
    perProvider: { ...usage.perProvider, [provider]: (usage.perProvider[provider] ?? 0) + tokens },
  };
  writeJson('usage.json', next);
  return next;
}

export function readHistory() {
  return readJson('history.json', []);
}

export function appendHistory(entry) {
  const stamped = { ...entry, id: randomUUID(), at: new Date().toISOString() };
  const next = [stamped, ...readHistory()].slice(0, 50);
  writeJson('history.json', next);
  return next;
}

export const DEFAULT_CONFIG = {
  model: 'nvidia/nvidia/nemotron-3-super-120b-a12b',
  tiers: { standart: null, high: null, max: null },
  fallbackModels: [],
  creditLimitPerDay: 100000,
  keepWarm: true,
  keepWarmIntervalMs: 600000,
  providers: [
    { id: 'nvidia', baseUrl: 'https://integrate.api.nvidia.com/v1', enabled: true },
    { id: 'openai', baseUrl: 'https://api.openai.com/v1', enabled: true },
    { id: 'groq', baseUrl: 'https://api.groq.com/openai/v1', enabled: true },
    { id: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', enabled: false },
    { id: 'local', baseUrl: 'http://localhost:11434/v1', enabled: false },
  ],
  tournament: { size: 3, reasoningMaxTokens: 256, maxRefineLoops: 2 },
};

export function readConfig() {
  const cfg = readJson('config.json', null);
  const merged = !cfg
    ? { ...DEFAULT_CONFIG }
    : {
        ...DEFAULT_CONFIG,
        ...cfg,
        tiers: { ...DEFAULT_CONFIG.tiers, ...(cfg.tiers ?? {}) },
        providers: Array.isArray(cfg.providers) && cfg.providers.length > 0 ? cfg.providers : DEFAULT_CONFIG.providers,
        tournament: { ...DEFAULT_CONFIG.tournament, ...(cfg.tournament ?? {}) },
      };

  merged.model = normalizeModelId(merged.model);
  merged.fallbackModels = (merged.fallbackModels ?? []).map(normalizeModelId);
  for (const [key, value] of Object.entries(merged.tiers)) {
    merged.tiers[key] = value === null ? null : normalizeModelId(value);
  }

  if (!cfg) writeJson('config.json', merged);
  return merged;
}

export function validateConfig(candidate) {
  const errors = [];
  if (
    candidate.model !== undefined &&
    (typeof candidate.model !== 'string' || candidate.model.trim().length === 0)
  ) {
    errors.push('model must be a non-empty string');
  }
  if (candidate.tiers) {
    for (const [key, value] of Object.entries(candidate.tiers)) {
      if (value !== null && (typeof value !== 'string' || value.trim().length === 0)) {
        errors.push(`tiers.${key} must be null or a non-empty string`);
      }
    }
  }
  if (
    candidate.fallbackModels !== undefined &&
    (!Array.isArray(candidate.fallbackModels) ||
      candidate.fallbackModels.some((m) => typeof m !== 'string'))
  ) {
    errors.push('fallbackModels must be an array of strings');
  }
  if (
    candidate.creditLimitPerDay !== undefined &&
    (!Number.isFinite(candidate.creditLimitPerDay) || candidate.creditLimitPerDay <= 0)
  ) {
    errors.push('creditLimitPerDay must be a positive number');
  }
  if (candidate.keepWarm !== undefined && typeof candidate.keepWarm !== 'boolean') {
    errors.push('keepWarm must be a boolean');
  }
  if (
    candidate.keepWarmIntervalMs !== undefined &&
    (!Number.isFinite(candidate.keepWarmIntervalMs) || candidate.keepWarmIntervalMs < 60000)
  ) {
    errors.push('keepWarmIntervalMs must be a number >= 60000');
  }
  if (candidate.providers !== undefined) {
    if (!Array.isArray(candidate.providers)) {
      errors.push('providers must be an array');
    } else {
      for (const p of candidate.providers) {
        if (typeof p?.id !== 'string' || typeof p?.baseUrl !== 'string') {
          errors.push('each provider needs string id and baseUrl');
        }
      }
    }
  }
  return errors;
}

export function writeConfig(cfg) {
  writeJson('config.json', cfg);
}