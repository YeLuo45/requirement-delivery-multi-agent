/**
 * E2E test: full pipeline driven by a deterministic mock LLM.
 *
 * Wires every agent with the mock LLM provider, creates a proposal, and
 * verifies the pipeline walks through every stage to `delivered`, producing
 * LLM-tagged artifacts at each step.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

import { AgentRegistry, AuditLog, Storage } from '@rdma/core';
import { Pipeline } from '@rdma/coordinator';
import { createResearchAgent } from '@rdma/research';
import { createCoordinatorAgent } from '@rdma/coordinator';
import { createDesignerAgent } from '@rdma/designer';
import { createPmAgent } from '@rdma/pm';
import { createDevAgent } from '@rdma/dev';
import { createQaAgent } from '@rdma/qa';
import { createBossAgent } from '@rdma/boss';
import { createMockProvider } from '@rdma/llm/mock';

function makeTmpRoot(): string {
  return path.join(tmpdir(), `rdma-e2e-llm-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

describe('e2e: full pipeline with mock LLM', () => {
  let root: string;
  let storage: Storage;
  let audit: AuditLog;
  let pipeline: Pipeline;
  let provider: ReturnType<typeof createMockProvider>;

  before(async () => {
    root = makeTmpRoot();
    storage = new Storage({ root });
    await storage.init();
    audit = new AuditLog(storage);
    provider = createMockProvider({
      responses: [
        // 1: PM PRD
        [
          '# PRD: JSON to CSV CLI',
          '',
          '## Problem',
          'Convert JSON arrays to CSV.',
          '',
          '## Goals',
          '- Single CLI command',
          '- Handles nested arrays',
          '',
          '## Non-goals',
          '- Streaming',
          '',
          '## User stories',
          '- As a user, I run the CLI with a JSON file and get CSV output.',
          '',
          '## Acceptance criteria',
          '1. Handles 100 rows in <1s',
          '2. Escapes commas correctly',
        ].join('\n'),
        // 2: PM plan
        [
          '# Implementation Plan: JSON to CSV CLI',
          '',
          '## Phases',
          '1. Setup',
          '2. TDD core',
          '3. CLI surface',
          '4. Docs',
          '',
          '## Exit criteria',
          '- Tests pass',
          '- README complete',
        ].join('\n'),
        // 3: Dev test plan
        '```ts\ndescribe("c", () => { it("a", () => {}); });\n```',
        // 4: Dev implementation
        '## Plan\nTwo files.\n\n## Code (sketch)\n```ts\nexport const c = 1;\n```',
        // 5: QA PASS
        [
          '## Result: PASS',
          '',
          '## Checks',
          '- [x] A',
          '- [x] B',
          '',
          '## Summary',
          'Ship.',
        ].join('\n'),
      ],
    });

    const reg = new AgentRegistry();
    reg.register(createResearchAgent());
    reg.register(createCoordinatorAgent());
    reg.register(createDesignerAgent());
    reg.register(createPmAgent({ model: provider }));
    reg.register(createDevAgent({ model: provider }));
    reg.register(createQaAgent({ model: provider }));
    reg.register(createBossAgent());
    pipeline = new Pipeline({ registry: reg, storage, audit });
  });

  after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('walks JSON-to-CSV requirement through all 7 agents using mock LLM', async () => {
    const proposal = await pipeline.createProposal({
      title: 'JSON to CSV CLI',
      rawRequirement: 'Build me a CLI that converts a JSON array of objects to CSV.',
      tags: { priority: 'P2' },
    });
    const final = await pipeline.runToCompletion(proposal);

    assert.equal(final.status, 'delivered');
    assert.equal(final.artifacts.length, 8);

    // The LLM-tagged artifacts come from PM, Dev, QA
    const llmArtifacts = final.artifacts.filter((a) => a.summary.includes('LLM'));
    assert.ok(llmArtifacts.length >= 4, `expected >=4 LLM-tagged artifacts, got ${llmArtifacts.length}`);

    // PRD was LLM-generated — verify it contains the mock's "Convert JSON arrays"
    const prd = final.artifacts.find((a) => a.kind === 'prd');
    assert.ok(prd);
    assert.match(prd.content, /Convert JSON arrays/);

    // Implementation was LLM-generated
    const impl = final.artifacts.find((a) => a.kind === 'implementation');
    assert.ok(impl);
    assert.match(impl.content, /LLM-generated/);

    // QA passed via LLM
    const report = final.artifacts.find((a) => a.kind === 'test_report');
    assert.ok(report);
    assert.match(report.content, /## Result: PASS/);

    // LLM was called at least 5 times: PRD, plan, test_plan, impl, qa-report
    assert.ok(provider.calls.length >= 5, `expected >=5 LLM calls, got ${provider.calls.length}`);

    // Handoff chain is clean
    const chain = await audit.handoffChain(final.id, final.projectId);
    assert.deepEqual(chain, [
      'market_research',
      'coordinator',
      'pm',
      'dev',
      'qa',
      'boss',
    ]);
  });
});

describe('e2e: pipeline with LLM QA fails then succeeds', () => {
  let root: string;
  let storage: Storage;
  let audit: AuditLog;

  before(async () => {
    root = makeTmpRoot();
    storage = new Storage({ root });
    await storage.init();
    audit = new AuditLog(storage);
  });

  after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('exercises the rework loop when QA verdict is FAIL on first call and PASS on second', async () => {
    // LLM responses driven by call count, not cycle. First QA call (call #5)
    // returns FAIL; the second QA call (call #8) returns PASS.
    let llmCallCount = 0;
    const provider = {
      name: 'count-driven',
      defaultModel: 'mock',
      fastModel: () => 'mock-fast',
      calls: [] as Array<{ request: { messages: Array<{ content: string }> } }>,
      async complete(req: { messages: Array<{ content: string }> }) {
        llmCallCount++;
        this.calls.push({ request: req });
        const isQA =
          req.messages.some((m) => m.content.includes('QA engineer')) ?? false;
        const verdict = isQA
          ? (llmCallCount === 5 ? 'FAIL' : 'PASS')
          : 'OK';
        const text = isQA
          ? `## Result: ${verdict}\n## Checks\n- [${verdict === 'PASS' ? 'x' : ' '}] edge\n## Summary\n${verdict === 'PASS' ? 'Ship.' : 'Fix.'}`
          : 'ok content';
        return {
          text,
          usage: { inputTokens: 10, outputTokens: 20 },
          stopReason: 'end_turn' as const,
        };
      },
    };

    const reg = new AgentRegistry();
    reg.register(createResearchAgent());
    reg.register(createCoordinatorAgent());
    reg.register(createDesignerAgent());
    reg.register(createPmAgent({ model: provider as never }));
    reg.register(createDevAgent({ model: provider as never }));
    reg.register(createQaAgent({ model: provider as never }));
    reg.register(createBossAgent());

    const pipeline = new Pipeline({ registry: reg, storage, audit });

    const initial = await pipeline.createProposal({
      title: 'Rework test',
      rawRequirement: 'test the rework loop with LLM QA',
    });

    const final = await pipeline.runToCompletion(initial);
    assert.equal(final.status, 'delivered');

    const reports = final.artifacts.filter((a) => a.kind === 'test_report');
    assert.ok(reports.length >= 2, `expected >=2 test reports, got ${reports.length}`);
    assert.ok(reports.some((r) => r.summary.includes('FAIL')));
    assert.ok(reports.some((r) => r.summary.includes('PASS')));
  });
});