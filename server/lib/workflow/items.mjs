/**
 * n8n-style item data model + expression templates.
 *
 * Placeholder system:
 *   {context}      → raw string (untuk AI prompt)
 *   {context_json} → JSON string literal (escape aman)
 *   {context_obj}  → EMBED OBJECT LITERAL langsung (untuk code nodes)
 *   {{ $json.f }}  → ambil field dari item pertama
 */

export function toItems(value) {
  if (Array.isArray(value)) {
    return value.map((v) => ({ json: v !== null && typeof v === 'object' ? v : { data: v } }));
  }
  if (value !== null && typeof value === 'object') return [{ json: value }];
  return [{ json: { data: value } }];
}

export function itemsToContext(items) {
  if (!items || items.length === 0) return '';
  if (items.length === 1) {
    const j = items[0].json;
    if (j !== null && typeof j === 'object' && Object.keys(j).length === 1 && 'data' in j) {
      return String(j.data);
    }
    return JSON.stringify(j);
  }
  return JSON.stringify(items.map((i) => i.json));
}

function jsonSafeString(value) {
  if (value === null || value === undefined) return '""';
  return JSON.stringify(value);
}

/**
 * [FIX BUG #1] Embed object literal: jika context valid JSON, return
 * minified JSON text (aman di-embed langsung: const x = {context_obj};).
 * Jika bukan JSON, fallback ke string literal.
 */
function objLiteral(rawCtx) {
  const trimmed = String(rawCtx).trim();
  const looksJson =
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'));
  if (looksJson) {
    try {
      return JSON.stringify(JSON.parse(trimmed));
    } catch {
      // bukan JSON valid — fallback
    }
  }
  return JSON.stringify(rawCtx);
}

const getPath = (obj, p) =>
  String(p).split('.').reduce((acc, k) => (acc == null ? undefined : acc[k]), obj);

export function resolveTemplate(template, items) {
  const first = items[0]?.json ?? {};
  const rawCtx = itemsToContext(items);

  return String(template)
    .replace(/\{\{\s*\$json\.([\w.$]+)\s*\}\}/g, (_, p) => {
      const v = getPath(first, p);
      if (v === undefined || v === null) return '';
      return typeof v === 'object' ? JSON.stringify(v) : String(v);
    })
    .replace(/\{context_obj\}/g, objLiteral(rawCtx))
    .replace(/\{context_json\}/g, jsonSafeString(rawCtx))
    .replace(/\{context\}/g, rawCtx);
}

export function resolveParams(params, items) {
  if (typeof params === 'string') return resolveTemplate(params, items);
  if (Array.isArray(params)) return params.map((p) => resolveParams(p, items));
  if (params !== null && typeof params === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(params)) out[k] = resolveParams(v, items);
    return out;
  }
  return params;
}