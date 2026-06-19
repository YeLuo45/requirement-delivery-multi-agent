/**
 * Overview page — high-level system status + recent activity.
 */

import { useProposals } from '../App';

interface ProposalSummary {
  id: string;
  projectId: string;
  title: string;
  status: string;
  createdAt: string;
}

const STAGE_ORDER = [
  'research_direction_pending',
  'research',
  'intake',
  'ideation',
  'clarifying',
  'prd_pending_confirmation',
  'approved_for_dev',
  'in_tdd_test',
  'in_dev',
  'in_test_acceptance',
  'test_failed',
  'accepted',
  'deployed',
  'delivered',
];

export function Overview() {
  const { proposals, error } = useProposals();

  if (error) {
    return (
      <div className="empty">
        <h2>Couldn't load proposals</h2>
        <p>{error}</p>
        <p>
          The web dashboard reads from <code>.rdma/data/</code>. Make sure you've run the
          CLI at least once:
        </p>
        <pre>npm run cli -- demo</pre>
      </div>
    );
  }

  if (!proposals) return <div className="empty">Loading…</div>;

  const counts: Record<string, number> = {};
  for (const p of proposals as ProposalSummary[]) {
    counts[p.status] = (counts[p.status] ?? 0) + 1;
  }

  const delivered = counts['delivered'] ?? 0;
  const inFlight = proposals.length - delivered;

  return (
    <div>
      <div className="grid" style={{ marginBottom: 24 }}>
        <div className="stat">
          <div className="label">Total proposals</div>
          <div className="value">{proposals.length}</div>
        </div>
        <div className="stat">
          <div className="label">Delivered</div>
          <div className="value" style={{ color: 'var(--green)' }}>{delivered}</div>
        </div>
        <div className="stat">
          <div className="label">In flight</div>
          <div className="value" style={{ color: 'var(--accent)' }}>{inFlight}</div>
        </div>
        <div className="stat">
          <div className="label">Stages tracked</div>
          <div className="value">{STAGE_ORDER.length}</div>
        </div>
      </div>

      <div className="card">
        <h2>Pipeline distribution</h2>
        {Object.keys(counts).length === 0 ? (
          <p style={{ color: 'var(--fg-muted)' }}>
            No proposals yet. Try <code>npm run cli -- demo</code> or
            {' '}<code>npm run cli -- deliver "..." --requirement "..."</code>.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Stage</th>
                <th style={{ width: 80, textAlign: 'right' }}>Count</th>
              </tr>
            </thead>
            <tbody>
              {STAGE_ORDER.filter((s) => counts[s]).map((stage) => (
                <tr key={stage}>
                  <td>
                    <span className={`status-badge status-${stage}`}>{stage}</span>
                  </td>
                  <td style={{ textAlign: 'right' }}>{counts[stage]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>Recent activity</h2>
        {(proposals as ProposalSummary[]).length === 0 ? (
          <p style={{ color: 'var(--fg-muted)' }}>No activity yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Proposal</th>
                <th>Title</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {(proposals as ProposalSummary[]).slice(0, 10).map((p) => (
                <tr key={p.id}>
                  <td>
                    <a href={`/proposals/${p.id}`}>{p.id}</a>
                  </td>
                  <td>{p.title}</td>
                  <td>
                    <span className={`status-badge status-${p.status}`}>{p.status}</span>
                  </td>
                  <td style={{ color: 'var(--fg-muted)' }}>
                    {new Date(p.createdAt).toLocaleString()}
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