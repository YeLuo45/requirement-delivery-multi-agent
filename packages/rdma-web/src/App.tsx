/**
 * RDMA web dashboard — the single-page monitoring UI.
 *
 * Pages:
 *   /            — overview (proposal counts + recent activity)
 *   /proposals   — list of all proposals
 *   /proposals/:id — detail view (handoff chain, audit log, artifacts)
 *
 * Data sources (priority order):
 *   1. Live API at /api/proposals (served by Vite middleware in dev/preview)
 *   2. Fallback to /demo-data/proposals.json (shipped with the static build)
 *   3. Empty state with instructions to run the CLI
 *
 * Realtime:
 *   The dashboard also opens a WebSocket to the @rdma/realtime bridge and
 *   refetches the relevant list whenever a pipeline event arrives. The
 *   connection state is shown in the header (green/grey dot).
 */

import { useCallback, useEffect, useState } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import { Overview } from './pages/Overview.js';
import { Proposals } from './pages/Proposals.js';
import { ProposalDetail } from './pages/ProposalDetail.js';
import { useRealtime, defaultRealtimeUrl } from './use-realtime.js';

export function App() {
  return (
    <div className="app">
      <header className="app-header">
        <Link to="/" className="brand">⚡ RDMA</Link>
        <nav>
          <Link to="/">Overview</Link>
          <Link to="/proposals">Proposals</Link>
        </nav>
        <RealtimeIndicator />
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/proposals" element={<Proposals />} />
          <Route path="/proposals/:id" element={<ProposalDetail />} />
        </Routes>
      </main>
      <footer className="app-footer">
        <span>requirement-delivery-multi-agent v0.1.0</span>
        <span>·</span>
        <a
          href="https://github.com/YeLuo45/requirement-delivery-multi-agent"
          target="_blank"
          rel="noreferrer"
        >
          GitHub
        </a>
      </footer>
    </div>
  );
}

function RealtimeIndicator() {
  // Just a passive indicator — no-op callback keeps the WS connection alive
  // so users see when the bridge is reachable.
  const { status } = useRealtime({ url: defaultRealtimeUrl(), onEvent: () => undefined });
  const label = status === 'open' ? 'live' : status === 'connecting' ? '…' : 'offline';
  return (
    <span className={`realtime realtime-${status}`} title={`Realtime bridge: ${status}`}>
      <span className="dot" />
      {label}
    </span>
  );
}

/** Fetch with fallback to the static demo dataset. */
async function fetchWithFallback<T>(primary: string, fallback: string): Promise<{
  data: T;
  source: 'live' | 'demo';
}> {
  try {
    const res = await fetch(primary);
    if (res.ok) {
      const data = (await res.json()) as T;
      return { data, source: 'live' };
    }
  } catch {
    // live API not reachable — fall through to demo
  }
  const res = await fetch(fallback);
  if (!res.ok) throw new Error(`Both primary (${primary}) and fallback (${fallback}) failed`);
  const data = (await res.json()) as T;
  return { data, source: 'demo' };
}

/**
 * Hook used by every page that shows proposal data. The first render
 * fetches once; subsequent realtime events (proposal.created/updated,
 * stage.transitioned, audit.appended) trigger a refetch so the UI
 * stays in sync with the running pipeline.
 */
export function useProposals() {
  const [proposals, setProposals] = useState<unknown[] | null>(null);
  const [source, setSource] = useState<'live' | 'demo' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    fetchWithFallback<unknown[]>('/api/proposals', '/demo-data/proposals.json')
      .then(({ data, source }) => {
        setProposals(data);
        setSource(source);
      })
      .catch((err) => setError(String(err)));
  }, [reloadKey]);

  const onRealtimeEvent = useCallback(() => setReloadKey((k) => k + 1), []);
  useRealtime({ url: defaultRealtimeUrl(), onEvent: onRealtimeEvent });

  return { proposals, source, error };
}

export function useProposalDetail(id: string | undefined) {
  const [data, setData] = useState<unknown | null>(null);
  const [source, setSource] = useState<'live' | 'demo' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!id) return;
    fetchWithFallback<unknown>(
      `/api/proposals/${id}`,
      `/demo-data/details/${id}.json`,
    )
      .then(({ data, source }) => {
        setData(data);
        setSource(source);
      })
      .catch((err) => setError(String(err)));
  }, [id, reloadKey]);

  const onRealtimeEvent = useCallback(
    (e: { proposalId: string }) => {
      if (e.proposalId === id) setReloadKey((k) => k + 1);
    },
    [id],
  );
  useRealtime({ url: defaultRealtimeUrl(), onEvent: onRealtimeEvent });

  return { data, source, error };
}