import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { WorkflowNodeData } from '../../../services/workflowClient';

const TOOL_ICONS: Record<string, string> = {
  math: '🔢',
  web_fetch: '🌐',
  file_rw: '📁',
  js_sandbox: '⚡',
  http_request: '📡',
  image_gen: '🎨',
  whatsapp_send: '📱',
  gdrive_upload: '☁️',
};

export function ToolNode({ data, selected }: NodeProps) {
  const d = data as WorkflowNodeData;
  const toolName = typeof d.toolName === 'string' ? d.toolName : '';
  const icon = TOOL_ICONS[toolName] ?? '🔧';
  const status = typeof d.status === 'string' ? ` status-${d.status}` : '';

  return (
    <div className={`g-wf-node tool${selected ? ' selected' : ''}${status}`}>
      <Handle type="target" position={Position.Left} className="g-wf-handle" />
      <div className="g-wf-node-header">
        <span className="icon">{icon}</span>
        <span className="title">{d.label || toolName || 'Tool'}</span>
      </div>
      <div className="g-wf-node-body">
        <div className="preview">{toolName || '(no tool)'}</div>
      </div>
      <Handle type="source" position={Position.Right} className="g-wf-handle" />
    </div>
  );
}