import { Link } from 'react-router-dom';
import { useProposals } from '../App';
import { buildOperatorConsoleModel } from '../operator-console.js';

interface ProposalSummary {
  id: string;
  title: string;
  status: string;
  updatedAt: string;
}

export function Operator() {
  const { proposals, error } = useProposals();
  if (error) {
    return (
      <div className="empty">
        <h2>Couldn't load operator console</h2>
        <p>{error}</p>
      </div>
    );
  }
  if (!proposals) return <div className="empty">Loading…</div>;

  const model = buildOperatorConsoleModel({
    storageRoot: '.rdma/data',
    proposals: proposals as ProposalSummary[],
  });

  return (
    <div>
      <div className="grid" style={{ marginBottom: 24 }}>
        <div className="stat">
          <div className="label">TUI parity</div>
          <div className="value">{model.capabilities.length}/5</div>
        </div>
        <div className="stat">
          <div className="label">Total proposals</div>
          <div className="value">{model.totalProposals}</div>
        </div>
        <div className="stat">
          <div className="label">Delivered</div>
          <div className="value" style={{ color: 'var(--green)' }}>
            {model.delivered}
          </div>
        </div>
        <div className="stat">
          <div className="label">In flight</div>
          <div className="value" style={{ color: 'var(--accent)' }}>
            {model.inFlight}
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Operator surfaces</h2>
        <p style={{ color: 'var(--fg-muted)' }}>
          Web mode mirrors every zero-dependency TUI operation from the browser.
        </p>
        <table>
          <thead>
            <tr>
              <th>TUI command</th>
              <th>Web surface</th>
              <th>Purpose</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {model.capabilities.map((capability) => (
              <tr key={capability.id}>
                <td>
                  <code>{capability.tuiCommand}</code>
                </td>
                <td>
                  <code>{capability.webSurface}</code>
                </td>
                <td>{capability.description}</td>
                <td>
                  <span className="status-badge status-delivered">{capability.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Quick actions</h2>
        <div className="quick-actions">
          <Link to="/proposals">List / new proposal</Link>
          <Link to="/config">Agent config</Link>
          <Link to="/control-plane">Control plane</Link>
        </div>
      </div>

      <div className="card">
        <h2>Recent proposals</h2>
        {model.recent.length === 0 ? (
          <p style={{ color: 'var(--fg-muted)' }}>No proposals yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Title</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {model.recent.map((proposal) => (
                <tr key={proposal.id}>
                  <td>
                    <Link to={`/proposals/${proposal.id}`}>{proposal.id}</Link>
                  </td>
                  <td>{proposal.title}</td>
                  <td>
                    <span className={`status-badge status-${proposal.status}`}>
                      {proposal.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
