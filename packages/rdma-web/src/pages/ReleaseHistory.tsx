import { Link } from 'react-router-dom';
import { useProposals, useReleaseHistory } from '../App.js';
import {
  type DeliveryHistoryRecord,
  buildReleaseHistoryRows,
  buildReleaseOperationsCenter,
} from '../delivery-history.js';

interface ProposalSummary {
  id: string;
  title: string;
  status: string;
}

export function ReleaseHistory() {
  const { proposals, error: proposalError } = useProposals();
  const { histories, error: historyError } = useReleaseHistory();
  const error = proposalError ?? historyError;

  if (error) return <div className="empty">{error}</div>;
  if (!proposals || !histories) return <div className="empty">Loading…</div>;

  const proposalRows = proposals as ProposalSummary[];
  const historyRows = histories as DeliveryHistoryRecord[];
  const rows = buildReleaseHistoryRows(proposalRows, historyRows);
  const operations = buildReleaseOperationsCenter(proposalRows, historyRows);
  const manifestTotals = Array.from(operations.commitManifests.values()).reduce(
    (totals, manifest) => ({
      sourceFiles: totals.sourceFiles + manifest.counts.sourceFiles,
      testFiles: totals.testFiles + manifest.counts.testFiles,
      docs: totals.docs + manifest.counts.docs,
      generated: totals.generated + manifest.counts.generated,
      other: totals.other + manifest.counts.other,
    }),
    { sourceFiles: 0, testFiles: 0, docs: 0, generated: 0, other: 0 },
  );

  return (
    <div>
      <div className="card">
        <h2>Release History</h2>
        <p style={{ color: 'var(--fg-muted)', fontSize: 14 }}>
          Persisted local release evidence grouped by proposal, gate outcome, and dirty file
          ownership.
        </p>
      </div>

      <div className="grid" style={{ marginBottom: 24 }}>
        <div className="stat">
          <div className="label">Failed gates</div>
          <div className="value">{operations.failedGateQueue.length}</div>
        </div>
        <div className="stat">
          <div className="label">Source files</div>
          <div className="value">{manifestTotals.sourceFiles}</div>
        </div>
        <div className="stat">
          <div className="label">Tests</div>
          <div className="value">{manifestTotals.testFiles}</div>
        </div>
        <div className="stat">
          <div className="label">Docs + generated</div>
          <div className="value">{manifestTotals.docs + manifestTotals.generated}</div>
        </div>
      </div>

      <div className="card">
        <h2>Failed gate queue</h2>
        {operations.failedGateQueue.length === 0 ? (
          <p style={{ color: 'var(--fg-muted)' }}>No failed release gates.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Proposal</th>
                <th>Gate</th>
                <th>Checklist</th>
                <th>History</th>
              </tr>
            </thead>
            <tbody>
              {operations.failedGateQueue.map((gate) => (
                <tr key={`${gate.proposalId}-${gate.gateLabel}-${gate.generatedAt}`}>
                  <td>
                    <Link to={`/delivery-report/${gate.proposalId}`}>{gate.proposalId}</Link>
                    <div style={{ color: 'var(--fg-muted)', fontSize: 12 }}>{gate.title}</div>
                  </td>
                  <td>
                    <span className="status-badge status-test_failed">{gate.gateLabel}</span>
                  </td>
                  <td>{gate.checklist[0] ?? 'Rerun the failed gate directly.'}</td>
                  <td>
                    <code>{gate.historyPath}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        {rows.length === 0 ? (
          <p style={{ color: 'var(--fg-muted)' }}>No release history records found.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Proposal</th>
                <th>Gates</th>
                <th>Dirty files</th>
                <th>Stage paths</th>
                <th>History</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.proposalId}>
                  <td>
                    <Link to={`/delivery-report/${row.proposalId}`}>{row.proposalId}</Link>
                    <div style={{ color: 'var(--fg-muted)', fontSize: 12 }}>{row.title}</div>
                  </td>
                  <td>
                    {row.gateSummary.passed}/{row.gateSummary.total} pass
                  </td>
                  <td>{row.dirtyFileCount}</td>
                  <td>
                    {operations.commitManifests.get(row.proposalId)?.recommendedStagePaths.length ??
                      0}
                  </td>
                  <td>
                    <code>{row.latestHistory?.historyPath}</code>
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
