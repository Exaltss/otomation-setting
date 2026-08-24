/**
 * Provider adapters — strategy pattern untuk eksekusi LLM.
 * Execution engine hanya bicara pada kontrak ProviderAdapter,
 * sehingga detail HTTP masing-masing API terisolasi di sini.
 */
import { err, ok, type Result } from '../../core/result';
import type { ProviderId } from '../../domain/automation';

export interface ExecutionRequest {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  apiKey: string;
}

export interface ExecutionResponse {
  provider: ProviderId;
  model: string;
  output: string;
}

export interface ProviderAdapter {
  provider: ProviderId;
  execute(request: ExecutionRequest): Promise<Result<ExecutionResponse, Error>>;
}

/** Adapter mock untuk tier cheap — zero cost, untuk testing & demo. */
const localAdapter: ProviderAdapter = {
  provider: 'local',
  async execute(request) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    return ok({
      provider: 'local',
      model: request.model,
      output: `[local mock] Echo: ${request.userPrompt.slice(0, 140)}`,
    });
  },
};

/** Parse error HTTP secara aman (body error API atau fallback status). */
async function readApiError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message ?? `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

const openaiAdapter: ProviderAdapter = {
  provider: 'openai',
  async execute(request) {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${request.apiKey}`,
        },
        body: JSON.stringify({
          model: request.model,
          messages: [
            { role: 'system', content: request.systemPrompt },
            { role: 'user', content: request.userPrompt },
          ],
          max_tokens: 512,
        }),
      });

      if (!response.ok) {
        return err(new Error(`OpenAI API: ${await readApiError(response)}`));
      }

      const data = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const output = data.choices?.[0]?.message?.content ?? '';
      return ok({ provider: 'openai', model: request.model, output });
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Network error (OpenAI).'));
    }
  },
};

const anthropicAdapter: ProviderAdapter = {
  provider: 'anthropic',
  async execute(request) {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': request.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: request.model,
          max_tokens: 512,
          system: request.systemPrompt,
          messages: [{ role: 'user', content: request.userPrompt }],
        }),
      });

      if (!response.ok) {
        return err(new Error(`Anthropic API: ${await readApiError(response)}`));
      }

      const data = (await response.json()) as {
        content?: { type: string; text?: string }[];
      };
      const output =
        data.content
          ?.filter((block) => block.type === 'text')
          .map((block) => block.text ?? '')
          .join('') ?? '';
      return ok({ provider: 'anthropic', model: request.model, output });
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Network error (Anthropic).'));
    }
  },
};

const adapters = new Map<ProviderId, ProviderAdapter>([
  [localAdapter.provider, localAdapter],
  [openaiAdapter.provider, openaiAdapter],
  [anthropicAdapter.provider, anthropicAdapter],
]);

export function getAdapter(provider: ProviderId): Result<ProviderAdapter, Error> {
  const adapter = adapters.get(provider);
  if (!adapter) {
    return err(new Error(`No adapter implemented for provider "${provider}".`));
  }
  return ok(adapter);
}