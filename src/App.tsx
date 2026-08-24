import { useMemo, type ChangeEvent } from 'react';
import { foldResult } from './core/result';
import { useAppStore } from './features/workflow/store';
import { Canvas } from './features/workflow/Canvas';
import { CredentialPanel } from './features/credentials/CredentialPanel';
import { routeByNineRouter, type RouterPolicy } from './features/router/nineRouter';
import { compressContext } from './features/context/compressedContext';
import type { ContextMessage } from './domain/automation';

function toPositiveNumber(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

export default function App() {
  const { routerPolicy, sampleInput, setRouterPolicy, setSampleInput } = useAppStore();

  const route = useMemo(
    () => routeByNineRouter(sampleInput, routerPolicy),
    [sampleInput, routerPolicy],
  );

  const compressed = useMemo(() => {
    const messages: ContextMessage[] = [{ role: 'user', content: sampleInput }];
    return compressContext(messages, routerPolicy.premiumMaxTokens);
  }, [sampleInput, routerPolicy.premiumMaxTokens]);

  const updatePolicy = (key: keyof RouterPolicy, rawValue: string) => {
    const value = toPositiveNumber(rawValue);
    if (value === null) {
      return;
    }
    setRouterPolicy({ [key]: value } as Partial<RouterPolicy>);
  };

  const handleInputChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setSampleInput(event.target.value);
  };

  const handlePolicyChange =
    (key: keyof RouterPolicy) => (event: ChangeEvent<HTMLInputElement>) => {
      updatePolicy(key, event.target.value);
    };

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '20px' }}>
      <h1>Otomation Setting — Test Panel</h1>
      <p>9Router + Compressed Context engine testing</p>

      <section style={{ marginBottom: '20px' }}>
        <h2>Sample Input</h2>
        <textarea
          style={{ width: '100%', minHeight: '100px', padding: '8px' }}
          value={sampleInput}
          onChange={handleInputChange}
        />
      </section>

      <section style={{ marginBottom: '20px' }}>
        <h2>9Router Decision</h2>
        {foldResult(
          route,
          (decision) => (
            <div>
              <p><strong>Tier:</strong> {decision.tier}</p>
              <p><strong>Provider:</strong> {decision.provider}</p>
              <p><strong>Model:</strong> {decision.model}</p>
              <p><strong>Estimated tokens:</strong> {decision.estimatedTokens}</p>
              <p><strong>Reason:</strong> {decision.reason}</p>
            </div>
          ),
          (error) => <p style={{ color: 'red' }}>{error.message}</p>,
        )}
      </section>

      <section style={{ marginBottom: '20px' }}>
        <h2>Compressed Context</h2>
        {foldResult(
          compressed,
          (ctx) => (
            <div>
              <p><strong>Estimated tokens:</strong> {ctx.estimatedTokens}</p>
              <p><strong>Dropped messages:</strong> {ctx.droppedMessages}</p>
              {ctx.summary !== '' && <p><strong>Summary:</strong> {ctx.summary}</p>}
            </div>
          ),
          (error) => <p style={{ color: 'red' }}>{error.message}</p>,
        )}
      </section>

      <section style={{ marginBottom: '20px' }}>
        <h2>Router Policy</h2>
        <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
          <label>
            Cheap max tokens:
            <input
              type="number"
              value={routerPolicy.cheapMaxTokens}
              onChange={handlePolicyChange('cheapMaxTokens')}
              style={{ marginLeft: '5px', width: '100px' }}
            />
          </label>
        </div>
        <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
          <label>
            Standard max tokens:
            <input
              type="number"
              value={routerPolicy.standardMaxTokens}
              onChange={handlePolicyChange('standardMaxTokens')}
              style={{ marginLeft: '5px', width: '100px' }}
            />
          </label>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <label>
            Premium max tokens:
            <input
              type="number"
              value={routerPolicy.premiumMaxTokens}
              onChange={handlePolicyChange('premiumMaxTokens')}
              style={{ marginLeft: '5px', width: '100px' }}
            />
          </label>
        </div>
      </section>

      <section style={{ marginBottom: '20px' }}>
        <h2>Workflow Canvas</h2>
        <Canvas />
      </section>

      <section>
        <h2>API Key Management</h2>
        <CredentialPanel />
      </section>
    </div>
  );
}