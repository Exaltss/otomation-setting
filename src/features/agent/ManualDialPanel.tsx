import React from 'react';
import type { ManualDials } from './hooks/useAgentMode';

interface ManualDialPanelProps {
  dials: ManualDials;
  onDialsChange: (dials: ManualDials) => void;
}

const DIAL_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'max', label: 'Max' },
] as const;

export const ManualDialPanel: React.FC<ManualDialPanelProps> = ({ dials, onDialsChange }) => {
  const handleChange = (key: keyof ManualDials, value: string) => {
    onDialsChange({ ...dials, [key]: value as ManualDials[typeof key] });
  };

  return (
    <div className="manual-dial-panel">
      <h3>Manual Settings</h3>

      <div className="dial-group">
        <label>Intelligence (Model Selection):</label>
        <select
          value={dials.intelligence}
          onChange={(e) => handleChange('intelligence', e.target.value)}
        >
          {DIAL_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="dial-group">
        <label>Thinking (Reasoning Depth):</label>
        <select
          value={dials.thinking}
          onChange={(e) => handleChange('thinking', e.target.value)}
        >
          {DIAL_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="dial-group">
        <label>Halusinasi (Anti-Hallucination):</label>
        <select
          value={dials.hallucination}
          onChange={(e) => handleChange('hallucination', e.target.value)}
        >
          {DIAL_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
};
