import React, { useState } from 'react';
import { useAgentAPI } from './hooks/useAgentAPI';
import type { Plan } from './hooks/useAgentAPI';

interface PlanningUIProps {
  task: string;
}

export const PlanningUI: React.FC<PlanningUIProps> = ({ task }) => {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const api = useAgentAPI();

  const handleCreatePlan = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.createPlan(task);
      setPlan(result.plan);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async () => {
    if (!plan) return;
    setLoading(true);
    try {
      const approved = await api.approvePlan(plan.id);
      setPlan(approved);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  if (!plan) {
    return (
      <div className="planning-ui">
        <button onClick={handleCreatePlan} disabled={loading}>
          {loading ? 'Generating Plan...' : 'Generate Plan'}
        </button>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  const currentVersion = plan.versions[plan.versions.length - 1];
  const nodeCount = currentVersion.workflow?.nodes?.length ?? 0;

  return (
    <div className="planning-ui">
      <h3>Plan Preview</h3>

      <div className="plan-section">
        <h4>Workflow ({nodeCount} nodes)</h4>
        <pre className="plan-code">
          {JSON.stringify(currentVersion.workflow, null, 2)}
        </pre>
      </div>

      <div className="plan-section">
        <h4>Claims ({currentVersion.claims.length})</h4>
        <ul>
          {currentVersion.claims.map((claim, idx) => (
            <li key={idx}>
              <strong>{claim.name}:</strong> {claim.description}
            </li>
          ))}
        </ul>
      </div>

      <div className="plan-section">
        <h4>Questions ({currentVersion.questions.length})</h4>
        <ul>
          {currentVersion.questions.map((q, idx) => (
            <li key={idx}>{q}</li>
          ))}
        </ul>
      </div>

      <div className="plan-actions">
        {plan.status === 'pending' && (
          <button onClick={handleApprove} disabled={loading}>
            {loading ? 'Approving...' : 'Approve Plan'}
          </button>
        )}
        {plan.status === 'approved' && (
          <p className="success">Plan approved (version {plan.approvedVersion})</p>
        )}
      </div>

      {error && <p className="error">{error}</p>}
    </div>
  );
};
