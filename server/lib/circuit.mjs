/**
 * Circuit breaker per slug model (pola OmniRoute).
 * Provider/model yang gagal di-skip sementara (cooldown 60 dtk),
 * lalu dicoba lagi otomatis.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const FILE = 'circuit.json';
const COOLDOWN_MS = 60000;

function read() {
  const p = path.join(DATA_DIR, FILE);
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return {};
  }
}

function write(state) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(path.join(DATA_DIR, FILE), JSON.stringify(state, null, 2));
}

export function tripBreaker(slug) {
  const state = read();
  state[slug] = { openedAt: Date.now() };
  write(state);
}

export function clearBreaker(slug) {
  const state = read();
  if (state[slug]) {
    delete state[slug];
    write(state);
  }
}

export function isBroken(slug, cooldownMs = COOLDOWN_MS) {
  const entry = read()[slug];
  if (!entry) return false;
  return Date.now() - entry.openedAt < cooldownMs;
}

export function circuitStatus(cooldownMs = COOLDOWN_MS) {
  const state = read();
  const now = Date.now();
  return Object.entries(state).map(([slug, entry]) => ({
    slug,
    open: now - entry.openedAt < cooldownMs,
    remainingMs: Math.max(0, cooldownMs - (now - entry.openedAt)),
  }));
}