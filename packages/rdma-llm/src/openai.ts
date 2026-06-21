/**
 * OpenAI provider — wraps the OpenAI Chat Completions API.
 *
 * Requires OPENAI_API_KEY in the environment.
 *
 * Usage:
 *   ```ts
 *   const provider = createOpenAiProvider({ apiKey: process.env.OPENAI_API_KEY! });
 *   ```
 */

import type { CompletionRequest, CompletionResult, LlmProvider } from './index.js';
import { LlmError } from './index.js';

export interface OpenAiConfig {
  apiKey: string;
  /** Default model id; defaults to gpt-4o. */
  defaultModel?: string;
  /** Fast model id; defaults to gpt-4o-mini. */
  fastModelId?: string;
  /** Base URL override (for OpenAI-compatible proxies like Ollama). */
  baseUrl?: string;
  /** Max retries on transient errors. Default 3. */
  maxRetries?: number;
  /** Provider-level temperature applied when the request omits one. */
  defaultTemperature?: number;
  /** Provider-level max_tokens applied when the request omits one. */
  defaultMaxTokens?: number;
}

const DEFAULT_MODEL = 'gpt-4o';
const DEFAULT_FAST = 'gpt-4o-mini';

interface OpenAiRequest {
  model: string;
  max_tokens: number;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  temperature?: number;
  stop?: string[];
}

interface OpenAiResponse {
  choices: Array<{
    message: { role: 'assistant'; content: string };
    finish_reason: 'stop' | 'length' | 'content_filter' | 'tool_calls' | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

export function createOpenAiProvider(config: OpenAiConfig): LlmProvider {
  const baseUrl = config.baseUrl ?? 'https://api.openai.com';
  const defaultModel = config.defaultModel ?? DEFAULT_MODEL;
  const fastModelId = config.fastModelId ?? DEFAULT_FAST;
  const maxRetries = config.maxRetries ?? 3;
  const defaultTemperature = config.defaultTemperature;
  const defaultMaxTokens = config.defaultMaxTokens;

  return {
    name: 'openai',
    defaultModel,
    fastModel: () => fastModelId,

    async complete(request: CompletionRequest): Promise<CompletionResult> {
      const temperature = request.temperature ?? defaultTemperature;
      const maxTokens = request.maxTokens ?? defaultMaxTokens ?? 4096;
      const body: OpenAiRequest = {
        model: request.model ?? defaultModel,
        max_tokens: maxTokens,
        messages: request.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        ...(temperature !== undefined ? { temperature } : {}),
        ...(request.stopSequences ? { stop: request.stopSequences } : {}),
      };

      let lastError: unknown = null;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const response = await fetch(`${baseUrl}/v1/chat/completions`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify(body),
          });

          if (!response.ok) {
            const errorBody = await response.text();
            const isRetryable = response.status === 429 || response.status >= 500;
            if (isRetryable && attempt < maxRetries) {
              lastError = new LlmError('openai', `HTTP ${response.status}: ${errorBody}`);
              await sleep(500 * 2 ** attempt);
              continue;
            }
            throw new LlmError('openai', `HTTP ${response.status}: ${errorBody}`);
          }

          const data = (await response.json()) as OpenAiResponse;
          const choice = data.choices[0];
          if (!choice) {
            throw new LlmError('openai', 'No choices in response');
          }

          return {
            text: choice.message.content,
            usage: {
              inputTokens: data.usage?.prompt_tokens ?? 0,
              outputTokens: data.usage?.completion_tokens ?? 0,
            },
            stopReason:
              choice.finish_reason === 'stop'
                ? 'end_turn'
                : choice.finish_reason === 'length'
                  ? 'max_tokens'
                  : choice.finish_reason === 'content_filter'
                    ? 'error'
                    : 'end_turn',
          };
        } catch (err) {
          if (err instanceof LlmError) throw err;
          lastError = err;
          if (attempt < maxRetries) {
            await sleep(500 * 2 ** attempt);
            continue;
          }
          throw new LlmError('openai', `Network error after ${maxRetries} retries`, err);
        }
      }

      throw new LlmError('openai', 'Exhausted retries', lastError);
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
