import { useState, useCallback } from 'react';

const API_BASE = 'http://localhost:4123/v1/agent';

export interface AgentMode {
  name: string;
  description: string;
  autonomy: string;
}

export interface WorkflowNode {
  id: string;
  type: string;
  position?: { x: number; y: number };
  data?: Record<string, unknown>;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
}

export interface Workflow {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  name?: string;
}

export interface AgentConfig {
  mode: string;
  autonomy: string;
  dials: {
    intelligence: string;
    thinking: string;
    hallucination: string;
  };
  intelligence: {
    tier: string;
    tournament: boolean;
  };
  thinking: {
    reasoningMaxTokens: number;
  };
  hallucination: {
    temperature: number;
    forceTools: boolean;
    verifier: boolean | string;
  };
}

export interface Permission {
  type: string;
  scope: 'session' | 'persistent';
}

export interface PlanClaim {
  name: string;
  resultPath: string;
  type: string;
  description: string;
}

export interface PlanVersion {
  version: number;
  workflow: Workflow;
  claims: PlanClaim[];
  questions: string[];
}

export interface Plan {
  id: string;
  status: 'pending' | 'approved' | 'executed' | 'expired';
  versions: PlanVersion[];
  approvedVersion?: number;
}

export interface AuditEntry {
  type: string;
  action?: string;
  at: string;
  specialist?: string;
  step?: string;
  [key: string]: unknown;
}

export interface PermissionsState {
  types: string[];
  persistent: Record<string, string>;
  session: string[];
  denied: string[];
}

export interface ModesResponse {
  modes: Record<string, AgentMode>;
}

export interface DetectionResponse {
  detection: {
    complexity: number;
    risk: number;
    dials: {
      intelligence: string;
      thinking: string;
      hallucination: string;
    };
    neededTools: Array<{ tool: string; perm: string | null }>;
    neededPermissions: string[];
    shouldAsk: boolean;
  };
  config: AgentConfig;
}

export interface PlanResponse {
  plan: Plan;
  summary?: string;
}

export interface AuditResponse {
  audit: AuditEntry[];
}

export interface RemoteResponse {
  success: boolean;
  sessionId?: string;
  steps?: Array<{
    success: boolean;
    specialist: string;
    output?: string;
    reasoning?: string;
    error?: string;
  }>;
  specialists?: string[];
  permissionStatus?: Record<string, string>;
  verification?: Record<string, unknown>;
  contextStats?: {
    messageCount: number;
    totalTokens: number;
    maxTokens: number;
    usage: string;
    compactCount: number;
    needsCompaction: boolean;
  };
  error?: string;
}

export interface RemoteOptions {
  sessionId?: string;
  silentVerify?: boolean;
  autoApprovePermissions?: string[];
}

export type DialsConfig = Record<string, string>;

export function useAgentAPI() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchJSON = useCallback(async <T,>(url: string, options?: RequestInit): Promise<T> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(url, options);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || `HTTP ${res.status}`);
      }
      return await res.json();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const getModes = useCallback((): Promise<ModesResponse> => {
    return fetchJSON<ModesResponse>(`${API_BASE}/modes`);
  }, [fetchJSON]);

  const resolveConfig = useCallback((mode: string, dials?: DialsConfig): Promise<AgentConfig> => {
    return fetchJSON<AgentConfig>(`${API_BASE}/config/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, dials }),
    });
  }, [fetchJSON]);

  const detectQuestion = useCallback((question: string): Promise<DetectionResponse> => {
    return fetchJSON<DetectionResponse>(`${API_BASE}/detect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    });
  }, [fetchJSON]);

  const getPermissions = useCallback((): Promise<PermissionsState> => {
    return fetchJSON<PermissionsState>(`${API_BASE}/permissions`);
  }, [fetchJSON]);

  const grantPermission = useCallback((type: string, scope: 'session' | 'persistent'): Promise<{ ok: boolean; type: string; scope: string }> => {
    return fetchJSON<{ ok: boolean; type: string; scope: string }>(`${API_BASE}/permissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, action: 'grant', scope }),
    });
  }, [fetchJSON]);

  const revokePermission = useCallback((type: string): Promise<{ ok: boolean; type: string }> => {
    return fetchJSON<{ ok: boolean; type: string }>(`${API_BASE}/permissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, action: 'revoke' }),
    });
  }, [fetchJSON]);

  const getAuditLog = useCallback((): Promise<AuditResponse> => {
    return fetchJSON<AuditResponse>(`${API_BASE}/audit`);
  }, [fetchJSON]);

  const createPlan = useCallback((task: string): Promise<PlanResponse> => {
    return fetchJSON<PlanResponse>(`${API_BASE}/plans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task }),
    });
  }, [fetchJSON]);

  const getPlan = useCallback((id: string): Promise<Plan> => {
    return fetchJSON<Plan>(`${API_BASE}/plans/${id}`);
  }, [fetchJSON]);

  const approvePlan = useCallback((id: string): Promise<Plan> => {
    return fetchJSON<Plan>(`${API_BASE}/plans/${id}/approve`, {
      method: 'POST',
    });
  }, [fetchJSON]);

  const executeRemote = useCallback((task: string, options?: RemoteOptions): Promise<RemoteResponse> => {
    return fetchJSON<RemoteResponse>(`${API_BASE}/remote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task, ...options }),
    });
  }, [fetchJSON]);

  return {
    loading,
    error,
    getModes,
    resolveConfig,
    detectQuestion,
    getPermissions,
    grantPermission,
    revokePermission,
    getAuditLog,
    createPlan,
    getPlan,
    approvePlan,
    executeRemote,
  };
}
