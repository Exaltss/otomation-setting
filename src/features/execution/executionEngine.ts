/**
 * Execution engine — orchestrator pipeline automation.
 *
 * Alur: 9Router -> Credit Guard -> Compressed Context(history) -> Adapter -> Vault -> Execute.
 * Resolusi model: override manual -> katalog API key (auto) -> fallback default tier.
 */
import { err, ok, unwrap, type Result } from '../../core/result';
import type {
  CompressedContext,
  ContextMessage,
  ProviderId,
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
  /** Riwayat percakapan sebelumnya (tanpa system prompt). */
  history?: ContextMessage[];
  /** Model pilihan user dari dropdown chat. */
  modelOverride?: string;
  /** Provider paksaan saat user memilih model manual. */
  providerOverride?: ProviderId;
}

export interface ExecutionReport {
  routing: RoutingDecision;
  providerUsed: ProviderId;
  modelUsed: string;
  overrideUsed: boolean;
  compressed: CompressedContext;
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

  // 1) 9Router: saran tier + provider paling hemat.
  const routing = unwrap(routeByNineRouter(payload, input.policy));

  // 2) Credit Guard: tolak sebelum eksekusi jika budget habis.
  unwrap(checkBudget(routing.estimatedTokens));

  // 3) Provider eksekusi: override manual atau saran router.
  const providerUsed = input.providerOverride ?? routing.provider;

  // 4) Compressed Context: system + riwayat + pertanyaan baru, dipadatkan.
  const messages: ContextMessage[] = [
    { role: 'system', content: BASE_SYSTEM_PROMPT },
    ...(input.history ?? []),
    { role: 'user', content: payload },
  ];
  const compressed = unwrap(
    compressContext(messages, input.policy.premiumMaxTokens),
  );

  // 5) Adapter + key dari vault.
  const adapter = unwrap(getAdapter(providerUsed));
  const apiKey = unwrap(await getApiKey(providerUsed));

  // 6) Resolusi model: override manual -> katalog key (auto) -> fallback tier.
  let modelUsed = input.modelOverride ?? null;
  if (modelUsed === null) {
    const catalog = await fetchModels(providerUsed, apiKey);
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

  const finalMessages: ContextMessage[] = [
    { role: 'system', content: systemPrompt },
    ...compressed.messages.filter((m) => m.role !== 'system'),
  ];

  const request: ExecutionRequest = {
    model: modelUsed,
    messages: finalMessages,
    apiKey,
  };

  // 7) Eksekusi.
  const response = unwrap(await adapter.execute(request));

  // 8) Catat pemakaian token.
  const usage = recordUsage(providerUsed, routing.estimatedTokens);

  return {
    routing,
    providerUsed,
    modelUsed,
    overrideUsed: input.modelOverride !== undefined || input.providerOverride !== undefined,
    compressed,
    output: response.output,
    durationMs: Math.round(performance.now() - startedAt),
    usageAfter: usage.totalTokens,
  };
}

/** Boundary publik: tidak pernah throw; gagal = Result + history. */
export async function executeWorkflow(
  input: ExecutionInput,
): Promise<Result<ExecutionReport, Error>> {
  try {
    const report = await runPipeline(input);
    appendHistory({
      provider: report.providerUsed,
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