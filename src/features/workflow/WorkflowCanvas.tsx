/**
 * Workflow Canvas eksekutabel — drag & drop, config, RUN dengan progress real-time.
 */
import { useCallback, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  addEdge,
  useNodesState,
  useEdgesState,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { TriggerNode } from './nodes/TriggerNode';
import { AINode } from './nodes/AINode';
import { ToolNode } from './nodes/ToolNode';
import { CodeNode } from './nodes/CodeNode';
import { SetNode } from './nodes/SetNode';
import { OutputNode } from './nodes/OutputNode';
import { WorkflowPalette } from './WorkflowPalette';
import { NodeConfigDrawer } from './NodeConfigDrawer';
import { executeWorkflow } from '../../services/workflowClient';
import type { WorkflowNodeData, WorkflowNodeType, WorkflowNode } from '../../services/workflowClient';
import type { FlowNode } from './types';

const nodeTypes: NodeTypes = {
  trigger: TriggerNode,
  ai: AINode,
  tool: ToolNode,
  code: CodeNode,
  set: SetNode,
  output: OutputNode,
};

function WorkflowCanvasInner() {
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [finalOutput, setFinalOutput] = useState('');
  const { screenToFlowPosition } = useReactFlow();

  const selectedNode = nodes.find((n) => n.id === selectedId) ?? null;

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges],
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData('application/workflow-node') as WorkflowNodeType;
      if (!type) return;
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const newNode: FlowNode = {
        id: `${type}_${Date.now()}`,
        type,
        position,
        data: { label: type.charAt(0).toUpperCase() + type.slice(1) },
      };
      setNodes((nds) => [...nds, newNode]);
    },
    [screenToFlowPosition, setNodes],
  );

  const handleSaveNode = useCallback(
    (nodeId: string, data: WorkflowNodeData) => {
      setNodes((nds) =>
        nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n)),
      );
    },
    [setNodes],
  );

  const setNodeStatus = (nodeId: string, status: string) => {
    setNodes((nds) =>
      nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, status } } : n)),
    );
  };

  const handleRun = async () => {
    if (running || nodes.length === 0) return;
    setRunning(true);
    setFinalOutput('');
    nodes.forEach((n) => setNodeStatus(n.id, 'pending'));

    try {
      const workflowNodes: WorkflowNode[] = nodes.map((n) => ({
        id: n.id,
        type: n.type as WorkflowNodeType,
        position: n.position,
        data: n.data,
      }));

      for await (const event of executeWorkflow(workflowNodes, edges)) {
        if (event.type === 'node_start' && event.nodeId) {
          setNodeStatus(event.nodeId, 'running');
        } else if (event.type === 'node_complete' && event.nodeId) {
          setNodeStatus(event.nodeId, event.status === 'error' ? 'error' : 'done');
        } else if (event.type === 'complete') {
          if (event.success && event.results) {
            const outputNode = nodes.find((n) => n.type === 'output');
            const last = outputNode ? event.results[outputNode.id] : undefined;
            setFinalOutput(last ?? JSON.stringify(event.results, null, 2));
          }
        } else if (event.type === 'error') {
          setFinalOutput(`⚠️ ${event.error ?? 'workflow error'}`);
        }
      }
    } catch (e) {
      setFinalOutput(`⚠️ ${String(e)}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="g-wf-container">
      <WorkflowPalette />

      <div className="g-wf-main">
        <header className="g-wf-toolbar">
          <h2>Workflow Canvas</h2>
          <button
            className={`btn-run${running ? ' running' : ''}`}
            onClick={() => void handleRun()}
            disabled={running || nodes.length === 0}
          >
            {running ? '⏳ Running...' : '▶ Run Workflow'}
          </button>
        </header>

        <div className="g-wf-canvas">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onDrop={onDrop}
            onDragOver={onDragOver}
            nodeTypes={nodeTypes}
            fitView
            colorMode="dark"
          >
            <Background />
            <Controls />
          </ReactFlow>
        </div>

        {finalOutput !== '' && (
          <div className="g-wf-output">
            <header>
              <h3>Output</h3>
              <button onClick={() => setFinalOutput('')} className="close-btn">✕</button>
            </header>
            <pre>{finalOutput}</pre>
          </div>
        )}
      </div>

      {selectedNode && (
        <NodeConfigDrawer
          key={selectedNode.id}
          node={selectedNode}
          onClose={() => setSelectedId(null)}
          onSave={handleSaveNode}
        />
      )}
    </div>
  );
}

export function WorkflowCanvas() {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner />
    </ReactFlowProvider>
  );
}