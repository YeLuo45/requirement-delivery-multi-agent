import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildAgentConfigWorkbench,
  renderAgentConfigRows,
  requiredAgentIds,
} from '../src/operator-console.js';

describe('agent config workbench model', () => {
  it('summarizes all seven agents with coverage, mock risk, and next actions', () => {
    const workbench = buildAgentConfigWorkbench({
      configs: {
        pm: {
          source: 'agents.yaml',
          llm: { provider: 'openai', model: 'gpt-5.4-mini' },
          prompts: { soul: 'pm soul', user: null, memory: 'pm memory' },
        },
        dev: {
          source: 'agents.yaml',
          llm: { provider: 'anthropic', model: 'claude-sonnet-4' },
          prompts: { soul: 'dev soul', user: 'dev user', memory: null },
        },
      },
    });

    assert.deepEqual(requiredAgentIds, [
      'research',
      'coordinator',
      'designer',
      'pm',
      'dev',
      'qa',
      'boss',
    ]);
    assert.equal(workbench.summary.totalAgents, 7);
    assert.equal(workbench.summary.configuredAgents, 2);
    assert.equal(workbench.summary.mockAgents, 5);
    assert.equal(workbench.summary.promptEnabledAgents, 2);
    assert.equal(workbench.summary.coverageLabel, '2/7 configured');
    assert.equal(workbench.summary.riskLevel, 'high');
    assert.equal(workbench.agents[0]?.agentId, 'research');
    assert.equal(workbench.agents.find((agent) => agent.agentId === 'pm')?.status, 'configured');
    assert.equal(workbench.agents.find((agent) => agent.agentId === 'qa')?.status, 'mock');
    assert.ok(workbench.actions.some((action) => action.kind === 'copy-template'));
    assert.ok(workbench.actions.some((action) => action.kind === 'validate-config'));
  });

  it('marks full provider and prompt coverage as ready', () => {
    const configs = Object.fromEntries(
      requiredAgentIds.map((agentId) => [
        agentId,
        {
          source: 'agents.yaml',
          llm: { provider: 'openai', model: `${agentId}-model` },
          prompts: {
            soul: `${agentId} soul`,
            user: `${agentId} user`,
            memory: `${agentId} memory`,
          },
        },
      ]),
    );

    const workbench = buildAgentConfigWorkbench({ configs });

    assert.equal(workbench.summary.riskLevel, 'ready');
    assert.equal(workbench.summary.coverageLabel, '7/7 configured');
    assert.equal(workbench.summary.mockAgents, 0);
    assert.ok(workbench.actions.some((action) => action.kind === 'run-smoke'));
    assert.equal(workbench.template.agentCount, 7);
    assert.match(workbench.template.yamlPreview, /research:/);
    assert.match(workbench.template.yamlPreview, /provider: openai/);
  });

  it('keeps legacy config rows sorted and compatible with the workbench source', () => {
    const rows = renderAgentConfigRows({
      boss: {
        source: 'agents.yaml',
        llm: null,
        prompts: { soul: null, user: null, memory: null },
      },
      research: {
        source: 'agents.yaml',
        llm: { provider: 'openai', model: 'search-fast' },
        prompts: { soul: 'research soul', user: null, memory: null },
      },
    });

    assert.deepEqual(
      rows.map((row) => row.agentId),
      ['boss', 'research'],
    );
    assert.equal(rows[0]?.llm, 'mock');
    assert.equal(rows[1]?.prompts, 'prompts=on');
  });
});
