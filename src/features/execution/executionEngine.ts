/**
 * Execution engine — orchestrator pipeline automation.
 *
 * Alur: 9Router -> Compressed Context -> Adapter -> Vault key -> Execute.
 * Result di boundary (executeWorkflow), alur linear di internal (runPipeline).
 */
import { err, ok, unwrap, type Result } from '../../core/result';
import type {
  CompressedContext,
  ContextMessage,
  RoutingDecision,
} from '../../domain/automation';
import { getApiKey } from '../../services/providerService';
import { compressContext } from '../context/compressedContext';
import { routeByNineRouter, type RouterPolicy } from '../router/nineRouter';
import { getAdapter, type ExecutionRequest } from './providerAdapters';

const BASE_SYSTEM_PROMPT =
  'You are the execution core of otomation-setting. Answer concisely and follow the user instruction.';

export interface ExecutionInput {
  payload: string;
  policy: RouterPolicy;
}

export interface ExecutionReport {
  routing: RoutingDecision;
  compressed: CompressedContext;
  output: string;
  durationMs: number;
}

async function runPipeline(input: ExecutionInput): Promise<ExecutionReport> {
  const startedAt = performance.now();

  const payload = input.payload.trim();
  if (payload.length === 0) {
    throw new Error('Trigger payload is empty.');
  }

  // 1) 9Router: provider/model paling hemat yang mampu menangani tugas.
  const routing = unwrap(routeByNineRouter(payload, input.policy));

  // 2) Compressed Context: padatkan sebelum dikirim (hemat token/credit).
  const messages: ContextMessage[] = [
    { role: 'system', content: BASE_SYSTEM_PROMPT },
    { role: 'user', content: payload },
  ];
  const compressed = unwrap(
    compressContext(messages, input.policy.premiumMaxTokens),
  );

  // 3) Adapter + key dari vault terenkripsi.
  const adapter = unwrap(getAdapter(routing.provider));
  const apiKey = unwrap(await getApiKey(routing.provider));

  // 4) Ringkasan konteks (jika ada) ikut dikirim sebagai system prompt.
  const systemPrompt =
    compressed.summary !== ''
      ? `${BASE_SYSTEM_PROMPT}\nCompressed context summary: ${compressed.summary}`
      : BASE_SYSTEM_PROMPT;

  const request: ExecutionRequest = {
    model: routing.model,
    systemPrompt,
    userPrompt: payload,
    apiKey,
  };

  // 5) Eksekusi.
  const response = unwrap(await adapter.execute(request));

  return {
    routing,
    compressed,
    output: response.output,
    durationMs: Math.round(performance.now() - startedAt),
  };
}

/**
 * Boundary publik: tidak pernah throw.
 * Semua kegagalan dikembalikan sebagai Result.
 */
export async function executeWorkflow(
  input: ExecutionInput,
): Promise<Result<ExecutionReport, Error>> {
  try {
    return ok(await runPipeline(input));
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}