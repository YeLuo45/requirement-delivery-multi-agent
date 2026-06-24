/**
 * Delivery report page — operator-facing acceptance and release summary.
 */

import { Link, useParams } from 'react-router-dom';
import { useProposals, useReleaseHistory } from '../App';
import { buildAcceptanceEvidenceDashboard } from '../acceptance-evidence.js';
import {
  type DeliveryHistoryRecord,
  buildDeliveryReportHistoryModel,
} from '../delivery-history.js';

interface ProposalSummary {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt?: string;
  notes?: string;
}

export function DeliveryReport() {
  const { id } = useParams<{ id: string }>();
  const { proposals, error } = useProposals();
  const { histories, error: historyError } = useReleaseHistory();

  if (error || historyError) {
    return (
      <div className="empty">
        <h2>Couldn't load delivery report</h2>
        <p>{error ?? historyError}</p>
      </div>
    );
  }
  if (!proposals || !histories) return <div className="empty">Loading…</div>;

  const all = proposals as ProposalSummary[];
  const proposal = all.find((item) => item.id === id) ?? all[0];
  const dashboard = buildAcceptanceEvidenceDashboard(
    all.map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      updatedAt: item.updatedAt ?? item.createdAt,
      ...(item.notes ? { notes: item.notes } : {}),
    })),
  );
  const row = dashboard.rows.find((item) => item.proposalId === proposal?.id);
  const historyModel = proposal
    ? buildDeliveryReportHistoryModel(proposal, histories as DeliveryHistoryRecord[])
    : null;
  const nextActions = historyModel?.safeNextActions ?? [];
  const passedGates = historyModel?.gateSummary.total
    ? historyModel.gateSummary.passed
    : (row?.passedGates ?? 0);
  const totalGates = historyModel?.gateSummary.total ?? row?.totalGates ?? 0;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Link to="/proposals" style={{ fontSize: 13 }}>
          All proposals
        </Link>
      </div>

      <div className="card">
        <h2>Delivery Report {proposal ? <code>{proposal.id}</code> : null}</h2>
        <p style={{ color: 'var(--fg-muted)', fontSize: 14 }}>
          Gate evidence, safe status actions, and copy-ready Markdown summary for local release
          acceptance.
        </p>
      </div>

      <div className="grid" style={{ marginBottom: 24 }}>
        <div className="stat">
          <div className="label">Gate pass rate</div>
          <div className="value">
            {totalGates > 0
              ? Math.round((passedGates / totalGates) * 100)
              : dashboard.summary.passRate}
            %
          </div>
        </div>
        <div className="stat">
          <div className="label">Passed gates</div>
          <div className="value">{passedGates}</div>
        </div>
        <div className="stat">
          <div className="label">Total gates</div>
          <div className="value">{totalGates}</div>
        </div>
        <div className="stat">
          <div className="label">Safe next actions</div>
          <div className="value">{nextActions.length}</div>
        </div>
      </div>

      <div className="card">
        <h2>Release history</h2>
        {historyModel?.latestHistory ? (
          <table>
            <thead>
              <tr>
                <th>Generated</th>
                <th>History</th>
                <th>Dirty files</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{historyModel.latestHistory.generatedAt}</td>
                <td>
                  <code>{historyModel.latestHistory.historyPath}</code>
                </td>
                <td>{historyModel.dirtyFileCount}</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <p style={{ color: 'var(--fg-muted)' }}>No release history found for this proposal.</p>
        )}
      </div>

      <div className="card">
        <h2>Gate drilldown</h2>
        {historyModel?.latestHistory?.gateResults ? (
          <table>
            <thead>
              <tr>
                <th>Gate</th>
                <th>Status</th>
                <th>Duration</th>
                <th>Hint</th>
              </tr>
            </thead>
            <tbody>
              {historyModel.latestHistory.gateResults.map((gate) => (
                <tr key={gate.label}>
                  <td>{gate.label}</td>
                  <td>
                    <span
                      className={`status-badge status-${gate.status === 'pass' ? 'accepted' : 'test_failed'}`}
                    >
                      {gate.status}
                    </span>
                  </td>
                  <td>{gate.durationMs}ms</td>
                  <td style={{ color: 'var(--fg-muted)' }}>{gate.checklist[0] ?? 'OK'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : row ? (
          <table>
            <thead>
              <tr>
                <th>Gate</th>
                <th>Status</th>
                <th>Hint</th>
              </tr>
            </thead>
            <tbody>
              {row.gates.map((gate) => (
                <tr key={gate.id}>
                  <td>{gate.label}</td>
                  <td>
                    <span
                      className={`status-badge status-${gate.state === 'pass' ? 'accepted' : 'test_failed'}`}
                    >
                      {gate.state}
                    </span>
                  </td>
                  <td style={{ color: 'var(--fg-muted)' }}>{gate.hint}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p style={{ color: 'var(--fg-muted)' }}>No gate evidence found for this proposal.</p>
        )}
      </div>

      <div className="card">
        <h2>Safe next actions</h2>
        {nextActions.length === 0 ? (
          <p style={{ color: 'var(--fg-muted)' }}>No forward action is available.</p>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {nextActions.map((status) => (
              <span key={status} className={`status-badge status-${status}`}>
                {status}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h2>Copy-ready Markdown</h2>
        <pre>
          {renderMarkdown(
            proposal,
            passedGates,
            totalGates,
            nextActions,
            historyModel?.latestHistory?.historyPath,
          )}
        </pre>
      </div>
    </div>
  );
}

function renderMarkdown(
  proposal: ProposalSummary | undefined,
  passedGates: number,
  totalGates: number,
  nextActions: ReadonlyArray<string>,
  historyPath: string | undefined,
): string {
  if (!proposal) return '# Delivery Report\n\nNo proposal loaded.\n';
  return [
    `# Delivery Report — ${proposal.id}: ${proposal.title}`,
    '',
    `Status: ${proposal.status}`,
    `Gates: ${passedGates}/${totalGates}`,
    `History: ${historyPath ?? 'No release history found'}`,
    '',
    '## Safe next actions',
    ...(nextActions.length > 0 ? nextActions.map((status) => `- ${status}`) : ['- (none)']),
    '',
  ].join('\n');
}
