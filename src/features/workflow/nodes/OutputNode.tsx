import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { WorkflowNodeData } from '../../../services/workflowClient';

export function OutputNode({ data, selected }: NodeProps) {
  const d = data as WorkflowNodeData;
  const status = typeof d.status === 'string' ? ` status-${d.status}` : '';

  return (
    <div className={`g-wf-node output${selected ? ' selected' : ''}${status}`}>
      <Handle type="target" position={Position.Left} className="g-wf-handle" />
      <div className="g-wf-node-header">
        <span className="icon">📤</span>
        <span className="title">{d.label || 'Output'}</span>
      </div>
      <div className="g-wf-node-body">
        <div className="preview">Final result</div>
      </div>
    </div>
  );
}