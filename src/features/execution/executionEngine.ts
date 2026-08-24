/**
 * Execution engine — orchestrator pipeline automation.
 *
 * Alur: 9Router -> Credit Guard -> Compressed Context -> Adapter -> Vault -> Execute.
 * Resolusi model: override manual -> katalog API key (auto) -> fallback default tier.
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
import { checkBudget, recordUsage } from './creditGuard';
import { appendHistory } from './executionHistory';
import { fetchModels, pickModelForTier } from './modelCatalog';
import { getAdapter, type ExecutionRequest } from './providerAdapters';

const BASE_SYSTEM_PROMPT =
  'You are the execution core of otomation-setting. Answer concisely and follow the user instruction.';

export interface ExecutionInput {
  payload: string;
  policy: RouterPolicy;
  /** Model pilihan user dari dropdown (Fase 11C). Kosong = auto dari katalog key. */
  modelOverride?: string;
}

export interface ExecutionReport {
  routing: RoutingDecision;
  compressed: CompressedContext;
  modelUsed: string;
  output: string;
  durationMs: number;
  usageAfter: number;
}

async function runPipeline(input: ExecutionInput): Promise<ExecutionReport> {
  const startedAt = performance.now();

  const payload = input.payload.trim();
  if (payload.length === 0) {
    throw new Error('Trigger payload is empty.');
  }

  // 1) 9Router: tier + provider paling hemat yang mampu menangani tugas.
  const routing = unwrap(routeByNineRouter(payload, input.policy));

  // 2) Credit Guard: tolak SEBELUM eksekusi jika budget harian habis.
  unwrap(checkBudget(routing.estimatedTokens));

  // 3) Compressed Context: padatkan sebelum dikirim.
  const messages: ContextMessage[] = [
    { role: 'system', content: BASE_SYSTEM_PROMPT },
    { role: 'user', content: payload },
  ];
  const compressed = unwrap(
    compressContext(messages, input.policy.premiumMaxTokens),
  );

  // 4) Adapter + key dari vault terenkripsi.
  const adapter = unwrap(getAdapter(routing.provider));
  const apiKey = unwrap(await getApiKey(routing.provider));

  // 5) Resolusi model: override manual -> katalog key (auto) -> fallback tier.
  let modelUsed = input.modelOverride ?? null;
  if (modelUsed === null) {
    const catalog = await fetchModels(routing.provider, apiKey);
    if (catalog.ok) {
      modelUsed = pickModelForTier(routing.tier, catalog.value);
    }
  }
  if (modelUsed === null) {
    modelUsed = routing.model;
  }

  const systemPrompt =
    compressed.summary !== ''
      ? `${BASE_SYSTEM_PROMPT}\nCompressed context summary: ${compressed.summary}`
      : BASE_SYSTEM_PROMPT;

  const request: ExecutionRequest = {
    model: modelUsed,
    systemPrompt,
    userPrompt: payload,
    apiKey,
  };

  // 6) Eksekusi.
  const response = unwrap(await adapter.execute(request));

  // 7) Catat pemakaian token (hanya eksekusi sukses).
  const usage = recordUsage(routing.provider, routing.estimatedTokens);

  return {
    routing,
    compressed,
    modelUsed,
    output: response.output,
    durationMs: Math.round(performance.now() - startedAt),
    usageAfter: usage.totalTokens,
  };
}

/**
 * Boundary publik: tidak pernah throw.
 * Semua kegagalan dikembalikan sebagai Result + tercatat di history.
 */
export async function executeWorkflow(
  input: ExecutionInput,
): Promise<Result<ExecutionReport, Error>> {
  try {
    const report = await runPipeline(input);
    appendHistory({
      provider: report.routing.provider,
      tier: report.routing.tier,
      estimatedTokens: report.routing.estimatedTokens,
      durationMs: report.durationMs,
      status: 'ok',
      message: report.output.slice(0, 140),
    });
    return ok(report);
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error));
    appendHistory({
      status: 'error',
      estimatedTokens: 0,
      durationMs: 0,
      message: normalized.message,
    });
    return err(normalized);
  }
}