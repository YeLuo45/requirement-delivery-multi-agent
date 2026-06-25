import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildConfigOperationsCenter,
  buildCredentialHealthCenter,
  buildOnboardingChecklist,
  buildPromptWorkbench,
  buildSafeExecutionPlan,
  planAgentConfigPatch,
  planConfigAuditEntry,
} from '../src/config-operations.js';
import { requiredAgentIds } from '../src/operator-console.js';

describe('config operations closure model', () => {
  it('plans a non-mutating agents.yaml patch and validation command', () => {
    const plan = planAgentConfigPatch({
      existingYaml: 'agents:\n  pm:\n    llm:\n      provider: openai\n      model: old\n',
      desired: {
        agentId: 'pm',
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        promptFiles: ['soul.md', 'memory.md'],
      },
    });

    assert.equal(plan.mode, 'dry-run');
    assert.equal(plan.agentId, 'pm');
    assert.match(plan.yamlPreview, /provider: anthropic/);
    assert.match(plan.patchPreview, /- {6}model: old/);
    assert.match(plan.patchPreview, /\+ {6}model: claude-sonnet-4/);
    assert.deepEqual(plan.commands, [
      'npm run cli -- config validate',
      'npm run cli -- config show --all',
    ]);
  });

  it('summarizes agent runtime health with latency, provider, and failure hints', () => {
    const center = buildConfigOperationsCenter({
      configs: {
        pm: {
          source: 'agents.yaml',
          llm: { provider: 'openai', model: 'gpt-5.4-mini' },
          prompts: { soul: 'pm soul', user: null, memory: null },
        },
      },
      runs: [
        { agentId: 'pm', status: 'ok', latencyMs: 420, tokens: 1800, costUsd: 0.11 },
        {
          agentId: 'qa',
          status: 'failed',
          latencyMs: 900,
          tokens: 0,
          costUsd: 0,
          error: 'missing key',
        },
      ],
    });

    assert.equal(center.summary.totalAgents, 7);
    assert.equal(center.summary.healthyAgents, 1);
    assert.equal(center.summary.failedAgents, 1);
    assert.equal(center.summary.mockAgents, 6);
    assert.equal(center.summary.totalCostUsd, 0.11);
    assert.equal(center.rows.find((row) => row.agentId === 'pm')?.lastStatus, 'ok');
    assert.match(center.rows.find((row) => row.agentId === 'qa')?.hint ?? '', /missing key/);
  });

  it('creates config audit entries with rollback and diff ownership', () => {
    const audit = planConfigAuditEntry({
      proposalId: 'P-20260625-007',
      actor: '小墨',
      changedAgents: ['pm', 'qa'],
      beforeHash: 'before123',
      afterHash: 'after456',
      reason: 'configure production smoke',
    });

    assert.equal(audit.kind, 'config.audit');
    assert.equal(audit.proposalId, 'P-20260625-007');
    assert.deepEqual(audit.changedAgents, ['pm', 'qa']);
    assert.equal(audit.rollbackCommand, 'git checkout -- .rdma/agents.yaml .rdma/prompts');
    assert.match(audit.summary, /pm, qa/);
  });

  it('checks credential health without exposing secret values', () => {
    const health = buildCredentialHealthCenter({
      requiredProviders: ['openai', 'anthropic'],
      env: {
        OPENAI_API_KEY: 'sk-live-secret-value',
        ANTHROPIC_API_KEY: '',
      },
    });

    assert.equal(health.readyProviders, 1);
    assert.equal(health.rows[0]?.maskedValue, 'sk-l…alue');
    assert.equal(health.rows[1]?.status, 'missing');
    assert.ok(health.rows.every((row) => !row.maskedValue.includes('secret')));
  });

  it('builds onboarding steps from storage, config, provider, and demo readiness', () => {
    const checklist = buildOnboardingChecklist({
      hasStorageRoot: true,
      hasConfig: false,
      readyProviders: 1,
      demoRan: false,
    });

    assert.deepEqual(
      checklist.steps.map((step) => step.id),
      ['storage', 'config', 'provider', 'demo'],
    );
    assert.equal(checklist.completed, 2);
    assert.equal(checklist.nextAction?.id, 'config');
    assert.match(checklist.nextAction?.command ?? '', /config init/);
  });

  it('detects prompt coverage gaps and conflict risks', () => {
    const workbench = buildPromptWorkbench({
      configs: {
        pm: {
          source: 'agents.yaml',
          llm: null,
          prompts: { soul: 'same policy', user: 'same policy', memory: null },
        },
        dev: {
          source: 'agents.yaml',
          llm: null,
          prompts: { soul: 'dev soul', user: null, memory: null },
        },
      },
    });

    assert.equal(workbench.summary.totalAgents, requiredAgentIds.length);
    assert.equal(workbench.summary.completePromptAgents, 0);
    assert.ok(
      workbench.rows.find((row) => row.agentId === 'pm')?.conflicts.includes('duplicate soul/user'),
    );
    assert.ok(workbench.rows.find((row) => row.agentId === 'qa')?.missing.includes('soul'));
  });

  it('generates safe execution plans from config readiness without mutating state', () => {
    const plan = buildSafeExecutionPlan({
      proposalId: 'P-20260625-007',
      requirement: 'Run configured multi-agent smoke',
      riskLevel: 'medium',
      readyProviders: 2,
    });

    assert.equal(plan.mode, 'dry-run');
    assert.equal(plan.proposalId, 'P-20260625-007');
    assert.match(plan.commands[0] ?? '', /npm run e2e/);
    assert.match(plan.commands[1] ?? '', /deliver/);
    assert.ok(plan.risks.some((risk) => risk.includes('medium')));
  });
});
