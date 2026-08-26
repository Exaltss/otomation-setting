/**
 * Workflow Canvas — demo DAG visual dengan React Flow.
 * Self-contained: state nodes/edges internal, tanpa store eksternal.
 */
import { useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

const initialNodes: Node[] = [
  { id: 'trigger', type: 'default', position: { x: 40, y: 40 }, data: { label: 'Trigger: form masuk' } },
  { id: 'condition', type: 'default', position: { x: 260, y: 120 }, data: { label: 'Condition: validasi email' } },
  { id: 'action', type: 'default', position: { x: 480, y: 200 }, data: { label: 'Action: kirim email' } },
  { id: 'output', type: 'default', position: { x: 700, y: 280 }, data: { label: 'Output: log hasil' } },
];

const initialEdges: Edge[] = [
  { id: 'e1', source: 'trigger', target: 'condition' },
  { id: 'e2', source: 'condition', target: 'action' },
  { id: 'e3', source: 'action', target: 'output' },
];

export function Canvas() {
  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onConnect = useCallback(
    (conn: Connection) => setEdges((eds) => addEdge(conn, eds)),
    [setEdges],
  );

  return (
    <div style={{ height: 420, border: '1px solid #333', borderRadius: 8, background: '#131314' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        fitView
        colorMode="dark"
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}