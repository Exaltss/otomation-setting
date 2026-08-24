/**
 * Domain contracts untuk platform otomation-setting.
 * File ini murni deklarasi tipe — tanpa runtime logic.
 * Semua fitur (9Router, Compressed Context, Workflow Engine)
 * bergantung pada kontrak di sini.
 */

/** Provider AI/tool yang didukung. Extend union ini saat menambah integrasi. */
export type ProviderId = 'local' | 'groq' | 'openai' | 'anthropic' | 'custom';

/** Tier biaya — digunakan 9Router untuk memilih provider termurah yang mampu. */
export type ProviderTier = 'cheap' | 'standard' | 'premium';

/** Role pesan — kompatibel dengan mayoritas LLM API. */
export type ContextRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ContextMessage {
  role: ContextRole;
  content: string;
}

/** Keputusan yang dihasilkan 9Router. */
export interface RoutingDecision {
  provider: ProviderId;
  model: string;
  tier: ProviderTier;
  estimatedTokens: number;
  reason: string;
}

/** Hasil keluaran Compressed Context engine. */
export interface CompressedContext {
  messages: ContextMessage[];
  summary: string;
  estimatedTokens: number;
  droppedMessages: number;
}

/** Kategori node pada canvas workflow (dipakai Fase 6+). */
export type NodeKind = 'trigger' | 'router' | 'compressor' | 'action';

export interface WorkflowNode {
  id: string;
  kind: NodeKind;
  label: string;
  config: Record<string, unknown>;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
}

export interface Workflow {
  id: string;
  name: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}