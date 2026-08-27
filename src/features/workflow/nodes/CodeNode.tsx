import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { WorkflowNodeData } from '../../../services/workflowClient';

export function CodeNode({ data, selected }: NodeProps) {
  const d = data as WorkflowNodeData;
  const code = typeof d.code === 'string' ? d.code : '';
  const status = typeof d.status === 'string' ? ` status-${d.status}` : '';

  return (
    <div className={`g-wf-node code${selected ? ' selected' : ''}${status}`}>
      <Handle type="target" position={Position.Left} className="g-wf-handle" />
      <div className="g-wf-node-header">
        <span className="icon">💻</span>
        <span className="title">{d.label || 'Code'}</span>
      </div>
      <div className="g-wf-node-body">
        <div className="preview">{code ? `${code.length} chars` : '(no code)'}</div>
      </div>
      <Handle type="source" position={Position.Right} className="g-wf-handle" />
    </div>
  );
}