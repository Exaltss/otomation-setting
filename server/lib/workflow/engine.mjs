/**
 * Workflow Execution Engine — DAG runner n8n-style.
 * - Topological sort (Kahn) + cycle detection
 * - Multi-parent branch merge
 * - [FIX B] Conditional branch pruning via route + sourceHandle
 * - continueOnFail per node
 */
import { randomUUID } from 'node:crypto';
import { NODE_REGISTRY } from './registry.mjs';
import { toItems, itemsToContext } from './items.mjs';

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
  const cycles = sorted.length === nodes.length
    ? []
    : nodes.map((n) => n.id).filter((id) => !sorted.includes(id));
  return { valid: cycles.length === 0, cycles, sorted };
}

export async function executeWorkflow(workflow, ctx = {}) {
  const emit = typeof ctx.emit === 'function' ? ctx.emit : () => {};
  const nodes = workflow.nodes ?? [];
  const edges = workflow.edges ?? [];

  const run = {
    id: randomUUID(),
    workflowId: workflow.id ?? 'adhoc',
    workflowName: workflow.name ?? 'Ad-hoc',
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
    nodeResults: {},
    results: {},
  };

  const { valid, cycles, sorted } = detectCycles(nodes, edges);
  if (!valid) {
    run.status = 'error';
    run.error = `Cycle detected: ${cycles.join(', ')}`;
    run.finishedAt = new Date().toISOString();
    emit({ type: 'error', error: run.error });
    return run;
  }

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const outputs = new Map();
  const executed = new Set();
  const routeOf = new Map(); // nodeId -> route string | null

  for (const nodeId of sorted) {
    const node = nodeMap.get(nodeId);
    if (!node) continue;

    // [FIX B] Tentukan apakah node ini aktif (reachable via active edges)
    const parentEdges = edges.filter((e) => e.target === nodeId);
    let active = parentEdges.length === 0; // trigger / root
    for (const e of parentEdges) {
      if (!executed.has(e.source)) continue; // parent di-skip
      const h = routeOf.get(e.source);
      const handleMatch =
        h === undefined || h === null ||
        e.sourceHandle === undefined || e.sourceHandle === null ||
        String(e.sourceHandle) === h;
      if (handleMatch) active = true;
    }

    if (!active) {
      run.nodeResults[nodeId] = { status: 'skipped', output: null };
      emit({ type: 'node_complete', nodeId, nodeType: node.type, output: null, error: null, status: 'skipped' });
      continue;
    }

    const def = NODE_REGISTRY[node.type];
    if (!def) {
      run.status = 'error';
      run.error = `Unknown node type: ${node.type}`;
      run.finishedAt = new Date().toISOString();
      emit({ type: 'error', error: run.error });
      return run;
    }

    const parentIds = parentEdges.map((e) => e.source);
    const inputItems = parentIds.flatMap((pid) => outputs.get(pid) ?? []);

    emit({ type: 'node_start', nodeId, nodeType: node.type });
    try {
      const outItems = await def.execute(inputItems, node.data ?? {}, ctx);
      outputs.set(nodeId, outItems);
      executed.add(nodeId);

      // [FIX B] Rekam route untuk pruning branch downstream
      const firstJson = outItems[0]?.json;
      routeOf.set(
        nodeId,
        firstJson && typeof firstJson === 'object' && firstJson.route !== undefined
          ? String(firstJson.route)
          : null,
      );

      const preview = itemsToContext(outItems);
      run.nodeResults[nodeId] = { status: 'done', output: preview };
      emit({ type: 'node_complete', nodeId, nodeType: node.type, output: preview, error: null, status: 'done' });
    } catch (e) {
      const msg = String(e?.message ?? e);
      run.nodeResults[nodeId] = { status: 'error', output: msg };
      emit({ type: 'node_complete', nodeId, nodeType: node.type, output: null, error: msg, status: 'error' });

      if (node.data?.continueOnFail === true) {
        outputs.set(nodeId, toItems({ error: msg }));
        executed.add(nodeId);
        routeOf.set(nodeId, null);
        continue;
      }
      run.status = 'error';
      run.error = `Node ${nodeId} (${node.type}) gagal: ${msg}`;
      run.finishedAt = new Date().toISOString();
      emit({ type: 'error', error: run.error });
      return run;
    }
  }

  run.status = 'success';
  run.finishedAt = new Date().toISOString();
  for (const [id, items] of outputs.entries()) run.results[id] = itemsToContext(items);
  emit({ type: 'complete', success: true, results: run.results, errors: {} });
  return run;
}