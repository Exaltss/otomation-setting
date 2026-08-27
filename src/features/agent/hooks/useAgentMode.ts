import { useState, useEffect } from 'react';
import { useAgentAPI } from './useAgentAPI';
import type { AgentConfig } from './useAgentAPI';

export type AgentMode = 'auto' | 'manual' | 'planning' | 'auto_remote';

export interface ManualDials {
  intelligence: 'low' | 'medium' | 'high' | 'max';
  thinking: 'low' | 'medium' | 'high' | 'max';
  hallucination: 'low' | 'medium' | 'high' | 'max';
}

export function useAgentMode() {
  const [mode, setMode] = useState<AgentMode>('auto');
  const [dials, setDials] = useState<ManualDials>({
    intelligence: 'medium',
    thinking: 'medium',
    hallucination: 'medium',
  });
  const [config, setConfig] = useState<AgentConfig | null>(null);

  const api = useAgentAPI();

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const dialsParam = mode === 'manual'
          ? (dials as unknown as Record<string, string>)
          : undefined;
        const cfg = await api.resolveConfig(mode, dialsParam);
        setConfig(cfg);
      } catch (err) {
        console.error('Failed to resolve config:', err);
      }
    };
    loadConfig();
  }, [mode, dials, api]);

  return {
    mode,
    setMode,
    dials,
    setDials,
    config,
    loading: api.loading,
    error: api.error,
  };
}
