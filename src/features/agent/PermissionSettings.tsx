import React, { useState, useEffect, useCallback } from 'react';
import { useAgentAPI } from './hooks/useAgentAPI';
import type { PermissionsState } from './hooks/useAgentAPI';

const PERMISSION_TYPES = [
  'read_outside',
  'write_outside',
  'delete_any',
  'exec',
  'network_send',
  'browser',
] as const;

export const PermissionSettings: React.FC = () => {
  const [permissions, setPermissions] = useState<PermissionsState | null>(null);
  const [loading, setLoading] = useState(false);

  const api = useAgentAPI();

  const loadPermissions = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.getPermissions();
      setPermissions(result);
    } catch (err) {
      console.error('Failed to load permissions:', err);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Initial fetch pattern
    loadPermissions();
  }, [loadPermissions]);

  const handleGrant = async (type: string, scope: 'session' | 'persistent') => {
    await api.grantPermission(type, scope);
    loadPermissions();
  };

  const handleRevoke = async (type: string) => {
    await api.revokePermission(type);
    loadPermissions();
  };

  if (loading || !permissions) {
    return <div className="permission-settings">Loading...</div>;
  }

  return (
    <div className="permission-settings">
      <h3>Permission Settings</h3>

      <table className="permission-table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Session</th>
            <th>Persistent</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {PERMISSION_TYPES.map((type) => {
            const hasSession = permissions.session.includes(type);
            const hasPersistent = permissions.persistent[type] === 'persistent';

            return (
              <tr key={type}>
                <td>{type}</td>
                <td>{hasSession ? 'Yes' : 'No'}</td>
                <td>{hasPersistent ? 'Yes' : 'No'}</td>
                <td>
                  {!hasSession && !hasPersistent && (
                    <>
                      <button onClick={() => handleGrant(type, 'session')}>
                        Grant Session
                      </button>
                      <button onClick={() => handleGrant(type, 'persistent')}>
                        Grant Persistent
                      </button>
                    </>
                  )}
                  {(hasSession || hasPersistent) && (
                    <button onClick={() => handleRevoke(type)}>Revoke</button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
