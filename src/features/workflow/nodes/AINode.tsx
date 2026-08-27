import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { WorkflowNodeData } from '../../../services/workflowClient';

export function AINode({ data, selected }: NodeProps) {
  const d = data as WorkflowNodeData;
  const prompt = typeof d.prompt === 'string' ? d.prompt : '';
  const preview = prompt.length > 50 ? `${prompt.slice(0, 50)}…` : prompt;
  const status = typeof d.status === 'string' ? ` status-${d.status}` : '';

  return (
    <div className={`g-wf-node ai${selected ? ' selected' : ''}${status}`}>
      <Handle type="target" position={Position.Left} className="g-wf-handle" />
      <div className="g-wf-node-header">
        <span className="icon">🤖</span>
        <span className="title">{d.label || 'AI Reasoning'}</span>
      </div>
      <div className="g-wf-node-body">
        <div className="preview">{preview || '(no prompt)'}</div>
      </div>
      <Handle type="source" position={Position.Right} className="g-wf-handle" />
    </div>
  );
}