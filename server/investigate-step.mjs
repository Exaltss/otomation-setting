/**
 * Investigasi kompatibilitas stepfun-ai/step-3.7-flash di NVIDIA NIM.
 * Tes semua endpoint utama: metadata, chat, text completion, embeddings.
 * Hapus file ini setelah investigasi selesai.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NVIDIA_BASE = 'https://integrate.api.nvidia.com/v1';
const MODEL = 'stepfun-ai/step-3.7-flash';

function loadEnv() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const envPath = path.join(here, '..', '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnv();

const NVIDIA_KEY = process.env.VITE_NVIDIA_API_KEY ?? process.env.NVIDIA_API_KEY ?? '';

async function probe(label, promise) {
  console.log(`\n=== ${label} ===`);
  try {
    const result = await promise;
    console.log('STATUS:', result.status);
    console.log('CONTENT-TYPE:', result.contentType);
    console.log('BODY:', JSON.stringify(result.body, null, 2).slice(0, 2000));
  } catch (e) {
    console.log('ERROR:', e.message);
  }
}

async function request(url, init) {
  const res = await fetch(url, init);
  let body;
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('json')) body = await res.json();
  else body = await res.text();
  return { status: res.status, contentType: ct, body };
}

async function main() {
  if (!NVIDIA_KEY) {
    console.log('NVIDIA key tidak ditemukan di .env');
    return;
  }

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${NVIDIA_KEY}`,
  };

  // 1) Metadata model — endpoint paling informatif
  await probe('GET /v1/models/stepfun-ai/step-3.7-flash', () =>
    request(`${NVIDIA_BASE}/models/${MODEL}`, { headers }),
  );

  // 2) Chat completions (OpenAI modern)
  await probe('POST /v1/chat/completions', () =>
    request(`${NVIDIA_BASE}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: 'Halo, siapa kamu?' }],
        max_tokens: 64,
      }),
    }),
  );

  // 3) Text completions (OpenAI legacy) — beberapa model hanya dukung ini
  await probe('POST /v1/completions (legacy)', () =>
    request(`${NVIDIA_BASE}/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: MODEL,
        prompt: 'Halo, siapa kamu?',
        max_tokens: 64,
      }),
    }),
  );

  // 4) Embeddings
  await probe('POST /v1/embeddings', () =>
    request(`${NVIDIA_BASE}/embeddings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: MODEL,
        input: 'Halo dunia',
      }),
    }),
  );

  // 5) Stream chat — cek apakah upstream benar-benar kirim SSE atau JSON
  console.log('\n=== POST /v1/chat/completions (stream=true) ===');
  try {
    const res = await fetch(`${NVIDIA_BASE}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: 'Halo' }],
        max_tokens: 32,
        stream: true,
      }),
    });
    console.log('STATUS:', res.status);
    console.log('CONTENT-TYPE:', res.headers.get('content-type'));
    const text = await res.text();
    console.log('RAW RESPONSE (500 chars):', text.slice(0, 500));
  } catch (e) {
    console.log('ERROR:', e.message);
  }
}

main();