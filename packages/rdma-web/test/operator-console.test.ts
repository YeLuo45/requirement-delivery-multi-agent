import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { appNavItems, appRoutes } from '../src/App.js';
import {
  buildOperatorConsoleModel,
  renderAgentConfigRows,
  tuiParityCapabilities,
} from '../src/operator-console.js';

describe('web operator console TUI parity', () => {
  it('maps every TUI command to a Web route or API surface', () => {
    assert.deepEqual(
      tuiParityCapabilities.map((capability) => capability.tuiCommand),
      ['list', 'show <id>', 'config', 'new', 'control-plane'],
    );
    assert.ok(tuiParityCapabilities.every((capability) => capability.status === 'available'));
    assert.ok(
      tuiParityCapabilities.some((capability) => capability.webSurface.includes('/operator')),
    );
    assert.ok(
      tuiParityCapabilities.some((capability) => capability.webSurface.includes('/api/config')),
    );
  });

  it('exposes the operator console in navigation and routes', () => {
    assert.ok(appNavItems.some((item) => item.href === '/operator' && item.label === 'Operator'));
    assert.ok(appRoutes.some((route) => route.path === '/operator'));
  });

  it('builds a dashboard model with storage summary, recent proposals, and parity actions', () => {
    const model = buildOperatorConsoleModel({
      storageRoot: '/tmp/rdma-data',
      proposals: [
        { id: 'P-1', title: 'One', status: 'delivered', updatedAt: '2026-06-22T00:00:00.000Z' },
        { id: 'P-2', title: 'Two', status: 'in_dev', updatedAt: '2026-06-23T00:00:00.000Z' },
      ],
    });

    assert.equal(model.storageRoot, '/tmp/rdma-data');
    assert.equal(model.totalProposals, 2);
    assert.equal(model.delivered, 1);
    assert.equal(model.inFlight, 1);
    assert.equal(model.recent[0]?.id, 'P-2');
    assert.equal(model.capabilities.length, 5);
  });

  it('renders per-agent config rows equivalent to TUI config output', () => {
    const rows = renderAgentConfigRows({
      pm: {
        source: 'agents.yaml',
        llm: { provider: 'openai', model: 'gpt-5.4-mini' },
        prompts: { soul: 'soul', user: null, memory: null },
      },
      qa: {
        source: 'default',
        llm: null,
        prompts: { soul: null, user: null, memory: null },
      },
    });

    assert.deepEqual(rows, [
      { agentId: 'pm', llm: 'openai / gpt-5.4-mini', source: 'agents.yaml', prompts: 'prompts=on' },
      { agentId: 'qa', llm: 'mock', source: 'default', prompts: 'prompts=off' },
    ]);
  });
});
