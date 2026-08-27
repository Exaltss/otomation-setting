/**
 * Plan Storage — Fase 23D.
 * Menyimpan rencana workflow sebelum user approve.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
const PLANS_FILE = path.join(DATA_DIR, 'plans.json');

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function readPlans() {
  ensureDir();
  if (!existsSync(PLANS_FILE)) return [];
  try { return JSON.parse(readFileSync(PLANS_FILE, 'utf8')); }
  catch { return []; }
}

function writePlans(plans) {
  ensureDir();
  writeFileSync(PLANS_FILE, JSON.stringify(plans, null, 2));
}

/**
 * Buat plan baru.
 * @param {Object} plan - { userId, description, workflow, claims, questions, versions }
 * @returns {Object} plan dengan id + metadata
 */
export function createPlan(plan) {
  const plans = readPlans();
  const now = new Date().toISOString();
  const newPlan = {
    id: `plan_${randomUUID().slice(0, 8)}`,
    userId: plan.userId || 'default',
    description: plan.description || '',
    status: 'pending', // pending | approved | executed | expired
    createdAt: now,
    updatedAt: now,
    versions: plan.versions || [{
      version: 1,
      workflow: plan.workflow || null,
      claims: plan.claims || [],
      questions: plan.questions || [],
      createdAt: now,
    }],
    approvedVersion: null,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 jam
  };
  plans.unshift(newPlan);
  writePlans(plans);
  return newPlan;
}

/**
 * Ambil plan berdasarkan ID.
 */
export function getPlan(id) {
  return readPlans().find(p => p.id === id) || null;
}

/**
 * Update plan (untuk revisi).
 * @param {string} id - Plan ID
 * @param {Object} updates - { workflow, claims, questions }
 * @returns {Object} updated plan
 */
export function updatePlan(id, updates) {
  const plans = readPlans();
  const idx = plans.findIndex(p => p.id === id);
  if (idx === -1) return null;

  const now = new Date().toISOString();
  const plan = plans[idx];
  const newVersion = {
    version: plan.versions.length + 1,
    workflow: updates.workflow ?? plan.versions.at(-1).workflow,
    claims: updates.claims ?? plan.versions.at(-1).claims,
    questions: updates.questions ?? plan.versions.at(-1).questions,
    createdAt: now,
  };

  plan.versions.push(newVersion);
  plan.updatedAt = now;
  plans[idx] = plan;
  writePlans(plans);
  return plan;
}

/**
 * Approve plan (user setuju pada versi tertentu).
 */
export function approvePlan(id, version = null) {
  const plans = readPlans();
  const idx = plans.findIndex(p => p.id === id);
  if (idx === -1) return null;

  const plan = plans[idx];
  plan.status = 'approved';
  plan.approvedVersion = version ?? plan.versions.length;
  plan.updatedAt = new Date().toISOString();
  plans[idx] = plan;
  writePlans(plans);
  return plan;
}

/**
 * List semua plan (untuk UI).
 */
export function listPlans(userId = null) {
  const all = readPlans();
  return userId ? all.filter(p => p.userId === userId) : all;
}

/**
 * Hapus plan expired (cleanup).
 */
export function cleanupExpired() {
  const plans = readPlans();
  const now = Date.now();
  const filtered = plans.filter(p => new Date(p.expiresAt).getTime() > now);
  if (filtered.length !== plans.length) {
    writePlans(filtered);
  }
  return { removed: plans.length - filtered.length, remaining: filtered.length };
}

export function deletePlan(id) {
  const plans = readPlans();
  const filtered = plans.filter(p => p.id !== id);
  writePlans(filtered);
  return { ok: true };
}
