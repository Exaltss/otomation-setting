/**
 * Workflow Execution Engine — DAG runner dengan topological sort.
 * Node types: trigger, ai, tool, code, output.
 */
import { executeToolCall } from './tools.mjs';

export const NODE_TYPES = {
  TRIGGER: 'trigger',
  AI: 'ai',
  TOOL: 'tool',
  CODE: 'code',
  OUTPUT: 'output',
};

/**
 * Detect cycles dalam DAG (Kahn's algorithm).
 */
export function detectCycles(nodes, edges) {
  const adj = new Map();
  const inDegree = new Map();

  for (const node of nodes) {
    adj.set(node.id, []);
    inDegree.set(node.id, 0);
  }

  for (const edge of edges) {
    if (!adj.has(edge.source) || !adj.has(edge.target)) continue;
    adj.get(edge.source).push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  const queue = [];
  for (const [nodeId, degree] of inDegree.entries()) {
    if (degree === 0) queue.push(nodeId);
  }

  const sorted = [];
  while (queue.length > 0) {
    const nodeId = queue.shift();
    sorted.push(nodeId);
    for (const neighbor of adj.get(nodeId) ?? []) {
      inDegree.set(neighbor, (inDegree.get(neighbor) ?? 0) - 1);
      if (inDegree.get(neighbor) === 0) queue.push(neighbor);
    }
  }

  const cycles = sorted.length === nodes.length ? [] : nodes.map((n) => n.id).filter((id) => !sorted.includes(id));
  return { valid: cycles.length === 0, cycles, sorted };
}

/**
 * Replace {context} placeholders in string or object.
 */
function replaceContext(value, context) {
  if (typeof value === 'string') {
    return value.replace(/\{context\}/g, context);
  }
  if (typeof value === 'object' && value !== null) {
    const str = JSON.stringify(value);
    const replaced = str.replace(/\{context\}/g, context);
    return JSON.parse(replaced);
  }
  return value;
}

/**
 * Execute single node dengan context dari node sebelumnya.
 */
async function executeNode(node, context, emit, gatewayCallModel) {
  const { id, type, data } = node;
  emit({ type: 'node_start', nodeId: id, nodeType: type });

  let output = '';
  let error = null;

  try {
    switch (type) {
      case NODE_TYPES.TRIGGER: {
        output = data?.context ?? '';
        break;
      }

      case NODE_TYPES.AI: {
        const prompt = replaceContext(data?.prompt ?? '', context);
        const model = data?.model ?? 'auto';
        
        // Call gateway's chat/completions
        const result = await gatewayCallModel(model, [{ role: 'user', content: prompt }]);
        output = result.content || result.reasoning || '';
        break;
      }

      case NODE_TYPES.TOOL: {
        const toolName = data?.toolName;
        if (!toolName) {
          throw new Error('toolName is required');
        }
        
        const params = replaceContext(data?.params ?? {}, context);
        const result = await executeToolCall(toolName, params);
        
        if (result.error) {
          throw new Error(result.error);
        }
        
        output = JSON.stringify(result);
        break;
      }

      case NODE_TYPES.CODE: {
        const code = replaceContext(data?.code ?? '', context);
        const result = await executeToolCall('js_sandbox', { code });
        
        if (result.error) {
          throw new Error(result.error);
        }
        
        output = result.stdout?.trim() || JSON.stringify(result);
        break;
      }

      case NODE_TYPES.OUTPUT: {
        output = context;
        break;
      }

      default:
        throw new Error(`Unknown node type: ${type}`);
    }
  } catch (e) {
    error = String(e?.message ?? e);
  }

  emit({
    type: 'node_complete',
    nodeId: id,
    nodeType: type,
    output: error ? null : output,
    error,
    status: error ? 'error' : 'done',
  });

  return { output, error };
}

/**
 * Execute entire workflow DAG.
 */
export async function executeWorkflow(nodes, edges, emit, gatewayCallModel) {
  const { valid, cycles, sorted } = detectCycles(nodes, edges);
  
  if (!valid) {
    emit({ type: 'error', error: `Cycle detected: ${cycles.join(', ')}` });
    return { success: false, error: `Cycle detected: ${cycles.join(', ')}`, results: new Map(), errors: new Map() };
  }

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const results = new Map();
  const errors = new Map();
  let currentContext = '';

  for (const nodeId of sorted) {
    const node = nodeMap.get(nodeId);
    if (!node) continue;

    const { output, error } = await executeNode(node, currentContext, emit, gatewayCallModel);

    if (error) {
      errors.set(nodeId, error);
      emit({ type: 'error', error: `Node ${nodeId} failed: ${error}` });
      return { success: false, error: `Node ${nodeId} failed: ${error}`, results, errors };
    }

    results.set(nodeId, output);
    currentContext = output; // Pass output ke node berikutnya
  }

  emit({
    type: 'complete',
    success: true,
    results: Object.fromEntries(results),
    errors: Object.fromEntries(errors),
  });

  return { success: true, results, errors };
}