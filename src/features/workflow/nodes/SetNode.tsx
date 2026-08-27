import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { WorkflowNodeData } from '../../../services/workflowClient';

export function SetNode({ data, selected }: NodeProps) {
  const d = data as WorkflowNodeData;
  const status = typeof d.status === 'string' ? ` status-${d.status}` : '';

  return (
    <div className={`g-wf-node set${selected ? ' selected' : ''}${status}`}>
      <Handle type="target" position={Position.Left} className="g-wf-handle" />
      <div className="g-wf-node-header">
        <span className="icon">⚙️</span>
        <span className="title">{d.label || 'Set / Transform'}</span>
      </div>
      <div className="g-wf-node-body">
        <div className="preview">Transform data</div>
      </div>
      <Handle type="source" position={Position.Right} className="g-wf-handle" />
    </div>
  );
}