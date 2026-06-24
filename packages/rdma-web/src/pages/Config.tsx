import { useEffect, useState } from 'react';
import { type AgentConfigRow, renderAgentConfigRows } from '../operator-console.js';

export function Config() {
  const [rows, setRows] = useState<AgentConfigRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/config')
      .then((res) => {
        if (!res.ok) throw new Error(`config fetch failed: ${res.status}`);
        return res.json() as Promise<
          Record<string, Parameters<typeof renderAgentConfigRows>[0][string]>
        >;
      })
      .then((config) => setRows(renderAgentConfigRows(config)))
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
  if (!rows) return <div className="empty">Loading…</div>;

  return (
    <div className="card">
      <h2>Per-agent configuration</h2>
      <p style={{ color: 'var(--fg-muted)' }}>
        Mirrors <code>rdma tui --config</code> for browser operators.
      </p>
      {rows.length === 0 ? (
        <p style={{ color: 'var(--fg-muted)' }}>
          No agents configured — every agent is running in mock mode.
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Agent</th>
              <th>LLM</th>
              <th>Source</th>
              <th>Prompts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.agentId}>
                <td>{row.agentId}</td>
                <td>{row.llm}</td>
                <td>{row.source}</td>
                <td>{row.prompts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
