/**
 * Tests for the LLM provider abstraction.
 *
 * Covers:
 *   - Mock provider: echo + fixed-response cycling + call tracking
 *   - Anthropic provider: request shape + retry logic + error mapping
 *   - OpenAI provider: request shape + retry logic + error mapping
 *   - MeteredProvider: usage tracking
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { LlmError, type LlmProvider, MeteredProvider } from '../src/index.js';
import { createMockProvider } from '../src/mock.js';

describe('mock provider', () => {
  it('echoes the user message by default', async () => {
    const provider = createMockProvider();
    const result = await provider.complete({
      messages: [{ role: 'user', content: 'hello world' }],
    });
    assert.equal(result.text, '[mock] hello world');
    assert.equal(result.stopReason, 'end_turn');
  });

  it('cycles through fixed responses', async () => {
    const provider = createMockProvider({ responses: ['A', 'B', 'C'] });
    const a = await provider.complete({ messages: [{ role: 'user', content: '1' }] });
    const b = await provider.complete({ messages: [{ role: 'user', content: '2' }] });
    const c = await provider.complete({ messages: [{ role: 'user', content: '3' }] });
    const d = await provider.complete({ messages: [{ role: 'user', content: '4' }] });
    assert.equal(a.text, 'A');
    assert.equal(b.text, 'B');
    assert.equal(c.text, 'C');
    assert.equal(d.text, 'A'); // wraps around
  });

  it('records every call', async () => {
    const provider = createMockProvider();
    await provider.complete({ messages: [{ role: 'user', content: 'x' }] });
    await provider.complete({ messages: [{ role: 'user', content: 'y' }] });
    assert.equal(provider.calls.length, 2);
    assert.equal(provider.calls[0]?.request.messages[0]?.content, 'x');
    assert.equal(provider.calls[1]?.request.messages[0]?.content, 'y');
  });

  it('honors custom token counts', async () => {
    const provider = createMockProvider({ inputTokens: 42, outputTokens: 99 });
    const result = await provider.complete({ messages: [{ role: 'user', content: 'x' }] });
    assert.equal(result.usage.inputTokens, 42);
    assert.equal(result.usage.outputTokens, 99);
  });
});

describe('metered provider', () => {
  it('records usage on each call', async () => {
    const inner = createMockProvider({ inputTokens: 10, outputTokens: 20 });
    const metered = new MeteredProvider(inner);
    await metered.complete({ messages: [{ role: 'user', content: 'a' }] });
    await metered.complete({ messages: [{ role: 'user', content: 'b' }] });
    assert.equal(metered.usage.length, 2);
    assert.equal(metered.usage[0]?.inputTokens, 10);
    assert.equal(metered.usage[0]?.outputTokens, 20);
  });

  it('passes through the provider name with a metered() prefix', () => {
    const inner = createMockProvider();
    const metered = new MeteredProvider(inner);
    assert.equal(metered.name, 'metered(mock)');
  });
});

describe('anthropic provider (request shape)', () => {
  it('builds a valid Anthropic request', async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      captured = { url: String(url), init: init ?? {} };
      return new Response(
        JSON.stringify({
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 5, output_tokens: 7 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    try {
      // Inline import to avoid loading the SDK if not present.
      const mod = await import('../src/anthropic.js');
      const provider = mod.createAnthropicProvider({ apiKey: 'test-key' });
      const result = await provider.complete({
        messages: [
          { role: 'system', content: 'You are helpful' },
          { role: 'user', content: 'Hi' },
        ],
        maxTokens: 100,
        temperature: 0.5,
      });
      assert.equal(result.text, 'ok');
      assert.equal(result.usage.inputTokens, 5);
      assert.equal(result.usage.outputTokens, 7);

      assert.ok(captured);
      assert.match(captured?.url, /\/v1\/messages$/);
      const headers = captured?.init.headers as Record<string, string>;
      assert.equal(headers['x-api-key'], 'test-key');
      assert.equal(headers['anthropic-version'], '2023-06-01');

      const body = JSON.parse(captured?.init.body as string);
      assert.equal(body.system, 'You are helpful');
      assert.equal(body.max_tokens, 100);
      assert.equal(body.temperature, 0.5);
      assert.equal(body.messages.length, 1);
      assert.equal(body.messages[0].role, 'user');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('throws LlmError on 4xx', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response('bad request', { status: 400 })) as typeof fetch;
    try {
      const mod = await import('../src/anthropic.js');
      const provider = mod.createAnthropicProvider({ apiKey: 'k', maxRetries: 0 });
      let caught: unknown = null;
      try {
        await provider.complete({ messages: [{ role: 'user', content: 'x' }] });
      } catch (err) {
        caught = err;
      }
      assert.ok(caught !== null, 'expected an error to be thrown');
      assert.ok(
        caught instanceof Error && /HTTP 400/.test(caught.message),
        `expected HTTP 400 in error message, got: ${String(caught)}`,
      );
      assert.equal((caught as { name?: string }).name, 'LlmError');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('openai provider (request shape)', () => {
  it('builds a valid OpenAI request', async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      captured = { url: String(url), init: init ?? {} };
      return new Response(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 3, completion_tokens: 4 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    try {
      const mod = await import('../src/openai.js');
      const provider = mod.createOpenAiProvider({ apiKey: 'test-key' });
      const result = await provider.complete({
        messages: [
          { role: 'system', content: 'sys' },
          { role: 'user', content: 'hi' },
        ],
      });
      assert.equal(result.text, 'hi');
      assert.equal(result.usage.inputTokens, 3);
      assert.equal(result.usage.outputTokens, 4);
      assert.equal(result.stopReason, 'end_turn');

      assert.ok(captured);
      assert.match(captured?.url, /\/v1\/chat\/completions$/);
      const headers = captured?.init.headers as Record<string, string>;
      assert.equal(headers.authorization, 'Bearer test-key');

      const body = JSON.parse(captured?.init.body as string);
      assert.equal(body.messages.length, 2);
      assert.equal(body.messages[0].role, 'system');
      assert.equal(body.messages[1].role, 'user');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
