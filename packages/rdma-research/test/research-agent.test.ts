/**
 * Research Agent tests — covers Canned + Web research providers.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AgentContext, Proposal } from '@rdma/core';
import { CannedResearchProvider, WebResearchProvider, createResearchAgent } from '../src/agent.js';

function makeProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: 'P-20260619-001',
    projectId: 'PRJ-20260619-001',
    title: 'JSON to CSV CLI',
    rawRequirement: 'Build me a CLI that converts a JSON array of objects to CSV.',
    status: 'research',
    owner: 'market_research',
    clarificationRound: 0,
    tags: {},
    artifacts: [],
    createdAt: '2026-06-19T00:00:00Z',
    updatedAt: '2026-06-19T00:00:00Z',
    ...overrides,
  };
}

function makeCtx(p: Proposal): AgentContext {
  return {
    proposal: p,
    storage: {} as AgentContext['storage'],
    audit: {
      record: async () => ({}) as never,
      list: async () => [],
      handoffChain: async () => [],
    } as AgentContext['audit'],
    now: () => new Date(),
  };
}

describe('Research agent: canned mode', () => {
  it('produces canned similar projects for JSON/CSV', async () => {
    const agent = createResearchAgent();
    const result = await agent.handle(makeCtx(makeProposal()));
    assert.equal(result.kind, 'handoff');
    if (result.kind !== 'handoff') return;
    assert.equal(result.to, 'coordinator');
    assert.ok(result.artifact);
    assert.match(result.artifact.content, /flatjson/);
    assert.match(result.artifact.content, /Risk register/);
    assert.equal(result.artifact.kind, 'requirement_brief');
  });

  it('handles generic requirements with topic search', async () => {
    const agent = createResearchAgent();
    const p = makeProposal({
      title: 'Custom thing',
      rawRequirement: 'A widget that does X',
    });
    const result = await agent.handle(makeCtx(makeCtx(p).proposal));
    if (result.kind !== 'handoff') return assert.fail('expected handoff');
    assert.match(result.artifact.content, /github topic search|Related/);
  });

  it('transitions from research_direction_pending to research', async () => {
    const agent = createResearchAgent();
    const p = makeProposal({ status: 'research_direction_pending' });
    const result = await agent.handle(makeCtx(p));
    assert.equal(result.kind, 'transition');
    if (result.kind !== 'transition') return;
    assert.equal(result.nextStage, 'research');
  });
});

describe('Research agent: web mode', () => {
  it('WebResearchProvider without API key falls back to GitHub search', async () => {
    let fetchedUrl: string | null = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request) => {
      fetchedUrl = String(url);
      return new Response(
        JSON.stringify({
          items: [
            {
              html_url: 'https://github.com/foo/bar',
              full_name: 'foo/bar',
              description: 'A sample repo',
            },
            {
              html_url: 'https://github.com/baz/qux',
              full_name: 'baz/qux',
              description: 'Another repo',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    try {
      const provider = new WebResearchProvider();
      const results = await provider.searchSimilarProjects('json csv');
      assert.equal(results.length, 2);
      assert.equal(results[0]?.name, 'foo/bar');
      assert.match(fetchedUrl ?? '', /api\.github\.com\/search\/repositories/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('WebResearchProvider with API key uses Tavily', async () => {
    let fetchedUrl: string | null = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request) => {
      fetchedUrl = String(url);
      return new Response(
        JSON.stringify({
          results: [
            {
              url: 'https://github.com/test/repo',
              title: 'test/repo',
              content: 'A great repository that does things',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    try {
      const provider = new WebResearchProvider({ apiKey: 'tavily-test-key' });
      const results = await provider.searchSimilarProjects('web search');
      assert.equal(results.length, 1);
      assert.equal(results[0]?.url, 'https://github.com/test/repo');
      assert.match(fetchedUrl ?? '', /api\.tavily\.com/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('falls back to GitHub when Tavily errors', async () => {
    let callCount = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      callCount++;
      if (callCount === 1) {
        return new Response('bad', { status: 500 });
      }
      return new Response(
        JSON.stringify({
          items: [
            {
              html_url: 'https://github.com/fallback/repo',
              full_name: 'fallback/repo',
              description: 'fallback',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    try {
      const provider = new WebResearchProvider({ apiKey: 'broken-key' });
      const results = await provider.searchSimilarProjects('test');
      assert.equal(results.length, 1);
      assert.equal(results[0]?.name, 'fallback/repo');
      assert.equal(callCount, 2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('integration: research agent with web provider marks summary as "from web"', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          items: [{ html_url: 'https://github.com/a/b', full_name: 'a/b', description: 'd' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as typeof fetch;

    try {
      const provider = new WebResearchProvider();
      const agent = createResearchAgent(provider);
      const result = await agent.handle(makeCtx(makeProposal()));
      if (result.kind !== 'handoff') return assert.fail('expected handoff');
      assert.match(result.artifact.summary, /from web/);
      assert.match(result.artifact.content, /a\/b/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('CannedResearchProvider', () => {
  it('returns CLI repos for CLI queries', async () => {
    const p = new CannedResearchProvider();
    const r = await p.searchSimilarProjects('a CLI tool');
    assert.ok(r.some((x) => x.name === 'commander.js'));
  });
});
