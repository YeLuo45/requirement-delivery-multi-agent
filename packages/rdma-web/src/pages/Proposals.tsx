/**
 * Proposals list page.
 */

import { useState } from 'react';
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
  const { proposals, error, reload } = useProposals();
  const [title, setTitle] = useState('');
  const [requirement, setRequirement] = useState('');
  const [createStatus, setCreateStatus] = useState<string | null>(null);

  async function submitProposal(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateStatus('Creating…');
    try {
      const res = await fetch('/api/proposals/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title, requirement }),
      });
      if (!res.ok) throw new Error(await res.text());
      const created = (await res.json()) as { id: string };
      setTitle('');
      setRequirement('');
      setCreateStatus(`Created ${created.id}`);
      reload();
    } catch (err) {
      setCreateStatus(err instanceof Error ? err.message : String(err));
    }
  }

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
        <h2>Create proposal</h2>
        <form className="proposal-form" onSubmit={submitProposal}>
          <label>
            Title
            <input value={title} onChange={(event) => setTitle(event.target.value)} required />
          </label>
          <label>
            Requirement
            <textarea
              value={requirement}
              onChange={(event) => setRequirement(event.target.value)}
              required
              rows={4}
            />
          </label>
          <button type="submit">Create proposal</button>
          {createStatus ? <p style={{ color: 'var(--fg-muted)' }}>{createStatus}</p> : null}
        </form>
      </div>
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
