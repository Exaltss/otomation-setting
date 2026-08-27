/**
 * Specialists Registry — Fase 23E.
 * Mapping task type → specialist agent (model + prompt + tool preference).
 *
 * Setiap specialist punya:
 *  - name: identifier
 *  - description: kapan dipakai
 *  - preferredTier: tier model yang direkomendasikan
 *  - sampling: temperature/thinking khusus
 *  - requiredPermission: izin yang harus dicek sebelum dipakai
 */

export const SPECIALISTS = {
  reasoning: {
    name: 'reasoning',
    description: 'Problem solving, planning, decision making',
    preferredTier: 'max',
    sampling: { temperature: 0.1, reasoningMaxTokens: 8192 },
    requiredPermission: null,
  },
  coding: {
    name: 'coding',
    description: 'Write code, debug, algorithm design',
    preferredTier: 'high',
    sampling: { temperature: 0.15, reasoningMaxTokens: 4096 },
    requiredPermission: 'exec',
  },
  file: {
    name: 'file',
    description: 'Read/write files, process CSV/JSON/Excel',
    preferredTier: 'standart',
    sampling: { temperature: 0.2, reasoningMaxTokens: 2048 },
    requiredPermission: null, // internal project
  },
  web: {
    name: 'web',
    description: 'Browse internet, fetch data, search',
    preferredTier: 'high',
    sampling: { temperature: 0.3, reasoningMaxTokens: 2048 },
    requiredPermission: null,
  },
  messaging: {
    name: 'messaging',
    description: 'Send WhatsApp, email, Telegram',
    preferredTier: 'standart',
    sampling: { temperature: 0.2, reasoningMaxTokens: 1024 },
    requiredPermission: 'network_send',
  },
  image: {
    name: 'image',
    description: 'Generate/edit images',
    preferredTier: 'standart',
    sampling: { temperature: 0.4, reasoningMaxTokens: 512 },
    requiredPermission: null,
  },
  compress: {
    name: 'compress',
    description: 'Auto-compact context when full',
    preferredTier: 'standart',
    sampling: { temperature: 0.1, reasoningMaxTokens: 2048 },
    requiredPermission: null,
  },
};

/**
 * Pilih specialist berdasarkan task description.
 * Bisa return multiple specialists untuk tugas kompleks.
 */
export function selectSpecialists(task) {
  const t = String(task).toLowerCase();
  const selected = [];

  if (/(kode|code|script|function|program|bug|error|debug)/i.test(t)) {
    selected.push(SPECIALISTS.coding);
  }
  if (/(whatsapp|wa|email|sms|telegram|kirim pesan|send message)/i.test(t)) {
    selected.push(SPECIALISTS.messaging);
  }
  if (/(gambar|image|foto|picture|visual)/i.test(t)) {
    selected.push(SPECIALISTS.image);
  }
  if (/(file|csv|json|excel|xlsx|spreadsheet|baca file|tulis file)/i.test(t)) {
    selected.push(SPECIALISTS.file);
  }
  if (/(web|browse|search|internet|fetch url|http)/i.test(t)) {
    selected.push(SPECIALISTS.web);
  }

  // Default: reasoning specialist
  if (selected.length === 0) {
    selected.push(SPECIALISTS.reasoning);
  }

  return selected;
}

/**
 * Cek permission yang dibutuhkan semua specialists.
 */
export function getRequiredPermissions(specialists) {
  const perms = new Set();
  for (const s of specialists) {
    if (s.requiredPermission) perms.add(s.requiredPermission);
  }
  return [...perms];
}
