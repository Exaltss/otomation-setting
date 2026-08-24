/**
 * Alat — lab engine: semua panel pengujian dari fase sebelumnya.
 */
import { useMemo, type ChangeEvent } from 'react';
import { foldResult } from '../../core/result';
import { useAppStore } from '../workflow/store';
import { Canvas } from '../workflow/Canvas';
import { ExecutionPanel } from '../execution/ExecutionPanel';
import { routeByNineRouter, type RouterPolicy } from '../router/nineRouter';
import { compressContext } from '../context/compressedContext';
import type { ContextMessage } from '../../domain/automation';

function toPositiveNumber(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

export function AlatView() {
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
    <div>
      <h2>Alat — Engine Lab</h2>

      <section style={{ marginBottom: '20px' }}>
        <h3>Sample Input</h3>
        <textarea
          style={{ width: '100%', minHeight: '100px', padding: '8px' }}
          value={sampleInput}
          onChange={handleInputChange}
        />
      </section>

      <section style={{ marginBottom: '20px' }}>
        <h3>9Router Decision</h3>
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
        <h3>Compressed Context</h3>
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
        <h3>Router Policy</h3>
        <label>
          Cheap max tokens:
          <input
            type="number"
            value={routerPolicy.cheapMaxTokens}
            onChange={handlePolicyChange('cheapMaxTokens')}
            style={{ marginLeft: '5px', width: '100px' }}
          />
        </label>{' '}
        <label>
          Standard max tokens:
          <input
            type="number"
            value={routerPolicy.standardMaxTokens}
            onChange={handlePolicyChange('standardMaxTokens')}
            style={{ marginLeft: '5px', width: '100px' }}
          />
        </label>{' '}
        <label>
          Premium max tokens:
          <input
            type="number"
            value={routerPolicy.premiumMaxTokens}
            onChange={handlePolicyChange('premiumMaxTokens')}
            style={{ marginLeft: '5px', width: '100px' }}
          />
        </label>
      </section>

      <section style={{ marginBottom: '20px' }}>
        <h3>Workflow Canvas</h3>
        <Canvas />
      </section>

      <section>
        <h3>Execution</h3>
        <ExecutionPanel />
      </section>
    </div>
  );
}