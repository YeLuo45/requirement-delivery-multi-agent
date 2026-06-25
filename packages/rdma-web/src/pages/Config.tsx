import { useEffect, useState } from 'react';
import {
  type ConfigOperationsCenter,
  type CredentialHealthCenter,
  type OnboardingChecklist,
  type PromptWorkbench,
  type SafeExecutionPlan,
  buildConfigOperationsCenter,
  buildCredentialHealthCenter,
  buildOnboardingChecklist,
  buildPromptWorkbench,
  buildSafeExecutionPlan,
  planAgentConfigPatch,
  planConfigAuditEntry,
} from '../config-operations.js';
import {
  type AgentConfigWorkbench,
  type AgentConfigWorkbenchAgent,
  buildAgentConfigWorkbench,
} from '../operator-console.js';

type ConfigRecord = Parameters<typeof buildAgentConfigWorkbench>[0]['configs'];

export function Config() {
  const [state, setState] = useState<{
    readonly workbench: AgentConfigWorkbench;
    readonly ops: ConfigOperationsCenter;
    readonly credentials: CredentialHealthCenter;
    readonly onboarding: OnboardingChecklist;
    readonly prompts: PromptWorkbench;
    readonly execution: SafeExecutionPlan;
    readonly patchPreview: string;
    readonly auditSummary: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/config')
      .then((res) => {
        if (!res.ok) throw new Error(`config fetch failed: ${res.status}`);
        return res.json() as Promise<ConfigRecord>;
      })
      .then((configs) => setState(buildConfigPageState(configs)))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  if (error) {
    return (
      <div className="empty">
        <h2>Couldn't load agent config</h2>
        <p>{error}</p>
      </div>
    );
  }
  if (!state) return <div className="empty">Loading…</div>;

  const {
    workbench,
    ops,
    credentials,
    onboarding,
    prompts,
    execution,
    patchPreview,
    auditSummary,
  } = state;

  return (
    <div>
      <div className="card">
        <h2>Multi-agent settings workbench</h2>
        <p style={{ color: 'var(--fg-muted)' }}>
          Mirrors <code>rdma tui --config</code> and surfaces provider coverage for all seven
          handoff agents.
        </p>
        <div className="grid" style={{ marginBottom: 16 }}>
          <ConfigStat label="Coverage" value={workbench.summary.coverageLabel} />
          <ConfigStat label="Mock agents" value={String(workbench.summary.mockAgents)} />
          <ConfigStat
            label="Prompt bundles"
            value={String(workbench.summary.promptEnabledAgents)}
          />
          <ConfigStat label="Readiness" value={workbench.summary.riskLevel} />
        </div>
        <div className="grid">
          {workbench.actions.map((action) => (
            <div className="stat" key={action.kind}>
              <div className="label">{action.label}</div>
              <code>{action.command}</code>
              <p style={{ color: 'var(--fg-muted)' }}>{action.description}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>Config operations center</h2>
        <div className="grid" style={{ marginBottom: 16 }}>
          <ConfigStat label="Healthy" value={String(ops.summary.healthyAgents)} />
          <ConfigStat label="Failed" value={String(ops.summary.failedAgents)} />
          <ConfigStat label="Mock" value={String(ops.summary.mockAgents)} />
          <ConfigStat label="Cost" value={`$${ops.summary.totalCostUsd.toFixed(2)}`} />
        </div>
        <table>
          <thead>
            <tr>
              <th>Agent</th>
              <th>Provider</th>
              <th>Last run</th>
              <th>Latency</th>
              <th>Hint</th>
            </tr>
          </thead>
          <tbody>
            {ops.rows.map((row) => (
              <tr key={row.agentId}>
                <td>{row.agentId}</td>
                <td>{row.provider}</td>
                <td>{row.lastStatus}</td>
                <td>{row.latencyMs}ms</td>
                <td style={{ color: 'var(--fg-muted)' }}>{row.hint}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Safe config write plan</h2>
        <p style={{ color: 'var(--fg-muted)' }}>{auditSummary}</p>
        <pre>{patchPreview}</pre>
      </div>

      <div className="card">
        <h2>Credential health</h2>
        <p style={{ color: 'var(--fg-muted)' }}>
          {credentials.readyProviders} provider credentials ready.
        </p>
        <table>
          <thead>
            <tr>
              <th>Provider</th>
              <th>Env</th>
              <th>Status</th>
              <th>Masked</th>
            </tr>
          </thead>
          <tbody>
            {credentials.rows.map((row) => (
              <tr key={row.provider}>
                <td>{row.provider}</td>
                <td>{row.envVar}</td>
                <td>{row.status}</td>
                <td>{row.maskedValue || '(missing)'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Onboarding checklist</h2>
        <p style={{ color: 'var(--fg-muted)' }}>
          {onboarding.completed}/{onboarding.steps.length} steps complete. Next:{' '}
          <code>{onboarding.nextAction?.command ?? 'done'}</code>
        </p>
        <div className="grid">
          {onboarding.steps.map((step) => (
            <div className="stat" key={step.id}>
              <div className="label">{step.label}</div>
              <div className="value">{step.status}</div>
              <code>{step.command}</code>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>Prompt workbench</h2>
        <div className="grid" style={{ marginBottom: 16 }}>
          <ConfigStat label="Complete" value={String(prompts.summary.completePromptAgents)} />
          <ConfigStat label="Conflicts" value={String(prompts.summary.conflictAgents)} />
          <ConfigStat label="Agents" value={String(prompts.summary.totalAgents)} />
        </div>
        <table>
          <thead>
            <tr>
              <th>Agent</th>
              <th>Status</th>
              <th>Missing</th>
              <th>Conflicts</th>
            </tr>
          </thead>
          <tbody>
            {prompts.rows.map((row) => (
              <tr key={row.agentId}>
                <td>{row.agentId}</td>
                <td>{row.status}</td>
                <td>{row.missing.join(', ') || 'none'}</td>
                <td>{row.conflicts.join(', ') || 'none'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Safe execution plan</h2>
        <p style={{ color: 'var(--fg-muted)' }}>
          Mode: <code>{execution.mode}</code> · Proposal: <code>{execution.proposalId}</code>
        </p>
        <pre>{execution.commands.join('\n')}</pre>
        <ul>
          {execution.risks.map((risk) => (
            <li key={risk}>{risk}</li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h2>Agent coverage</h2>
        <table>
          <thead>
            <tr>
              <th>Agent</th>
              <th>LLM</th>
              <th>Source</th>
              <th>Prompts</th>
              <th>Status</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {workbench.agents.map((agent) => (
              <AgentRow agent={agent} key={agent.agentId} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Seven-agent template preview</h2>
        <p style={{ color: 'var(--fg-muted)' }}>
          Scaffold covers {workbench.template.agentCount} agents. Copy it with the init command and
          replace provider/model values per role.
        </p>
        <pre>{workbench.template.yamlPreview}</pre>
      </div>
    </div>
  );
}

function buildConfigPageState(configs: ConfigRecord) {
  const workbench = buildAgentConfigWorkbench({ configs });
  const ops = buildConfigOperationsCenter({ configs, runs: [] });
  const credentials = buildCredentialHealthCenter({
    requiredProviders: ['openai', 'anthropic'],
    env: {},
  });
  const onboarding = buildOnboardingChecklist({
    hasStorageRoot: true,
    hasConfig: Object.keys(configs).length > 0,
    readyProviders: credentials.readyProviders,
    demoRan: false,
  });
  const prompts = buildPromptWorkbench({ configs });
  const execution = buildSafeExecutionPlan({
    proposalId: 'P-20260625-007',
    requirement: 'Run configured multi-agent smoke',
    riskLevel: workbench.summary.riskLevel,
    readyProviders: credentials.readyProviders,
  });
  const patch = planAgentConfigPatch({
    existingYaml: workbench.template.yamlPreview,
    desired: {
      agentId: 'pm',
      provider: 'openai',
      model: 'gpt-5.4-mini',
      promptFiles: ['soul.md', 'user.md', 'memory.md'],
    },
  });
  const audit = planConfigAuditEntry({
    proposalId: 'P-20260625-007',
    actor: '小墨',
    changedAgents: ['pm'],
    beforeHash: 'current-config',
    afterHash: 'planned-config',
    reason: 'dry-run Web config operations closure',
  });
  return {
    workbench,
    ops,
    credentials,
    onboarding,
    prompts,
    execution,
    patchPreview: patch.patchPreview,
    auditSummary: audit.summary,
  };
}

function ConfigStat(input: { readonly label: string; readonly value: string }) {
  return (
    <div className="stat">
      <div className="label">{input.label}</div>
      <div className="value">{input.value}</div>
    </div>
  );
}

function AgentRow(input: { readonly agent: AgentConfigWorkbenchAgent }) {
  const badge = input.agent.status === 'configured' ? 'accepted' : 'approved_for_dev';
  return (
    <tr>
      <td>{input.agent.agentId}</td>
      <td>{input.agent.llm}</td>
      <td>{input.agent.source}</td>
      <td>{input.agent.prompts}</td>
      <td>
        <span className={`status-badge status-${badge}`}>{input.agent.status}</span>
      </td>
      <td style={{ color: 'var(--fg-muted)' }}>{input.agent.note}</td>
    </tr>
  );
}
