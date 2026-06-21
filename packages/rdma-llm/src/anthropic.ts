/**
 * Anthropic provider — wraps the Anthropic Messages API.
 *
 * Requires ANTHROPIC_API_KEY in the environment.
 * Install @anthropic-ai/sdk as a peer dependency at the call site.
 *
 * Usage:
 *   ```ts
 *   const provider = createAnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! });
 *   const result = await provider.complete({ messages: [...] });
 *   ```
 */

import type { CompletionRequest, CompletionResult, LlmProvider } from './index.js';
import { LlmError } from './index.js';

export interface AnthropicConfig {
  apiKey: string;
  /** Default model id; defaults to claude-3-5-sonnet-latest. */
  defaultModel?: string;
  /** Fast model id for short-form tasks; defaults to claude-3-5-haiku-latest. */
  fastModelId?: string;
  /** Base URL override (for Anthropic-compatible proxies). */
  baseUrl?: string;
  /** Max retries on transient errors. Default 3. */
  maxRetries?: number;
}

const DEFAULT_MODEL = 'claude-3-5-sonnet-latest';
const DEFAULT_FAST = 'claude-3-5-haiku-latest';

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AnthropicRequest {
  model: string;
  max_tokens: number;
  messages: AnthropicMessage[];
  system?: string;
  temperature?: number;
  stop_sequences?: string[];
}

interface AnthropicResponse {
  content: Array<{ type: 'text'; text: string }>;
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use';
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export function createAnthropicProvider(config: AnthropicConfig): LlmProvider {
  const baseUrl = config.baseUrl ?? 'https://api.anthropic.com';
  const defaultModel = config.defaultModel ?? DEFAULT_MODEL;
  const fastModelId = config.fastModelId ?? DEFAULT_FAST;
  const maxRetries = config.maxRetries ?? 3;

  return {
    name: 'anthropic',
    defaultModel,
    fastModel: () => fastModelId,

    async complete(request: CompletionRequest): Promise<CompletionResult> {
      const systemMessages = request.messages.filter((m) => m.role === 'system');
      const conversationMessages = request.messages.filter((m) => m.role !== 'system');

      if (systemMessages.length > 1) {
        throw new LlmError(
          'anthropic',
          'Multiple system messages are not supported by the Anthropic API',
        );
      }

      const body: AnthropicRequest = {
        model: request.model ?? defaultModel,
        max_tokens: request.maxTokens ?? 4096,
        messages: conversationMessages.map((m) => ({
          role: m.role === 'user' ? 'user' : 'assistant',
          content: m.content,
        })),
        ...(systemMessages[0] ? { system: systemMessages[0].content } : {}),
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        ...(request.stopSequences ? { stop_sequences: request.stopSequences } : {}),
      };

      let lastError: unknown = null;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const response = await fetch(`${baseUrl}/v1/messages`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-api-key': config.apiKey,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify(body),
          });

          if (!response.ok) {
            const errorBody = await response.text();
            const isRetryable = response.status === 429 || response.status >= 500;
            if (isRetryable && attempt < maxRetries) {
              lastError = new LlmError('anthropic', `HTTP ${response.status}: ${errorBody}`);
              // Exponential backoff: 500ms, 1s, 2s
              await sleep(500 * 2 ** attempt);
              continue;
            }
            throw new LlmError('anthropic', `HTTP ${response.status}: ${errorBody}`);
          }

          const data = (await response.json()) as AnthropicResponse;
          const text = data.content
            .filter((block) => block.type === 'text')
            .map((block) => block.text)
            .join('');

          return {
            text,
            usage: {
              inputTokens: data.usage.input_tokens,
              outputTokens: data.usage.output_tokens,
            },
            stopReason: data.stop_reason,
          };
        } catch (err) {
          if (err instanceof LlmError) throw err;
          lastError = err;
          if (attempt < maxRetries) {
            await sleep(500 * 2 ** attempt);
            continue;
          }
          throw new LlmError('anthropic', `Network error after ${maxRetries} retries`, err);
        }
      }

      throw new LlmError('anthropic', 'Exhausted retries', lastError);
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
