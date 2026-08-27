/**
 * Permission System — Fase 23A.
 * Semua operasi berisiko WAJIB tanya user (kecuali sudah ada izin).
 * 3 opsi jawaban:
 *   1. "Ya untuk projek ini saja" → session (memory, hilang saat sesi berakhir)
 *   2. "Selalu ya untuk <jenis>"  → persistent (permissions.json)
 *   3. "Tidak"                    → tolak, jangan tanya lagi di sesi ini
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
const PERM_FILE = path.join(DATA_DIR, 'permissions.json');
const AUDIT_FILE = path.join(DATA_DIR, 'audit.json');

export const PERMISSION_TYPES = [
  'read_outside',   // baca file di luar folder project
  'write_outside',  // tulis file di luar folder project
  'delete_any',     // hapus file apa pun (termasuk sistem)
  'exec',           // jalankan command shell
  'network_send',   // kirim data keluar (WA, email, API)
  'browser',        // buka/akses browser
];

// Session-scoped (memory, hilang saat proses restart / sesi berakhir)
const sessionGranted = new Set();
const sessionDenied = new Set();

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}
function readJson(file, fb) {
  ensureDir();
  if (!existsSync(file)) return fb;
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fb; }
}
function writeJson(file, val) {
  ensureDir();
  writeFileSync(file, JSON.stringify(val, null, 2));
}
function readPersistent() { return readJson(PERM_FILE, {}); }

export function logAudit(entry) {
  const log = readJson(AUDIT_FILE, []);
  log.push({ ...entry, at: new Date().toISOString() });
  writeJson(AUDIT_FILE, log.slice(-200)); // cap 200
}

export function getAuditLog() { return readJson(AUDIT_FILE, []); }

/**
 * Cek status izin untuk satu jenis operasi.
 * Return: 'persistent' | 'session' | 'denied' | null (null = perlu tanya user)
 */
export function checkPermission(type) {
  const p = readPersistent();
  if (p[type] === 'persistent') return 'persistent';
  if (sessionGranted.has(type)) return 'session';
  if (sessionDenied.has(type)) return 'denied';
  return null;
}

export function grantPermission(type, scope) {
  if (!PERMISSION_TYPES.includes(type)) return { error: `unknown type: ${type}` };
  sessionDenied.delete(type);
  if (scope === 'persistent') {
    const p = readPersistent();
    p[type] = 'persistent';
    writeJson(PERM_FILE, p);
  } else {
    sessionGranted.add(type);
  }
  logAudit({ type, action: 'grant', scope });
  return { ok: true, type, scope };
}

export function denyPermission(type) {
  sessionDenied.add(type);
  sessionGranted.delete(type);
  logAudit({ type, action: 'deny', scope: 'session' });
  return { ok: true, type };
}

export function revokePermission(type) {
  const p = readPersistent();
  delete p[type];
  writeJson(PERM_FILE, p);
  sessionGranted.delete(type);
  logAudit({ type, action: 'revoke', scope: 'persistent' });
  return { ok: true, type };
}

export function listPermissions() {
  return {
    types: PERMISSION_TYPES,
    persistent: readPersistent(),
    session: [...sessionGranted],
    denied: [...sessionDenied],
  };
}
