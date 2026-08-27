import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { WorkflowNodeData } from '../../../services/workflowClient';

export function TriggerNode({ data, selected }: NodeProps) {
  const d = data as WorkflowNodeData;
  const context = typeof d.context === 'string' ? d.context : '';
  const preview = context.length > 50 ? `${context.slice(0, 50)}…` : context;
  const status = typeof d.status === 'string' ? ` status-${d.status}` : '';

  return (
    <div className={`g-wf-node trigger${selected ? ' selected' : ''}${status}`}>
      <div className="g-wf-node-header">
        <span className="icon">🚀</span>
        <span className="title">{d.label || 'Trigger'}</span>
      </div>
      <div className="g-wf-node-body">
        <div className="preview">{preview || '(empty)'}</div>
      </div>
      <Handle type="source" position={Position.Right} className="g-wf-handle" />
    </div>
  );
}