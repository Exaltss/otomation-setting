/**
 * Combo store — combo custom buatan user (nama + daftar model).
 * Persistensi: server/data/combos.json (sudah di-gitignore).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

function read() {
  const p = path.join(DATA_DIR, 'combos.json');
  if (!existsSync(p)) return [];
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return [];
  }
}

function write(list) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(path.join(DATA_DIR, 'combos.json'), JSON.stringify(list, null, 2));
}

export function listCombos() {
  return read();
}

export function getCombo(id) {
  return read().find((c) => c.id === id) ?? null;
}

export function createCombo(name, models) {
  const list = read();
  const combo = {
    id: randomUUID(),
    name: String(name),
    models: Array.isArray(models) ? models.filter((m) => typeof m === 'string') : [],
    createdAt: new Date().toISOString(),
  };
  list.push(combo);
  write(list);
  return combo;
}

export function deleteCombo(id) {
  write(read().filter((c) => c.id !== id));
}