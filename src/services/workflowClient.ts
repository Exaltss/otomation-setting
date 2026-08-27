/**
 * Klien SSE untuk Workflow Execution Engine.
 */
import { GATEWAY } from './gatewayClient';

export type WorkflowNodeType = 'trigger' | 'ai' | 'tool' | 'code' | 'output';

export interface WorkflowNodeData {
  label?: string;
  context?: string;
  prompt?: string;
  model?: string;
  toolName?: string;
  params?: Record<string, unknown>;
  code?: string;
  status?: string;
  [key: string]: unknown;
}

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  position: { x: number; y: number };
  data: WorkflowNodeData;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
}

export interface WorkflowEvent {
  type: 'node_start' | 'node_complete' | 'complete' | 'error';
  nodeId?: string;
  nodeType?: string;
  output?: string | null;
  error?: string;
  status?: 'running' | 'done' | 'error';
  success?: boolean;
  results?: Record<string, string>;
  errors?: Record<string, string>;
}

export async function* executeWorkflow(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): AsyncGenerator<WorkflowEvent> {
  const res = await fetch(`${GATEWAY}/v1/workflow/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodes, edges }),
  });

  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(data?.error?.message ?? `HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') return;
      try {
        yield JSON.parse(payload) as WorkflowEvent;
      } catch {
        // skip frame rusak
      }
    }
  }
}