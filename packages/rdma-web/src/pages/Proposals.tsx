/**
 * Proposals list page.
 */

import { Link } from 'react-router-dom';
import { useProposals } from '../App';

interface ProposalSummary {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export function Proposals() {
  const { proposals, error } = useProposals();

  if (error) {
    return (
      <div className="empty">
        <h2>Couldn't load proposals</h2>
        <p>{error}</p>
      </div>
    );
  }

  if (!proposals) return <div className="empty">Loading…</div>;

  return (
    <div>
      <div className="card">
        <h2>All proposals ({proposals.length})</h2>
        {proposals.length === 0 ? (
          <p style={{ color: 'var(--fg-muted)' }}>
            No proposals yet. Run <code>npm run cli -- demo</code> to seed some.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Title</th>
                <th>Status</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {(proposals as ProposalSummary[]).map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link to={`/proposals/${p.id}`}>{p.id}</Link>
                  </td>
                  <td>{p.title}</td>
                  <td>
                    <span className={`status-badge status-${p.status}`}>{p.status}</span>
                  </td>
                  <td style={{ color: 'var(--fg-muted)' }}>
                    {new Date(p.updatedAt).toLocaleString()}
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
