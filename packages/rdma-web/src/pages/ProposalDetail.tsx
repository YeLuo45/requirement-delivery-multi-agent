/**
 * Proposal detail page — handoff chain, audit log, artifacts.
 */

import { Link, useParams } from 'react-router-dom';
import { useProposalDetail } from '../App';

interface Proposal {
  id: string;
  projectId: string;
  title: string;
  rawRequirement: string;
  status: string;
  owner: string | null;
  sourceUrl?: string;
  tags: Record<string, string>;
  artifacts: Array<{
    id: string;
    kind: string;
    agentId: string;
    summary: string;
    content: string;
    createdAt: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  at: string;
  detail: Record<string, unknown>;
}

interface DetailResponse {
  proposal: Proposal;
  audit: AuditEntry[];
  handoffChain: string[];
}

export function ProposalDetail() {
  const { id } = useParams<{ id: string }>();
  const { data, source, error } = useProposalDetail(id);

  if (error) {
    return (
      <div className="empty">
        <h2>Couldn't load proposal</h2>
        <p>{error}</p>
        <Link to="/proposals">← Back to proposals</Link>
      </div>
    );
  }
  if (!data) return <div className="empty">Loading…</div>;

  const detail = data as DetailResponse;
  const p = detail.proposal;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Link to="/proposals" style={{ fontSize: 13 }}>
          ← All proposals
        </Link>
        {source === 'demo' && (
          <span
            style={{
              marginLeft: 12,
              fontSize: 11,
              padding: '2px 8px',
              background: 'var(--bg-elevated-2)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              color: 'var(--fg-muted)',
            }}
          >
            DEMO DATA
          </span>
        )}
      </div>

      <div className="card">
        <h2>
          {p.title}{' '}
          <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--fg-muted)' }}>{p.id}</span>
        </h2>
        <p style={{ color: 'var(--fg-muted)', fontSize: 14 }}>{p.rawRequirement}</p>
        <div
          style={{
            marginTop: 12,
            display: 'flex',
            gap: 16,
            flexWrap: 'wrap',
            fontSize: 13,
          }}
        >
          <span>
            Status: <span className={`status-badge status-${p.status}`}>{p.status}</span>
          </span>
          <span style={{ color: 'var(--fg-muted)' }}>
            Project: <code>{p.projectId}</code>
          </span>
          {p.sourceUrl && (
            <span>
              Source:{' '}
              <a href={p.sourceUrl} target="_blank" rel="noreferrer">
                {p.sourceUrl}
              </a>
            </span>
          )}
          <span style={{ color: 'var(--fg-muted)' }}>
            Created: {new Date(p.createdAt).toLocaleString()}
          </span>
          <span style={{ color: 'var(--fg-muted)' }}>
            Updated: {new Date(p.updatedAt).toLocaleString()}
          </span>
        </div>
      </div>

      <div className="card">
        <h2>Handoff chain</h2>
        <div className="handoff-chain">
          {detail.handoffChain.map((agent, i) => (
            <span
              key={`${agent}-${detail.handoffChain.slice(0, i + 1).join('>')}`}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
            >
              <span className="agent">{agent}</span>
              {i < detail.handoffChain.length - 1 && <span className="arrow">→</span>}
            </span>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>Artifacts ({p.artifacts.length})</h2>
        {p.artifacts.map((a) => (
          <div key={a.id} className="artifact">
            <div className="artifact-summary">{a.summary}</div>
            <div className="artifact-meta">
              {a.kind} · {a.agentId} · {new Date(a.createdAt).toLocaleString()}
            </div>
            <div className="artifact-content">{a.content}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <h2>Audit log ({detail.audit.length})</h2>
        {detail.audit.map((e) => (
          <div key={e.id} className="audit-entry">
            <span style={{ color: 'var(--fg-muted)' }}>{e.at}</span>{' '}
            <span className="actor">{e.actor}</span> <span className="action">{e.action}</span>
            {Object.keys(e.detail).length > 0 && (
              <span style={{ color: 'var(--fg-muted)' }}> · {JSON.stringify(e.detail)}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
