/**
 * Drawer konfigurasi node. State di-init dari props + key={node.id}
 * (pola React resmi, tanpa setState di dalam effect).
 */
import { useState } from 'react';
import type { FlowNode } from './types';
import type { WorkflowNodeData } from '../../services/workflowClient';

interface NodeConfigDrawerProps {
  node: FlowNode;
  onClose: () => void;
  onSave: (nodeId: string, data: WorkflowNodeData) => void;
}

const TOOL_OPTIONS = [
  { value: 'math', label: '🔢 Math' },
  { value: 'web_fetch', label: '🌐 Web Fetch' },
  { value: 'file_rw', label: '📁 File R/W' },
  { value: 'js_sandbox', label: '⚡ JS Sandbox' },
  { value: 'http_request', label: '📡 HTTP Request' },
  { value: 'image_gen', label: '🎨 Image Gen' },
  { value: 'whatsapp_send', label: '📱 WhatsApp Send' },
  { value: 'gdrive_upload', label: '☁️ Google Drive' },
];

export function NodeConfigDrawer({ node, onClose, onSave }: NodeConfigDrawerProps) {
  const [formData, setFormData] = useState<WorkflowNodeData>({ ...node.data });

  const update = (patch: Partial<WorkflowNodeData>) => {
    setFormData((prev) => ({ ...prev, ...patch }));
  };

  const paramStr = (key: string): string => {
    const v = (formData.params ?? {})[key];
    return typeof v === 'string' ? v : '';
  };

  const handleSave = () => {
    onSave(node.id, formData);
    onClose();
  };

  const renderFields = () => {
    switch (node.type) {
      case 'trigger':
        return (
          <>
            <div className="field">
              <label>Label</label>
              <input
                type="text"
                value={formData.label ?? ''}
                onChange={(e) => update({ label: e.target.value })}
                placeholder="Trigger"
              />
            </div>
            <div className="field">
              <label>Initial Context</label>
              <textarea
                value={formData.context ?? ''}
                onChange={(e) => update({ context: e.target.value })}
                placeholder="Initial input untuk workflow"
                rows={4}
              />
            </div>
          </>
        );

      case 'ai':
        return (
          <>
            <div className="field">
              <label>Label</label>
              <input
                type="text"
                value={formData.label ?? ''}
                onChange={(e) => update({ label: e.target.value })}
                placeholder="AI Reasoning"
              />
            </div>
            <div className="field">
              <label>Prompt (gunakan {'{context}'} untuk input node sebelumnya)</label>
              <textarea
                value={formData.prompt ?? ''}
                onChange={(e) => update({ prompt: e.target.value })}
                placeholder="Analisis data berikut: {context}"
                rows={6}
              />
            </div>
            <div className="field">
              <label>Model (opsional, kosong = auto)</label>
              <input
                type="text"
                value={formData.model ?? ''}
                onChange={(e) => update({ model: e.target.value })}
                placeholder="auto"
              />
            </div>
          </>
        );

      case 'tool':
        return (
          <>
            <div className="field">
              <label>Label</label>
              <input
                type="text"
                value={formData.label ?? ''}
                onChange={(e) => update({ label: e.target.value })}
                placeholder="Tool Call"
              />
            </div>
            <div className="field">
              <label>Tool</label>
              <select
                value={formData.toolName ?? ''}
                onChange={(e) => update({ toolName: e.target.value, params: {} })}
              >
                <option value="">Pilih tool...</option>
                {TOOL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            {formData.toolName === 'math' && (
              <div className="field">
                <label>Expression (dukung {'{context}'})</label>
                <input
                  type="text"
                  value={paramStr('expression')}
                  onChange={(e) => update({ params: { expression: e.target.value } })}
                  placeholder="{context}"
                />
              </div>
            )}
            {formData.toolName === 'web_fetch' && (
              <div className="field">
                <label>URL (dukung {'{context}'})</label>
                <input
                  type="text"
                  value={paramStr('url')}
                  onChange={(e) => update({ params: { url: e.target.value } })}
                  placeholder="https://example.com"
                />
              </div>
            )}
            {formData.toolName === 'js_sandbox' && (
              <div className="field">
                <label>JavaScript Code</label>
                <textarea
                  value={paramStr('code')}
                  onChange={(e) => update({ params: { code: e.target.value } })}
                  placeholder="console.log('hasil: ' + '{context}')"
                  rows={6}
                />
              </div>
            )}
                        {formData.toolName === 'image_gen' && (
              <div className="field">
                <label>Image Prompt (dukung {'{context}'})</label>
                <textarea
                  value={paramStr('prompt')}
                  onChange={(e) => update({ params: { prompt: e.target.value } })}
                  placeholder="T-shirt design, blue batik wave motif, flat vector style"
                  rows={4}
                />
              </div>
            )}
            {formData.toolName === 'whatsapp_send' && (
              <>
                <div className="field">
                  <label>Nomor WhatsApp</label>
                  <input
                    type="text"
                    value={paramStr('to')}
                    onChange={(e) => update({ params: { ...formData.params, to: e.target.value } })}
                    placeholder="628123456789"
                  />
                </div>
                <div className="field">
                  <label>Pesan (dukung {'{context}'})</label>
                  <textarea
                    value={paramStr('message')}
                    onChange={(e) => update({ params: { ...formData.params, message: e.target.value } })}
                    placeholder="Desain baju terbaru: {context}"
                    rows={3}
                  />
                </div>
                <div className="field">
                  <label>File gambar (opsional, nama file lokal)</label>
                  <input
                    type="text"
                    value={paramStr('file')}
                    onChange={(e) => update({ params: { ...formData.params, file: e.target.value } })}
                    placeholder="img_123.jpg (kosongkan jika tidak ada)"
                  />
                </div>
              </>
            )}
            {formData.toolName === 'gdrive_upload' && (
              <>
                <div className="field">
                  <label>File lokal (dari image_gen)</label>
                  <input
                    type="text"
                    value={paramStr('file')}
                    onChange={(e) => update({ params: { ...formData.params, file: e.target.value } })}
                    placeholder="img_123.jpg"
                  />
                </div>
                <div className="field">
                  <label>Nama di Drive (opsional)</label>
                  <input
                    type="text"
                    value={paramStr('name')}
                    onChange={(e) => update({ params: { ...formData.params, name: e.target.value } })}
                    placeholder="desain-baju-001.jpg"
                  />
                </div>
              </>
            )}
          </>
        );

      case 'code':
        return (
          <>
            <div className="field">
              <label>Label</label>
              <input
                type="text"
                value={formData.label ?? ''}
                onChange={(e) => update({ label: e.target.value })}
                placeholder="Code"
              />
            </div>
            <div className="field">
              <label>JavaScript Code (dukung {'{context}'})</label>
              <textarea
                value={formData.code ?? ''}
                onChange={(e) => update({ code: e.target.value })}
                placeholder={'const input = \'{context}\';\nconsole.log(input.toUpperCase());'}
                rows={10}
                className="code-editor"
              />
            </div>
          </>
        );

      case 'output':
        return (
          <>
            <div className="field">
              <label>Label</label>
              <input
                type="text"
                value={formData.label ?? ''}
                onChange={(e) => update({ label: e.target.value })}
                placeholder="Output"
              />
            </div>
            <div className="field info">
              <p>Output node menampilkan hasil dari node sebelumnya.</p>
            </div>
          </>
        );

      default:
        return null;
    }
  };

  return (
    <div className="g-wf-drawer-overlay" onClick={onClose}>
      <div className="g-wf-drawer" onClick={(e) => e.stopPropagation()}>
        <header>
          <h3>Konfigurasi {node.type}</h3>
          <button onClick={onClose} className="close-btn">✕</button>
        </header>
        <div className="body">{renderFields()}</div>
        <footer>
          <button onClick={onClose} className="btn-secondary">Batal</button>
          <button onClick={handleSave} className="btn-primary">Simpan</button>
        </footer>
      </div>
    </div>
  );
}