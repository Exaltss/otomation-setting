import type { DragEvent } from 'react';

const NODE_TYPES = [
  { type: 'trigger', icon: '🚀', label: 'Trigger', description: 'Pemicu workflow' },
  { type: 'ai', icon: '🤖', label: 'AI Reasoning', description: 'Panggil AI model' },
  { type: 'tool', icon: '🔧', label: 'Tool', description: 'Eksekusi tool' },
  { type: 'code', icon: '💻', label: 'Code', description: 'Custom JS logic' },
  { type: 'output', icon: '📤', label: 'Output', description: 'Hasil akhir' },
];

export function WorkflowPalette() {
  const handleDragStart = (e: DragEvent, type: string) => {
    e.dataTransfer.setData('application/workflow-node', type);
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <aside className="g-wf-palette">
      <h3>Node Types</h3>
      <div className="node-list">
        {NODE_TYPES.map((node) => (
          <div
            key={node.type}
            className="palette-item"
            draggable
            onDragStart={(e) => handleDragStart(e, node.type)}
          >
            <div className="icon">{node.icon}</div>
            <div className="info">
              <div className="label">{node.label}</div>
              <div className="description">{node.description}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="palette-help">
        <p>Drag & drop node ke canvas, lalu hubungkan dengan edge. Klik node untuk konfigurasi.</p>
      </div>
    </aside>
  );
}