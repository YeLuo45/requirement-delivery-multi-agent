import { useEffect, useState } from 'react';
import {
  type CommitManifestSummary,
  type DeliveryHistoryRecord,
  type FailedReleaseGate,
  type SafeStatusSuggestionInput,
  buildDirtyFileOwnershipGuard,
  buildReleaseArtifactBrowser,
  buildSafeStatusApplyPlan,
} from '../delivery-history.js';

interface ReleaseOpsPayload {
  readonly failedGateQueue: ReadonlyArray<FailedReleaseGate>;
  readonly commitManifests: ReadonlyArray<CommitManifestSummary>;
  readonly releaseIndex: ReadonlyArray<unknown>;
  readonly remediationMarkdown: string;
}

interface ReleaseOpsAutomationPayload extends ReleaseOpsPayload {
  readonly statusSuggestions?: ReadonlyArray<SafeStatusSuggestionInput>;
}

export function ReleaseOps() {
  const [ops, setOps] = useState<ReleaseOpsPayload | null>(null);
  const [automation, setAutomation] = useState<ReleaseOpsAutomationPayload | null>(null);
  const [history, setHistory] = useState<ReadonlyArray<DeliveryHistoryRecord>>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/api/release-ops').then((res) => {
        if (!res.ok) throw new Error(`release ops failed: ${res.status}`);
        return res.json() as Promise<ReleaseOpsPayload>;
      }),
      fetch('/api/release-ops?format=automation').then((res) => {
        if (!res.ok) throw new Error(`release ops automation failed: ${res.status}`);
        return res.json() as Promise<ReleaseOpsAutomationPayload>;
      }),
      fetch('/api/release-history').then((res) => {
        if (!res.ok) throw new Error(`release history failed: ${res.status}`);
        return res.json() as Promise<ReadonlyArray<DeliveryHistoryRecord>>;
      }),
    ])
      .then(([opsPayload, automationPayload, histories]) => {
        setOps(opsPayload);
        setAutomation(automationPayload);
        setHistory(histories);
      })
      .catch((err) => setError(String(err)));
  }, []);

  if (error) return <section className="card error">{error}</section>;
  if (!ops) return <section className="card">Loading release operations…</section>;

  const safePlan = buildSafeStatusApplyPlan(automation?.statusSuggestions ?? []);
  const guard = buildDirtyFileOwnershipGuard(ops.commitManifests);
  const artifacts = buildReleaseArtifactBrowser(history);

  return (
    <section className="stack">
      <div className="card">
        <h1>Release Operations</h1>
        <p>
          Failed gates: {ops.failedGateQueue.length} · Commit manifests:{' '}
          {ops.commitManifests.length} · Release artifacts: {artifacts.items.length}
        </p>
      </div>

      <div className="card">
        <h2>Failed Gate Queue</h2>
        {ops.failedGateQueue.length === 0 ? <p>No failed release gates.</p> : null}
        {ops.failedGateQueue.map((gate) => (
          <article key={`${gate.proposalId}-${gate.gateLabel}`} className="row-card">
            <strong>{gate.proposalId}</strong> {gate.gateLabel} · {gate.historyPath}
            <ul>
              {gate.checklist.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>

      <div className="card">
        <h2>Safe Status Apply</h2>
        <p>
          Safe: {safePlan.safe.length} · Blocked: {safePlan.blocked.length}
        </p>
        {safePlan.safe.map((action) => (
          <code key={action.proposalId}>{action.dryRunCommand}</code>
        ))}
      </div>

      <div className="card">
        <h2>Dirty File Ownership Guard</h2>
        {guard.safeStageCommands.map((command) => (
          <code key={command}>{command}</code>
        ))}
        <p>Generated review files: {guard.generatedReviewFiles.length}</p>
        <p>Manual review files: {guard.manualReviewFiles.length}</p>
      </div>

      <div className="card">
        <h2>Release Artifacts</h2>
        {artifacts.items.map((item) => (
          <article key={`${item.proposalId}-${item.generatedAt}`} className="row-card">
            <strong>{item.proposalId}</strong> · {item.gateSummary} · {item.dirtySummary}
            <ul>
              <li>{item.artifacts.releaseJson}</li>
              <li>{item.artifacts.summaryMarkdown}</li>
              <li>{item.artifacts.commitManifestJson}</li>
              <li>{item.artifacts.diffJson}</li>
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}
