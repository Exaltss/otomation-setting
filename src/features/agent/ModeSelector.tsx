import React from 'react';
import type { AgentMode } from './hooks/useAgentMode';

interface ModeSelectorProps {
  mode: AgentMode;
  onModeChange: (mode: AgentMode) => void;
}

const MODES = [
  { value: 'auto', label: 'AUTO', description: 'Sistem otomatis deteksi pertanyaan' },
  { value: 'manual', label: 'MANUAL', description: 'User atur 3 dial + konfirmasi per langkah' },
  { value: 'planning', label: 'PLANNING', description: 'Reasoning maksimal, plan dulu baru eksekusi' },
  { value: 'auto_remote', label: 'AUTO REMOTE', description: 'Fitur terbaik, full otonomi (YOLO)' },
] as const;

export const ModeSelector: React.FC<ModeSelectorProps> = ({ mode, onModeChange }) => {
  return (
    <div className="agent-mode-selector">
      <label htmlFor="mode-select">Mode:</label>
      <select
        id="mode-select"
        value={mode}
        onChange={(e) => onModeChange(e.target.value as AgentMode)}
        className="mode-dropdown"
      >
        {MODES.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>
      <p className="mode-description">
        {MODES.find((m) => m.value === mode)?.description}
      </p>
    </div>
  );
};
