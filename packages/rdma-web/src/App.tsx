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
 */

import { useEffect, useState } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import { Overview } from './pages/Overview.js';
import { Proposals } from './pages/Proposals.js';
import { ProposalDetail } from './pages/ProposalDetail.js';

export function App() {
  return (
    <div className="app">
      <header className="app-header">
        <Link to="/" className="brand">⚡ RDMA</Link>
        <nav>
          <Link to="/">Overview</Link>
          <Link to="/proposals">Proposals</Link>
        </nav>
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

export function useProposals() {
  const [proposals, setProposals] = useState<unknown[] | null>(null);
  const [source, setSource] = useState<'live' | 'demo' | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetchWithFallback<unknown[]>('/api/proposals', '/demo-data/proposals.json')
      .then(({ data, source }) => {
        setProposals(data);
        setSource(source);
      })
      .catch((err) => setError(String(err)));
  }, []);
  return { proposals, source, error };
}

export function useProposalDetail(id: string | undefined) {
  const [data, setData] = useState<unknown | null>(null);
  const [source, setSource] = useState<'live' | 'demo' | null>(null);
  const [error, setError] = useState<string | null>(null);
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
  }, [id]);
  return { data, source, error };
}