/**
 * Persistence: saved workflows + execution history (50 run terakhir).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(file, fallback) {
  ensureDir();
  const p = path.join(DATA_DIR, file);
  if (!existsSync(p)) return fallback;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  ensureDir();
  writeFileSync(path.join(DATA_DIR, file), JSON.stringify(value, null, 2));
}

export function listWorkflows() {
  return readJson('workflows.json', []);
}

export function getWorkflow(id) {
  return listWorkflows().find((w) => w.id === id) ?? null;
}

export function saveWorkflow(candidate) {
  const all = listWorkflows();
  const now = new Date().toISOString();
  if (candidate.id && all.some((w) => w.id === candidate.id)) {
    const updated = { ...all.find((w) => w.id === candidate.id), ...candidate, updatedAt: now };
    writeJson('workflows.json', all.map((w) => (w.id === updated.id ? updated : w)));
    return updated;
  }
  const wf = {
    id: randomUUID(),
    name: candidate.name ?? 'Untitled Workflow',
    nodes: candidate.nodes ?? [],
    edges: candidate.edges ?? [],
    createdAt: now,
    updatedAt: now,
  };
  writeJson('workflows.json', [wf, ...all]);
  return wf;
}

export function deleteWorkflow(id) {
  writeJson('workflows.json', listWorkflows().filter((w) => w.id !== id));
}

export function listRuns() {
  return readJson('workflow-runs.json', []);
}

export function appendRun(run) {
  writeJson('workflow-runs.json', [run, ...listRuns()].slice(0, 50));
  return run;
}