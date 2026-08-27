/**
 * AUTO Mode Detection — Fase 23B.
 * Analisis pertanyaan user → pilih config (dials) terbaik.
 */

// --- Regex patterns (DRY) ---
const PATTERNS = {
  // Complexity indicators
  complexTask: /(buatkan|rancang|bangun|develop|implementasi|optimasi|refactor|desain|design|arsitektur|architecture|sistem|system|otomasi|automation|workflow|pipeline)/i,
  analysis: /(analisis|analysis|menganalisis|evaluasi|evaluate|investigasi|investigate)/i,
  multiStep: /\d+\.|[-•*]\s|lalu|kemudian|selanjutnya/gi,
  dataVolume: /\b\d{3,}\s*(transaksi|data|record|item|baris|file|produk|customer|pelanggan|user|entry|log)/i,
  technical: /(api|database|server|deploy|docker|kubernetes|microservice|backend|frontend)/i,
  
  // Risk indicators
  destructive: /\b(hapus|delete|rm\s|remove|destroy|format|wipe|clean|purge|drop)\b/i,
  networkSend: /(kirim|send|post|publish|deploy|release|broadcast|notif|notification)/i,
  sensitiveChannel: /(whatsapp|\bwa\b|email|sms|telegram|slack|discord)/i,
  systemOp: /\b(exec|jalankan|run\s|chmod|chown|sudo|root|install|uninstall)\b/i,
  externalPath: /(\/(var|etc|usr|home|tmp|bin|sbin|opt|root)\b|\bC:\\)/i,
  
  // Tool detection
  whatsapp: /(whatsapp|\bwa\b|whatsApp)/i,
  email: /\b(email|e-mail|smtp|mail|surat)\b/i,
  web: /(web|http|https|fetch|browse|internet|website|url)/i,
  image: /(gambar|image|foto|picture|bikin gambar|generate image|desain visual)/i,
  file: /\b(file|csv|json|txt|excel|xlsx|spreadsheet)\b/i,
  code: /\b(kode|code|script|function|program|algoritma|algorithm)\b/i,
  gdrive: /(gdrive|google drive|drive)/i,
  math: /(hitung|calculate|kalkulasi|\d+\s*[+\-*\/^]\s*\d+)/i,
};

// --- Scoring functions ---
function scoreComplexity(text) {
  const t = String(text);
  let score = 0;

  if (t.length > 500) score += 25;
  else if (t.length > 150) score += 18;
  else if (t.length > 60) score += 12;
  else if (t.length > 20) score += 5;

  if (PATTERNS.complexTask.test(t)) score += 30;
  if (PATTERNS.analysis.test(t)) score += 15;
  
  const steps = (t.match(PATTERNS.multiStep) || []).length;
  score += Math.min(15, steps * 5);
  
  if (PATTERNS.dataVolume.test(t)) score += 15;
  if (PATTERNS.technical.test(t)) score += 10;

  return Math.min(100, score);
}

function scoreRisk(text) {
  const t = String(text);
  let risk = 0;

  if (PATTERNS.destructive.test(t)) risk += 50;
  if (PATTERNS.networkSend.test(t)) risk += 30;
  if (PATTERNS.sensitiveChannel.test(t)) risk += 20;
  if (PATTERNS.systemOp.test(t)) risk += 30;
  if (PATTERNS.externalPath.test(t)) risk += 15;

  return Math.min(100, risk);
}

function detectNeededTools(text) {
  const t = String(text);
  const tools = [];
  const seen = new Set();

  const add = (tool, perm) => {
    if (seen.has(tool)) return;
    seen.add(tool);
    tools.push({ tool, perm });
  };

  if (PATTERNS.whatsapp.test(t)) add('whatsapp_send', 'network_send');
  if (PATTERNS.email.test(t)) add('email', 'network_send');
  if (PATTERNS.web.test(t)) add('web_fetch', null);
  if (PATTERNS.image.test(t)) add('image_gen', null);
  if (PATTERNS.file.test(t)) add('file_rw', null);
  if (PATTERNS.code.test(t)) add('js_sandbox', 'exec');
  if (PATTERNS.gdrive.test(t)) add('gdrive_upload', 'network_send');
  if (PATTERNS.math.test(t)) add('math', null);

  return tools;
}

/**
 * Deteksi pertanyaan user → return config untuk mode AUTO.
 * @param {string} text - Pertanyaan user
 * @returns {Object} detection result + config
 */
export function detectQuestion(text) {
  const complexity = scoreComplexity(text);
  const risk = scoreRisk(text);
  const tools = detectNeededTools(text);
  const neededPerms = [...new Set(tools.map(t => t.perm).filter(Boolean))];

  // Map complexity → dials
  let intelligence, thinking;
  if (complexity >= 70) { intelligence = 'max'; thinking = 'max'; }
  else if (complexity >= 50) { intelligence = 'high'; thinking = 'high'; }
  else if (complexity >= 25) { intelligence = 'medium'; thinking = 'medium'; }
  else { intelligence = 'low'; thinking = 'low'; }

  // Map risk + complexity → hallucination
  let hallucination;
  if (risk >= 50 || complexity >= 70) hallucination = 'max';
  else if (risk >= 30 || complexity >= 40) hallucination = 'medium';
  else hallucination = 'low';

  // Tanya user kalau high risk, butuh network permission, atau high complexity
  const shouldAsk = risk >= 50 ||
                    neededPerms.includes('network_send') ||
                    neededPerms.includes('exec') ||
                    complexity >= 70;

  return {
    complexity,
    risk,
    dials: { intelligence, thinking, hallucination },
    neededTools: tools,
    neededPermissions: neededPerms,
    shouldAsk,
  };
}
