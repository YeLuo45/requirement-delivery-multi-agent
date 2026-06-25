import { useEffect, useState } from 'react';
import {
  type AgentConfigWorkbench,
  type AgentConfigWorkbenchAgent,
  buildAgentConfigWorkbench,
} from '../operator-console.js';

export function Config() {
  const [workbench, setWorkbench] = useState<AgentConfigWorkbench | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/config')
      .then((res) => {
        if (!res.ok) throw new Error(`config fetch failed: ${res.status}`);
        return res.json() as Promise<Parameters<typeof buildAgentConfigWorkbench>[0]['configs']>;
      })
      .then((configs) => setWorkbench(buildAgentConfigWorkbench({ configs })))
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
  if (!workbench) return <div className="empty">Loading…</div>;

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
