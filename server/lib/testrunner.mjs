/**
 * Test-runner JS sandbox: syntax check + eksekusi runtime terbatas.
 * Safety scan menolak pola berbahaya (child_process, fs, network, eval).
 */
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const UNSAFE_PATTERN =
  /(require\s*\(\s*['"](?:child_process|fs|net|dgram|cluster)|from\s+['"](?:child_process|fs|net|dgram|cluster)|process\.exit|eval\s*\(|new\s+Function\s*\(|execSync|spawnSync|WebSocket|XMLHttpRequest|fetch\s*\(|http\.request|net\.connect)/i;

export function extractJsBlocks(text) {
  const fences = [...String(text).matchAll(/```(?:js|javascript|node)\n([\s\S]*?)```/gi)];
  return fences.map((f) => f[1]);
}

export function runJsTests(code, { timeoutMs = 5000 } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'otom-test-'));
  const file = path.join(dir, 'run.js');
  try {
    writeFileSync(file, code);

    const syntax = spawnSync('node', ['--check', file], { encoding: 'utf8', timeout: 5000 });
    if (syntax.status !== 0) {
      return { ran: false, syntaxOk: false, execOk: false, stderr: String(syntax.stderr).slice(0, 300) };
    }

    if (UNSAFE_PATTERN.test(code)) {
      return { ran: false, syntaxOk: true, execOk: null, reason: 'unsafe pattern — execution skipped' };
    }

    const exec = spawnSync('node', [file], {
      encoding: 'utf8',
      timeout: timeoutMs,
      env: { NODE_ENV: 'test', NO_COLOR: '1' },
    });
    const timedOut = exec.error?.code === 'ETIMEDOUT' || exec.signal === 'SIGTERM';

    return {
      ran: true,
      syntaxOk: true,
      execOk: exec.status === 0 && !timedOut,
      timedOut,
      stderr: String(exec.stderr ?? '').slice(0, 300),
    };
  } catch (e) {
    return { ran: false, syntaxOk: false, execOk: false, stderr: String(e?.message ?? e).slice(0, 300) };
  } finally {
    try {
      unlinkSync(file);
      rmdirSync(dir);
    } catch {
      // abaikan
    }
  }
}