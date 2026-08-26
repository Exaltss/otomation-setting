/**
 * Semantic cache — exact hash + fuzzy Jaccard similarity.
 * Mencegah turnamen ulang untuk pertanyaan sama/mirip.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const FILE = 'cache.json';
const MAX_ENTRIES = 100;
const TTL_MS = 24 * 60 * 60 * 1000; // 24 jam

function read() {
  const p = path.join(DATA_DIR, FILE);
  if (!existsSync(p)) return [];
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return [];
  }
}

function write(list) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(path.join(DATA_DIR, FILE), JSON.stringify(list, null, 2));
}

function normalize(text) {
  return String(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function tokenize(text) {
  return normalize(text).split(' ').filter((w) => w.length > 1);
}

function hash(text) {
  return createHash('sha256').update(normalize(text)).digest('hex');
}

function jaccard(a, b) {
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter += 1;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function cacheGet(prompt, { minSimilarity = 0.85 } = {}) {
  const now = Date.now();
  const entries = read().filter((e) => now - e.at < TTL_MS);
  const key = hash(prompt);

  let hit = entries.find((e) => e.key === key);
  let fuzzy = false;

  if (!hit) {
    const pt = tokenize(prompt);
    let best = null;
    let bestSim = 0;
    for (const e of entries) {
      const sim = jaccard(pt, tokenize(e.prompt));
      if (sim > bestSim) {
        bestSim = sim;
        best = e;
      }
    }
    if (best && bestSim >= minSimilarity) {
      hit = best;
      fuzzy = true;
    }
  }

  if (!hit) return null;
  return { value: hit.value, ageMs: now - hit.at, fuzzy };
}

export function cachePut(prompt, value) {
  const list = read();
  list.push({ key: hash(prompt), prompt, value, at: Date.now() });
  while (list.length > MAX_ENTRIES) list.shift();
  write(list);
}

export function cacheStats() {
  return { entries: read().length };
}

export function cacheClear() {
  write([]);
}