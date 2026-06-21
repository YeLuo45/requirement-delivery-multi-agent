/**
 * Mock LLM provider — returns canned responses for tests.
 *
 * Two modes:
 *   1. Fixed responses (provide a `responses` array; cycles through them).
 *   2. Echo mode (default — returns the user message prefixed with a marker).
 *
 * Usage:
 *   ```ts
 *   import { createMockProvider } from '@rdma/llm/mock';
 *
 *   const provider = createMockProvider({
 *     responses: ['PRD content here', 'Plan content here'],
 *   });
 *   ```
 */

import type { CompletionRequest, CompletionResult, LlmProvider } from './index.js';

export interface MockConfig {
  /** Fixed responses to cycle through. Default: echo mode. */
  responses?: string[];
  /** Echo mode prefix; default: '[mock]'. */
  echoPrefix?: string;
  /** Simulated input tokens (per request). Default: 100. */
  inputTokens?: number;
  /** Simulated output tokens (per request). Default: 200. */
  outputTokens?: number;
}

export function createMockProvider(config: MockConfig = {}): LlmProvider & {
  /** All complete() calls (in order) — useful for assertions in tests. */
  readonly calls: Array<{ request: CompletionRequest; at: string }>;
} {
  const responses = config.responses;
  const echoPrefix = config.echoPrefix ?? '[mock]';
  const inputTokens = config.inputTokens ?? 100;
  const outputTokens = config.outputTokens ?? 200;
  const calls: Array<{ request: CompletionRequest; at: string }> = [];
  let index = 0;

  const provider: LlmProvider & {
    readonly calls: Array<{ request: CompletionRequest; at: string }>;
  } = {
    name: 'mock',
    defaultModel: 'mock-model',
    fastModel: () => 'mock-fast',
    calls,
    async complete(request: CompletionRequest): Promise<CompletionResult> {
      calls.push({ request, at: new Date().toISOString() });

      const text =
        responses !== undefined
          ? (responses[index++ % responses.length] ?? '')
          : `${echoPrefix} ${request.messages[request.messages.length - 1]?.content ?? ''}`;

      return {
        text,
        usage: { inputTokens, outputTokens },
        stopReason: 'end_turn',
      };
    },
  };
  return provider;
}
