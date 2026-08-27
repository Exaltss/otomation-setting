/**
 * Tool Registry — 8 tool untuk agent mode & workflow.
 * math / web_fetch / file_rw / js_sandbox / http_request
 * + image_gen / whatsapp_send / gdrive_upload
 */
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  unlinkSync,
  rmdirSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createSign } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getKey } from './engine.mjs';

const TOOLS_DIR = () => {
  const dir = path.join(process.cwd(), 'server', 'data', 'tools');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
};

const safeName = (n) => String(n).replace(/[^a-zA-Z0-9._-]/g, '_');

async function webFetch(params) {
  const { url } = params;
  if (typeof url !== 'string') return { error: 'url must be a string' };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return { error: `HTTP ${res.status}: ${res.statusText}` };
    const text = await res.text();
    return { content: text.slice(0, 4000), truncated: text.length > 4000 };
  } catch (e) {
    return { error: String(e?.message ?? e) };
  }
}

async function httpRequest(params) {
  const { url, method = 'GET', headers = {}, body = null } = params;
  if (typeof url !== 'string') return { error: 'url must be a string' };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    clearTimeout(timer);
    const text = await res.text();
    return { status: res.status, body: text.slice(0, 4000), truncated: text.length > 4000 };
  } catch (e) {
    return { error: String(e?.message ?? e) };
  }
}

async function fileRw(params) {
  const { action, filename, content } = params;
  if (typeof filename !== 'string') return { error: 'filename must be a string' };
  const filePath = path.join(TOOLS_DIR(), safeName(filename));

  if (action === 'read') {
    if (!existsSync(filePath)) return { error: `file not found: ${filename}` };
    try {
      const data = readFileSync(filePath, 'utf8');
      return { content: data.slice(0, 4000), truncated: data.length > 4000 };
    } catch (e) {
      return { error: String(e?.message ?? e) };
    }
  }
  if (action === 'write') {
    if (typeof content !== 'string') return { error: 'content must be a string for write action' };
    try {
      writeFileSync(filePath, content, 'utf8');
      return { success: true, path: `server/data/tools/${safeName(filename)}` };
    } catch (e) {
      return { error: String(e?.message ?? e) };
    }
  }
  return { error: 'action must be "read" or "write"' };
}

async function jsSandbox(params) {
  const { code } = params;
  if (typeof code !== 'string') return { error: 'code must be a string' };
  const UNSAFE_PATTERN =
    /(require\s*\(\s*['"](?:child_process|fs|net|dgram|cluster)|from\s+['"](?:child_process|fs|net|dgram|cluster)|process\.exit|eval\s*\(|new\s+Function\s*\(|execSync|spawnSync|WebSocket|XMLHttpRequest|fetch\s*\(|http\.request|net\.connect)/i;
  if (UNSAFE_PATTERN.test(code)) return { error: 'unsafe pattern detected — execution blocked' };

  const dir = mkdtempSync(path.join(tmpdir(), 'otom-sandbox-'));
  const file = path.join(dir, 'sandbox.js');
  try {
    writeFileSync(file, code);
    const syntax = spawnSync('node', ['--check', file], { encoding: 'utf8', timeout: 5000 });
    if (syntax.status !== 0) return { error: `syntax error: ${String(syntax.stderr).slice(0, 200)}` };
    const exec = spawnSync('node', [file], { encoding: 'utf8', timeout: 5000, env: { NODE_ENV: 'test', NO_COLOR: '1' } });
    if (exec.error?.code === 'ETIMEDOUT' || exec.signal === 'SIGTERM') return { error: 'timeout (5s)' };
    return {
      stdout: String(exec.stdout ?? '').slice(0, 2000),
      stderr: String(exec.stderr ?? '').slice(0, 500),
      exitCode: exec.status,
    };
  } catch (e) {
    return { error: String(e?.message ?? e) };
  } finally {
    try {
      unlinkSync(file);
      rmdirSync(dir);
    } catch {
      // abaikan
    }
  }
}

function tokenizeMath(expr) {
  const tokens = [];
  const s = String(expr).replace(/\s+/g, '');
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/[0-9.]/.test(ch)) {
      let num = '';
      while (i < s.length && /[0-9.]/.test(s[i])) {
        num += s[i];
        i += 1;
      }
      const val = Number(num);
      if (!Number.isFinite(val)) throw new Error(`invalid number: ${num}`);
      tokens.push({ type: 'num', value: val });
      continue;
    }
    if ('+-*/()%^'.includes(ch)) {
      tokens.push({ type: 'op', value: ch });
      i += 1;
      continue;
    }
    throw new Error(`unexpected character: ${ch}`);
  }
  return tokens;
}

const PREC = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2, '^': 3 };
const RIGHT_ASSOC = { '^': true };

function toRPN(tokens) {
  const out = [];
  const stack = [];
  let prev = null;
  for (const tok of tokens) {
    if (tok.type === 'num') {
      out.push(tok);
    } else if (tok.value === '(') {
      stack.push(tok);
    } else if (tok.value === ')') {
      while (stack.length && stack[stack.length - 1].value !== '(') out.push(stack.pop());
      if (!stack.length) throw new Error('mismatched parentheses');
      stack.pop();
    } else {
      if ((tok.value === '-' || tok.value === '+') && (prev === null || (prev.type === 'op' && prev.value !== ')'))) {
        out.push({ type: 'num', value: 0 });
      }
      while (stack.length) {
        const top = stack[stack.length - 1];
        if (top.type === 'op' && top.value !== '(' &&
          (PREC[top.value] > PREC[tok.value] || (PREC[top.value] === PREC[tok.value] && !RIGHT_ASSOC[tok.value]))) {
          out.push(stack.pop());
        } else break;
      }
      stack.push(tok);
    }
    prev = tok;
  }
  while (stack.length) {
    const top = stack.pop();
    if (top.value === '(') throw new Error('mismatched parentheses');
    out.push(top);
  }
  return out;
}

function evalRPN(rpn) {
  const st = [];
  for (const tok of rpn) {
    if (tok.type === 'num') {
      st.push(tok.value);
    } else {
      const b = st.pop();
      const a = st.pop();
      if (a === undefined || b === undefined) throw new Error('invalid expression');
      switch (tok.value) {
        case '+': st.push(a + b); break;
        case '-': st.push(a - b); break;
        case '*': st.push(a * b); break;
        case '/': st.push(a / b); break;
        case '%': st.push(a % b); break;
        case '^': st.push(a ** b); break;
        default: throw new Error(`unknown operator: ${tok.value}`);
      }
    }
  }
  if (st.length !== 1) throw new Error('invalid expression');
  return st[0];
}

export function evaluateMath(expression) {
  return evalRPN(toRPN(tokenizeMath(expression)));
}

async function math(params) {
  const { expression } = params;
  if (typeof expression !== 'string') return { error: 'expression must be a string' };
  try {
    return { result: evaluateMath(expression), expression };
  } catch (e) {
    return { error: `evaluation error: ${String(e?.message ?? e)}` };
  }
}

async function imageGen(params) {
  const { prompt, width = 1024, height = 1024 } = params;
  if (typeof prompt !== 'string' || !prompt.trim()) return { error: 'prompt required' };
  const seed = Math.floor(Math.random() * 1000000);
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt.trim())}?width=${width}&height=${height}&seed=${seed}&model=flux&nologo=true`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return { error: `image gen HTTP ${res.status}` };
    const buf = Buffer.from(await res.arrayBuffer());
    const filename = `img_${Date.now()}_${seed}.jpg`;
    writeFileSync(path.join(TOOLS_DIR(), filename), buf);
    return { url, file: filename, size: buf.length, prompt: prompt.trim() };
  } catch (e) {
    return { error: String(e?.message ?? e) };
  } finally {
    clearTimeout(timer);
  }
}

async function whatsappSend(params) {
  const { to, message, file } = params;
  if (typeof to !== 'string' || typeof message !== 'string') return { error: 'to and message required' };

  const fonnteKey = getKey('fonnte');
  if (fonnteKey) {
    try {
      const fd = new FormData();
      fd.append('token', fonnteKey);
      fd.append('target', to);
      fd.append('message', message);
      if (typeof file === 'string') {
        const p = path.join(TOOLS_DIR(), safeName(file));
        if (existsSync(p)) {
          const buf = readFileSync(p);
          fd.append('image', new Blob([buf], { type: 'image/jpeg' }), safeName(file));
        }
      }
      const res = await fetch('https://fonnte.com/send', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      return data.status ? { sent: true, provider: 'fonnte', id: data.id } : { error: data.reason ?? 'fonnte failed' };
    } catch (e) {
      return { error: String(e?.message ?? e) };
    }
  }

  const cmbKey = getKey('callmebot');
  if (cmbKey) {
    try {
      const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(to)}&text=${encodeURIComponent(message)}&apikey=${encodeURIComponent(cmbKey)}`;
      const res = await fetch(url);
      const text = await res.text();
      return { sent: res.ok, provider: 'callmebot', detail: text.slice(0, 200) };
    } catch (e) {
      return { error: String(e?.message ?? e) };
    }
  }

  return { error: 'whatsapp provider belum dikonfigurasi. Set key "fonnte" atau "callmebot" via POST /admin/api/keys' };
}

async function saToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/drive.file',
    aud: sa.token_uri,
    exp: now + 3600,
    iat: now,
  };
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${enc(header)}.${enc(claims)}`;
  const sign = createSign('RSA-SHA256');
  sign.update(unsigned);
  const sig = sign.sign(sa.private_key, 'base64url');
  const jwt = `${unsigned}.${sig}`;
  const res = await fetch(sa.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.access_token) throw new Error('service account token gagal');
  return data.access_token;
}

async function gdriveUpload(params) {
  const { file, url, name } = params;
  let buf = null;
  let fileName = typeof name === 'string' ? safeName(name) : null;

  if (typeof file === 'string') {
    const p = path.join(TOOLS_DIR(), safeName(file));
    if (existsSync(p)) {
      buf = readFileSync(p);
      fileName = fileName ?? safeName(file);
    }
  } else if (typeof url === 'string') {
    try {
      const res = await fetch(url);
      if (!res.ok) return { error: `download gagal HTTP ${res.status}` };
      buf = Buffer.from(await res.arrayBuffer());
    } catch (e) {
      return { error: String(e?.message ?? e) };
    }
  }
  if (!buf) return { error: 'file tidak ditemukan / url wajib diisi' };
  fileName = fileName ?? `upload_${Date.now()}.jpg`;

  const webhook = getKey('gdrive_webhook');
  if (webhook) {
    try {
      const res = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: fileName, mime: 'image/jpeg', base64: buf.toString('base64') }),
      });
      const data = await res.json().catch(() => ({}));
      return res.ok ? { uploaded: true, provider: 'webhook', ...data } : { error: `webhook HTTP ${res.status}` };
    } catch (e) {
      return { error: String(e?.message ?? e) };
    }
  }

  const saRaw = getKey('gdrive_sa');
  if (saRaw) {
    try {
      const sa = JSON.parse(saRaw);
      const token = await saToken(sa);
      const boundary = `otom${Date.now()}`;
      const meta = JSON.stringify({ name: fileName, mimeType: 'image/jpeg' });
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Type: application/json\r\n\r\n${meta}\r\n`),
        Buffer.from(`--${boundary}\r\nContent-Type: image/jpeg\r\n\r\n`),
        buf,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
        body,
      });
      const data = await res.json().catch(() => ({}));
      return res.ok
        ? { uploaded: true, provider: 'gdrive', fileId: data.id, link: data.webViewLink }
        : { error: data?.error?.message ?? `gdrive HTTP ${res.status}` };
    } catch (e) {
      return { error: String(e?.message ?? e) };
    }
  }

  return { error: 'gdrive belum dikonfigurasi. Set key "gdrive_sa" atau "gdrive_webhook" via POST /admin/api/keys' };
}

export const TOOLS = {
  web_fetch: {
    name: 'web_fetch',
    description: 'Fetch content from a URL.',
    parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    execute: webFetch,
  },
  http_request: {
    name: 'http_request',
    description: 'Make HTTP request (GET/POST/PUT/DELETE).',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        method: { type: 'string' },
        headers: { type: 'object' },
        body: { type: 'object' },
      },
      required: ['url'],
    },
    execute: httpRequest,
  },
  file_rw: {
    name: 'file_rw',
    description: 'Read or write files in server/data/tools/ directory.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        filename: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['action', 'filename'],
    },
    execute: fileRw,
  },
  js_sandbox: {
    name: 'js_sandbox',
    description: 'Execute JavaScript code in a sandbox.',
    parameters: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] },
    execute: jsSandbox,
  },
  math: {
    name: 'math',
    description: 'Evaluate mathematical expression.',
    parameters: { type: 'object', properties: { expression: { type: 'string' } }, required: ['expression'] },
    execute: math,
  },
  image_gen: {
    name: 'image_gen',
    description: 'Generate an image from a text prompt (free, no API key).',
    parameters: {
      type: 'object',
      properties: { prompt: { type: 'string' }, width: { type: 'number' }, height: { type: 'number' } },
      required: ['prompt'],
    },
    execute: imageGen,
  },
  whatsapp_send: {
    name: 'whatsapp_send',
    description: 'Send WhatsApp message. Requires key "fonnte" or "callmebot".',
    parameters: {
      type: 'object',
      properties: { to: { type: 'string' }, message: { type: 'string' }, file: { type: 'string' } },
      required: ['to', 'message'],
    },
    execute: whatsappSend,
  },
  gdrive_upload: {
    name: 'gdrive_upload',
    description: 'Upload file to Google Drive. Requires key "gdrive_sa" or "gdrive_webhook".',
    parameters: {
      type: 'object',
      properties: { file: { type: 'string' }, url: { type: 'string' }, name: { type: 'string' } },
      required: [],
    },
    execute: gdriveUpload,
  },
};

export function getToolDefinitions() {
  return Object.values(TOOLS).map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }));
}

export async function executeToolCall(name, params) {
  const tool = TOOLS[name];
  if (!tool) return { error: `unknown tool: ${name}` };
  try {
    return await tool.execute(params);
  } catch (e) {
    return { error: String(e?.message ?? e) };
  }
}