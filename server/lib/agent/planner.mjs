/**
 * Planner — Fase 23D.
 * Generate plan (workflow + claims + questions) dari deskripsi user.
 * Selalu pakai reasoning max karena ini fase perencanaan.
 */

const PLANNER_PROMPT = `You are a workflow architect AI. Given a task description, design a workflow plan.

TASK:
{task}

Return ONLY valid JSON (no markdown, no explanation) with this shape:
{
  "workflow": {
    "nodes": [
      { "id": "1", "type": "trigger|ai|tool|code|set|output", "position": {"x":0,"y":0}, "data": { ... } }
    ],
    "edges": [
      { "id": "e1", "source": "1", "target": "2", "sourceHandle": "optional" }
    ]
  },
  "claims": [
    { "name": "<key>", "resultPath": "<nodeId>.<field>", "type": "number|string|json", "description": "..." }
  ],
  "questions": [
    "<clarification question for user>"
  ],
  "summary": "<one-sentence summary of the plan>"
}

Rules:
- Use only these node types: trigger, ai, tool, code, set, output
- Tool types available: math, web_fetch, file_rw, js_sandbox, http_request, image_gen, whatsapp_send, gdrive_upload
- Ask clarifying questions only when truly ambiguous (file path, API key, target address)
- Include 2-5 claims that can be independently verified
- Position nodes left-to-right (x increasing)
- Keep data placeholders as {context}, {context_obj}, or {{ $json.field }}`;

/**
 * Generate plan dari deskripsi user.
 * @param {string} task - Deskripsi tugas
 * @param {Function} callModel - Gateway callModel function
 * @returns {Promise<Object>} plan structure
 */
export async function generatePlan(task, callModel) {
  const prompt = PLANNER_PROMPT.replace('{task}', task);

  try {
    const result = await callModel('auto', [{ role: 'user', content: prompt }], {
      maxTokens: 4096,
      sampling: { temperature: 0.1 },
    });

    const text = result.content || result.reasoning || '';
    return parsePlan(text);
  } catch (error) {
    return { error: String(error?.message ?? error) };
  }
}

function parsePlan(text) {
  const cleaned = String(text).replace(/```json/gi, '').replace(/```/g, '');
  try { return JSON.parse(cleaned); } catch {}

  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch {}
  }
  return null;
}
