import React, { useState, useEffect, useCallback } from 'react';
import { useAgentAPI } from './hooks/useAgentAPI';
import type { AuditEntry } from './hooks/useAgentAPI';

export const AutoRemoteUI: React.FC = () => {
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const api = useAgentAPI();

  const loadAuditLog = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.getAuditLog();
      setAuditLog(result.audit || []);
    } catch (err) {
      console.error('Failed to load audit log:', err);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Initial fetch pattern
    loadAuditLog();
  }, [loadAuditLog]);

  return (
    <div className="auto-remote-ui">
      <div className="audit-header">
        <h3>Audit Log</h3>
        <button onClick={loadAuditLog} disabled={loading}>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      <div className="audit-entries">
        {auditLog.length === 0 ? (
          <p className="empty">No audit entries yet.</p>
        ) : (
          <ul>
            {auditLog.map((entry, idx) => (
              <li key={idx} className={`audit-entry audit-${entry.type}`}>
                <div className="entry-header">
                  <span className="entry-type">{entry.type}</span>
                  <span className="entry-time">{new Date(entry.at).toLocaleString()}</span>
                </div>
                <div className="entry-details">
                  {entry.action && <span>Action: {entry.action}</span>}
                  {entry.specialist && <span>Specialist: {entry.specialist}</span>}
                  {entry.step && <span>Step: {entry.step}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
