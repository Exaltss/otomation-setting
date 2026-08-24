/**
 * Provider adapters — strategy pattern untuk eksekusi LLM.
 * Execution engine hanya bicara pada kontrak ProviderAdapter.
 *
 * NVIDIA NIM (integrate.api.nvidia.com) OpenAI-compatible,
 * sehingga openai & nvidia berbagi satu implementasi factory (DRY).
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

/** Base URL API yang OpenAI-compatible. Single source of truth. */
const OPENAI_COMPATIBLE_BASE_URLS: Partial<Record<ProviderId, string>> = {
  openai: 'https://api.openai.com/v1',
  nvidia: 'https://integrate.api.nvidia.com/v1',
};

export function getOpenAiCompatibleBaseUrl(provider: ProviderId): string | null {
  return OPENAI_COMPATIBLE_BASE_URLS[provider] ?? null;
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

/**
 * Factory untuk API yang OpenAI-compatible (OpenAI, NVIDIA NIM, Groq, dll).
 * Menambah provider compatible = satu entri di map base URL.
 */
function createOpenAiCompatibleAdapter(
  provider: ProviderId,
  baseUrl: string,
): ProviderAdapter {
  return {
    provider,
    async execute(request) {
      try {
        const response = await fetch(`${baseUrl}/chat/completions`, {
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
          return err(new Error(`${provider} API: ${await readApiError(response)}`));
        }

        const data = (await response.json()) as {
          choices?: { message?: { content?: string } }[];
        };
        const output = data.choices?.[0]?.message?.content ?? '';
        return ok({ provider, model: request.model, output });
      } catch (error) {
        return err(
          error instanceof Error ? error : new Error(`Network error (${provider}).`),
        );
      }
    },
  };
}

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
  [anthropicAdapter.provider, anthropicAdapter],
]);

for (const provider of Object.keys(OPENAI_COMPATIBLE_BASE_URLS) as ProviderId[]) {
  const baseUrl = OPENAI_COMPATIBLE_BASE_URLS[provider];
  if (baseUrl) {
    const adapter = createOpenAiCompatibleAdapter(provider, baseUrl);
    adapters.set(adapter.provider, adapter);
  }
}

export function getAdapter(provider: ProviderId): Result<ProviderAdapter, Error> {
  const adapter = adapters.get(provider);
  if (!adapter) {
    return err(new Error(`No adapter implemented for provider "${provider}".`));
  }
  return ok(adapter);
}