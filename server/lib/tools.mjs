/**
 * Tool Registry — 5 tool inti untuk agent mode.
 * Model bisa memanggil tool saat menjawab (OpenAI function-calling pattern).
 * Math tool memakai parser shunting-yard (bukan eval/new Function).
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
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Tool: web_fetch — ambil konten URL.
 */
async function webFetch(params) {
  const { url } = params;
  if (typeof url !== 'string') {
    return { error: 'url must be a string' };
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      return { error: `HTTP ${res.status}: ${res.statusText}` };
    }
    const text = await res.text();
    return { content: text.slice(0, 4000), truncated: text.length > 4000 };
  } catch (e) {
    return { error: String(e?.message ?? e) };
  }
}

/**
 * Tool: http_request — POST/GET custom dengan headers & body.
 */
async function httpRequest(params) {
  const { url, method = 'GET', headers = {}, body = null } = params;
  if (typeof url !== 'string') {
    return { error: 'url must be a string' };
  }
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
    return {
      status: res.status,
      headers: Object.fromEntries(res.headers.entries()),
      body: text.slice(0, 4000),
      truncated: text.length > 4000,
    };
  } catch (e) {
    return { error: String(e?.message ?? e) };
  }
}

/**
 * Tool: file_rw — baca/tulis file lokal (hanya di server/data/tools/).
 */
async function fileRw(params) {
  const { action, filename, content } = params;
  if (typeof filename !== 'string') {
    return { error: 'filename must be a string' };
  }
  const safeDir = path.join(process.cwd(), 'server', 'data', 'tools');
  if (!existsSync(safeDir)) mkdirSync(safeDir, { recursive: true });
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = path.join(safeDir, safeName);

  if (action === 'read') {
    if (!existsSync(filePath)) {
      return { error: `file not found: ${safeName}` };
    }
    try {
      const data = readFileSync(filePath, 'utf8');
      return { content: data.slice(0, 4000), truncated: data.length > 4000 };
    } catch (e) {
      return { error: String(e?.message ?? e) };
    }
  }

  if (action === 'write') {
    if (typeof content !== 'string') {
      return { error: 'content must be a string for write action' };
    }
    try {
      writeFileSync(filePath, content, 'utf8');
      return { success: true, path: `server/data/tools/${safeName}` };
    } catch (e) {
      return { error: String(e?.message ?? e) };
    }
  }

  return { error: 'action must be "read" or "write"' };
}

/**
 * Tool: js_sandbox — eksekusi JavaScript aman.
 */
async function jsSandbox(params) {
  const { code } = params;
  if (typeof code !== 'string') {
    return { error: 'code must be a string' };
  }
  const UNSAFE_PATTERN =
    /(require\s*\(\s*['"](?:child_process|fs|net|dgram|cluster)|from\s+['"](?:child_process|fs|net|dgram|cluster)|process\.exit|eval\s*\(|new\s+Function\s*\(|execSync|spawnSync|WebSocket|XMLHttpRequest|fetch\s*\(|http\.request|net\.connect)/i;

  if (UNSAFE_PATTERN.test(code)) {
    return { error: 'unsafe pattern detected — execution blocked' };
  }

  const dir = mkdtempSync(path.join(tmpdir(), 'otom-sandbox-'));
  const file = path.join(dir, 'sandbox.js');
  try {
    writeFileSync(file, code);
    const syntax = spawnSync('node', ['--check', file], { encoding: 'utf8', timeout: 5000 });
    if (syntax.status !== 0) {
      return { error: `syntax error: ${String(syntax.stderr).slice(0, 200)}` };
    }
    const exec = spawnSync('node', [file], {
      encoding: 'utf8',
      timeout: 5000,
      env: { NODE_ENV: 'test', NO_COLOR: '1' },
    });
    if (exec.error?.code === 'ETIMEDOUT' || exec.signal === 'SIGTERM') {
      return { error: 'timeout (5s)' };
    }
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

// ---------- math parser (shunting-yard, tanpa eval) ----------
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
      // unary +/- di awal atau setelah operator -> perlakukan sebagai 0 ± x
      if (
        (tok.value === '-' || tok.value === '+') &&
        (prev === null || (prev.type === 'op' && prev.value !== ')'))
      ) {
        out.push({ type: 'num', value: 0 });
      }
      while (stack.length) {
        const top = stack[stack.length - 1];
        if (
          top.type === 'op' &&
          top.value !== '(' &&
          (PREC[top.value] > PREC[tok.value] ||
            (PREC[top.value] === PREC[tok.value] && !RIGHT_ASSOC[tok.value]))
        ) {
          out.push(stack.pop());
        } else {
          break;
        }
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

/**
 * Tool: math — kalkulator aman (parser, bukan eval).
 */
async function math(params) {
  const { expression } = params;
  if (typeof expression !== 'string') {
    return { error: 'expression must be a string' };
  }
  try {
    const result = evaluateMath(expression);
    return { result, expression };
  } catch (e) {
    return { error: `evaluation error: ${String(e?.message ?? e)}` };
  }
}

export const TOOLS = {
  web_fetch: {
    name: 'web_fetch',
    description: 'Fetch content from a URL. Returns text content (max 4000 chars).',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to fetch' },
      },
      required: ['url'],
    },
    execute: webFetch,
  },
  http_request: {
    name: 'http_request',
    description: 'Make HTTP request (GET/POST/PUT/DELETE) with custom headers and body.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Request URL' },
        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE'], description: 'HTTP method' },
        headers: { type: 'object', description: 'Request headers' },
        body: { type: 'object', description: 'Request body (will be JSON-stringified)' },
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
        action: { type: 'string', enum: ['read', 'write'], description: 'Action to perform' },
        filename: { type: 'string', description: 'Filename' },
        content: { type: 'string', description: 'Content to write (required for write)' },
      },
      required: ['action', 'filename'],
    },
    execute: fileRw,
  },
  js_sandbox: {
    name: 'js_sandbox',
    description: 'Execute JavaScript code in a sandbox (no fs/net/child_process, 5s timeout).',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'JavaScript code to execute' },
      },
      required: ['code'],
    },
    execute: jsSandbox,
  },
  math: {
    name: 'math',
    description: 'Evaluate mathematical expression (basic arithmetic, safe parser).',
    parameters: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: 'Mathematical expression' },
      },
      required: ['expression'],
    },
    execute: math,
  },
};

export function getToolDefinitions() {
  return Object.values(TOOLS).map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

export async function executeToolCall(name, params) {
  const tool = TOOLS[name];
  if (!tool) {
    return { error: `unknown tool: ${name}` };
  }
  try {
    return await tool.execute(params);
  } catch (e) {
    return { error: String(e?.message ?? e) };
  }
}