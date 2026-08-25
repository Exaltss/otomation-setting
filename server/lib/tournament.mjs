/**
 * Otomation Tournament Pipeline — FUSION pattern (pola 9router).
 *
 * 1) FAN-OUT        : reasoning paralel ke kandidat dari pool gabungan
 * 2) QUORUM-GRACE   : tunggu 75% selesai / max 30 dtk; straggler di-drop
 * 3) ANONYMIZE      : judge hanya melihat [Source A], [Source B], ... (anti brand-bias)
 * 4) JUDGE SYNTHESIS: judge MENGGABUNGKAN panel menjadi satu jawaban final
 * 5) DEGRADATION    : 1 survivor -> direct answer; 0 survivor -> failed
 * 6) VALIDATOR LOOP : syntax-check nyata + judge verdict + refinement
 */
import { writeFileSync, mkdtempSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { estimateTokens } from './engine.mjs';

export const TOURNAMENT_DEFAULTS = {
  enabled: true,
  size: 3,
  reasoningMaxTokens: 256,
  maxRefineLoops: 2,
  judge: null,
  quorumMs: 30000,
};

const CODING_SIGNALS = ['kode', 'code', 'coding', 'fungsi', 'function', 'bug', 'script', 'regex', 'sql', 'python', 'javascript', 'typescript', 'refactor', 'compile'];
const REASONING_SIGNALS = ['analisis', 'analysis', 'mengapa', 'why', 'bandingkan', 'compare', 'strategi', 'strategy', 'bukti', 'prove', 'evaluasi'];
const WRITING_SIGNALS = ['tulis', 'write', 'artikel', 'essay', 'email', 'ringkas', 'summarize', 'terjemah', 'translate', 'caption', 'blog'];

export function classifyTask(text) {
  const t = String(text).toLowerCase();
  if (CODING_SIGNALS.some((s) => t.includes(s))) return 'coding';
  if (REASONING_SIGNALS.some((s) => t.includes(s))) return 'reasoning';
  if (WRITING_SIGNALS.some((s) => t.includes(s))) return 'writing';
  return 'general';
}

const TASK_MODEL_SIGNALS = {
  coding: ['coder', 'code', 'codestral', 'devstral', 'nemotron', 'starcoder'],
  reasoning: ['flash', 'step', 'nemotron', 'reasoning'],
  writing: ['flash', '8b', 'mini', 'small'],
  general: ['flash', '8b', 'mini', 'small'],
};

export function selectCandidates(taskType, entries, size, preferredSlugs) {
  const slugs = entries.map((e) => `${e.provider}/${e.id}`);
  const picked = [];

  for (const pref of preferredSlugs ?? []) {
    if (slugs.includes(pref) && !picked.includes(pref)) picked.push(pref);
  }
  for (const s of TASK_MODEL_SIGNALS[taskType] ?? []) {
    for (const e of entries) {
      const slug = `${e.provider}/${e.id}`;
      if (!picked.includes(slug) && e.id.toLowerCase().includes(s)) picked.push(slug);
    }
  }
  for (const slug of slugs) {
    if (!picked.includes(slug)) picked.push(slug);
  }

  return picked.slice(0, Math.max(1, size));
}

function parseScore(text) {
  const m = String(text).match(/SCORE:\s*(\d+)/i);
  if (m) return Math.min(10, parseInt(m[1], 10));
  return 5;
}

function parseVerdict(text) {
  const m = String(text).match(/VERDICT:\s*(YES|NO)/i);
  return m ? m[1].toUpperCase() === 'YES' : true;
}

function extractIssues(text) {
  const m = String(text).match(/ISSUES:\s*([^\n]+)/i);
  return m ? m[1].trim() : '';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function syntaxCheckCode(output) {
  const fences = [...String(output).matchAll(/```(?:js|javascript|typescript|ts|node)\n([\s\S]*?)```/gi)];
  const problems = [];
  fences.forEach((f, i) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'otom-'));
    const file = path.join(dir, `check-${i}.js`);
    try {
      writeFileSync(file, f[1]);
      const result = spawnSync('node', ['--check', file], { encoding: 'utf8' });
      if (result.status !== 0) {
        problems.push(`block ${i + 1}: ${String(result.stderr).slice(0, 200)}`);
      }
    } catch (e) {
      problems.push(`block ${i + 1}: ${String(e.message).slice(0, 200)}`);
    } finally {
      try {
        unlinkSync(file);
      } catch {
        // abaikan
      }
    }
  });
  return problems;
}

function execMessages(text) {
  return [
    {
      role: 'system',
      content:
        'You are the execution core. Produce ONLY the final complete answer/code. No reasoning, no thinking aloud. For coding tasks include a fenced code block.',
    },
    { role: 'user', content: text },
  ];
}

export async function runTournament({ prompt, entries, preferredSlugs, judgeSlug, cfg, callModel, isBrokenSlug }) {
  const t = { ...TOURNAMENT_DEFAULTS, ...(cfg.tournament ?? {}) };
  const trace = {
    taskType: classifyTask(prompt),
    candidates: [],
    scores: [],
    winner: null,
    refineLoops: 0,
    validation: [],
    reasoningText: '',
    stragglers: [],
    synthesis: false,
    mapping: [],
  };

  // 1) Kandidat dari pool gabungan, skip yang circuit-breaker-nya terbuka
  const allCandidates = selectCandidates(trace.taskType, entries, t.size, preferredSlugs);
  const candidates = allCandidates.filter((slug) => !(isBrokenSlug && isBrokenSlug(slug)));
  trace.candidates = candidates;
  if (candidates.length === 0) {
    return { failed: true, trace, error: 'no healthy candidates (circuit open)' };
  }

  // 2) FAN-OUT reasoning + QUORUM-GRACE
  const reasoningPrompt = [
    { role: 'system', content: 'Think step by step. Output concise reasoning only.' },
    { role: 'user', content: prompt },
  ];

  const collected = [];
  const jobs = candidates.map(async (slug) => {
    let r;
    try {
      const out = await callModel(slug, reasoningPrompt, { maxTokens: t.reasoningMaxTokens });
      r = { slug, ok: true, reasoning: out.reasoning || out.content || '' };
    } catch (e) {
      r = { slug, ok: false, error: String(e?.message ?? e) };
    }
    collected.push(r);
    return r;
  });

  const quorum = Math.max(1, Math.ceil(candidates.length * 0.75));
  await Promise.race([
    Promise.allSettled(jobs),
    (async () => {
      while (collected.length < quorum) await sleep(250);
    })(),
    sleep(t.quorumMs),
  ]);

  const alive = collected.filter((r) => r.ok && r.reasoning.trim().length > 0);
  trace.stragglers = candidates.filter((s) => !collected.some((c) => c.slug === s));
  trace.reasoningText = alive.map((r) => `== ${r.slug} ==\n${r.reasoning}`).join('\n\n');

  if (alive.length === 0) {
    return { failed: true, trace, error: 'no survivor in reasoning stage' };
  }

  // 3) DEGRADATION / SYNTHESIS
  let output = '';
  let winner = alive[0].slug;

  if (alive.length === 1) {
    // single survivor -> direct answer
    winner = alive[0].slug;
    trace.scores.push({ model: winner, label: 'Source A', score: 10, note: 'single survivor' });
    try {
      const out = await callModel(winner, execMessages(prompt), { maxTokens: 1024 });
      output = out.content || out.reasoning || '';
    } catch (e) {
      return { failed: true, trace, error: String(e?.message ?? e) };
    }
  } else {
    // ANONYMIZE panel
    const labels = alive.map((r, i) => `Source ${String.fromCharCode(65 + i)}`);
    trace.mapping = alive.map((r, i) => ({ label: labels[i], model: r.slug }));
    const panel = alive.map((r, i) => `[${labels[i]}] REASONING:\n${r.reasoning}`).join('\n\n');
    const judge = t.judge ?? judgeSlug ?? alive[0].slug;

    try {
      // JUDGE SYNTHESIS: gabungkan panel jadi satu jawaban final
      const syn = await callModel(
        judge,
        [
          {
            role: 'system',
            content:
              'You are an impartial synthesizer. Given a task and anonymous reasoning sources, produce ONE unified final answer. Never mention provider names; refer to sources only as [Source A], [Source B], etc. For coding tasks include a fenced code block.',
          },
          { role: 'user', content: `TASK:\n${prompt}\n\nPANEL:\n${panel}` },
        ],
        { maxTokens: 1024 },
      );
      output = syn.content || syn.reasoning || '';
      trace.synthesis = true;
      trace.winnerJudge = judge;

      // skor transparansi per source (paralel, ringan)
      const scored = await Promise.all(
        alive.map(async (r, i) => {
          let s = 5;
          try {
            const o = await callModel(
              judge,
              [
                { role: 'system', content: 'Score this reasoning 0-10. Reply exactly: SCORE:<n>' },
                { role: 'user', content: r.reasoning },
              ],
              { maxTokens: 32 },
            );
            s = parseScore(o.content || o.reasoning || '');
          } catch {
            s = 5;
          }
          trace.scores.push({ model: r.slug, label: labels[i], score: s });
          return s;
        }),
      );
      const bestIdx = scored.indexOf(Math.max(...scored));
      winner = alive[bestIdx].slug;
    } catch {
      // judge unreachable -> fallback direct answer survivor pertama
      winner = alive[0].slug;
      output = alive[0].reasoning;
    }
  }
  trace.winner = winner;

  // 4) VALIDATOR LOOP + refinement
  for (let loop = 1; loop <= t.maxRefineLoops; loop += 1) {
    let pass = true;
    const issues = [];

    if (trace.taskType === 'coding') {
      const syntaxProblems = syntaxCheckCode(output);
      if (syntaxProblems.length > 0) {
        pass = false;
        issues.push(`syntax: ${syntaxProblems.join(' | ')}`);
      }
    }

    try {
      const judge = t.judge ?? judgeSlug ?? winner;
      const judgeOut = await callModel(
        judge,
        [
          {
            role: 'system',
            content:
              'Validate: efficient, well-structured, error-free, fully addresses the task. Reply: VERDICT:YES or VERDICT:NO then ISSUES:<text>.',
          },
          { role: 'user', content: `TASK:\n${prompt}\n\nANSWER:\n${output}` },
        ],
        { maxTokens: 128 },
      );
      const verdictText = judgeOut.content || judgeOut.reasoning || '';
      const okJudge = parseVerdict(verdictText);
      if (!okJudge) {
        pass = false;
        issues.push(extractIssues(verdictText) || 'judge rejected');
      }
      trace.validation.push(`loop${loop}: ${okJudge ? 'YES' : 'NO'}`);
    } catch {
      if (trace.taskType === 'coding' && issues.length === 0) {
        trace.validation.push(`loop${loop}: YES (syntax OK)`);
      } else if (trace.taskType === 'coding') {
        trace.validation.push(`loop${loop}: NO (syntax fail)`);
      } else {
        trace.validation.push(`loop${loop}: YES (no validator)`);
      }
    }

    if (pass) break;

    trace.refineLoops = loop;
    if (loop === t.maxRefineLoops) break;

    try {
      const refined = await callModel(
        winner,
        [
          ...execMessages(prompt),
          { role: 'assistant', content: output },
          { role: 'user', content: `Improve the answer. Fix these issues: ${issues.join('; ')}. Output ONLY the improved answer.` },
        ],
        { maxTokens: 1024 },
      );
      output = refined.content || refined.reasoning || output;
    } catch {
      break;
    }
  }

  return { output, winner, trace };
}