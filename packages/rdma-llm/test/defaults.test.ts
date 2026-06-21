/**
 * Tests that LLM provider `defaultTemperature` / `defaultMaxTokens` flow
 * through the request body. We don't actually call the network in
 * tests — we check the request payload via a stubbed `fetch`.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { createAnthropicProvider } from '../src/anthropic.js';
import { createOpenAiProvider } from '../src/openai.js';

interface CapturedCall {
  url: string;
  init: { method?: string; headers?: Record<string, string>; body?: string };
}

let captured: CapturedCall[] = [];
let originalFetch: typeof fetch | undefined;

beforeEach(() => {
  captured = [];
  originalFetch = globalThis.fetch;
  // Log the first failure for debugging — the 'Network error after 3 retries'
  // message is what surfaces when an assertion inside the retry loop throws.
  const stubErrors: unknown[] = [];
  const instrumented: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;
      captured.push({ url, init: init as CapturedCall['init'] });
      return {
        ok: true,
        status: 200,
        json: async () => {
          const urlStr = typeof input === 'string' ? input : '';
          if (urlStr.includes('/chat/completions')) {
            return {
              choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
              usage: { prompt_tokens: 1, completion_tokens: 1 },
            };
          }
          return {
            content: [{ type: 'text', text: 'ok' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 1, output_tokens: 1 },
          };
        },
        text: async () => 'ok',
      } as unknown as Response;
    } catch (err) {
      stubErrors.push(err);
      throw err;
    }
  }) as typeof fetch;
  // @ts-expect-error — instrumentation hook for debug
  (globalThis as { __stubErrors: unknown[] }).__stubErrors = stubErrors;
  // @ts-expect-error — stubbing the global fetch with a typed cast.
  globalThis.fetch = instrumented;
});

afterEach(() => {
  if (originalFetch) globalThis.fetch = originalFetch;
});

describe('Anthropic provider — defaultTemperature + defaultMaxTokens', () => {
  it('applies provider-level defaults when the request omits them', async () => {
    const provider = createAnthropicProvider({
      apiKey: 'k',
      defaultTemperature: 0.42,
      defaultMaxTokens: 2048,
    });
    await provider.complete({ messages: [{ role: 'user', content: 'hi' }] });
    const body = JSON.parse(captured[0]?.init.body ?? '{}');
    assert.equal(body.temperature, 0.42);
    assert.equal(body.max_tokens, 2048);
  });

  it('request-level overrides win over provider defaults', async () => {
    const provider = createAnthropicProvider({
      apiKey: 'k',
      defaultTemperature: 0.42,
      defaultMaxTokens: 2048,
    });
    await provider.complete({
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.9,
      maxTokens: 512,
    });
    const body = JSON.parse(captured[0]?.init.body ?? '{}');
    assert.equal(body.temperature, 0.9);
    assert.equal(body.max_tokens, 512);
  });

  it('omits temperature when neither default nor request specify one', async () => {
    const provider = createAnthropicProvider({ apiKey: 'k' });
    await provider.complete({ messages: [{ role: 'user', content: 'hi' }] });
    const body = JSON.parse(captured[0]?.init.body ?? '{}');
    assert.equal('temperature' in body, false);
  });
});

describe('OpenAI provider — defaultTemperature + defaultMaxTokens', () => {
  it('applies provider-level defaults when the request omits them', async () => {
    const provider = createOpenAiProvider({
      apiKey: 'k',
      defaultTemperature: 0.3,
      defaultMaxTokens: 1024,
    });
    await provider.complete({ messages: [{ role: 'user', content: 'hi' }] });
    const body = JSON.parse(captured[0]?.init.body ?? '{}');
    assert.equal(body.temperature, 0.3);
    assert.equal(body.max_tokens, 1024);
  });

  it('request-level overrides win over provider defaults', async () => {
    const provider = createOpenAiProvider({
      apiKey: 'k',
      defaultTemperature: 0.3,
      defaultMaxTokens: 1024,
    });
    await provider.complete({
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.7,
      maxTokens: 256,
    });
    const body = JSON.parse(captured[0]?.init.body ?? '{}');
    assert.equal(body.temperature, 0.7);
    assert.equal(body.max_tokens, 256);
  });

  it('uses provider defaultModel when request.model is absent', async () => {
    const provider = createOpenAiProvider({ apiKey: 'k', defaultModel: 'gpt-5.4-mini' });
    await provider.complete({ messages: [{ role: 'user', content: 'hi' }] });
    const body = JSON.parse(captured[0]?.init.body ?? '{}');
    assert.equal(body.model, 'gpt-5.4-mini');
  });
});
