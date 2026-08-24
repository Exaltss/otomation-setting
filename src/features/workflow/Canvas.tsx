/**
 * Visual workflow canvas (DAG).
 * Pondasi node editor: trigger -> router -> compressor -> action.
 * Node dan edge dapat di-drag serta dihubungkan (connect).
 */
import { useCallback } from 'react';
import {
  Background,
  Controls,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

const initialNodes: Node[] = [
  {
    id: 'trigger',
    type: 'input',
    position: { x: 0, y: 0 },
    data: { label: 'Trigger: Webhook / Form' },
  },
  {
    id: 'router',
    position: { x: 280, y: 100 },
    data: { label: '9Router: cost-aware routing' },
  },
  {
    id: 'compressor',
    position: { x: 560, y: 200 },
    data: { label: 'Compressed Context' },
  },
  {
    id: 'action',
    position: { x: 840, y: 300 },
    data: { label: 'Action: Email / API / DB' },
  },
];

const initialEdges: Edge[] = [
  { id: 'trigger-router', source: 'trigger', target: 'router' },
  { id: 'router-compressor', source: 'router', target: 'compressor' },
  { id: 'compressor-action', source: 'compressor', target: 'action' },
];

export function Canvas() {
  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onConnect = useCallback(
    (connection: Connection) => setEdges((currentEdges) => addEdge(connection, currentEdges)),
    [setEdges],
  );

  return (
    <div style={{ width: '100%', height: '420px', border: '1px solid #333', borderRadius: '8px' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        fitView
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}