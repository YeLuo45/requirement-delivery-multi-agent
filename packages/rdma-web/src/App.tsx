/**
 * RDMA web dashboard — the single-page monitoring UI.
 *
 * Pages:
 *   /            — overview (proposal counts + recent activity)
 *   /proposals   — list of all proposals
 *   /proposals/:id — detail view (handoff chain, audit log, artifacts)
 *
 * Data source: the web dashboard reads proposals directly from the same
 * `.rdma/data/` JSON files the CLI writes. In a real deployment this
 * would be replaced with a websocket or HTTP polling endpoint exposed
 * by a small backend service. For v0.1, we expose a static JSON dump
 * via Vite's `loadConfig` middleware; the dashboard falls back to
 * mock data when the dump is missing.
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
        <a href="https://github.com/YeLuo45/requirement-delivery-multi-agent" target="_blank" rel="noreferrer">
          GitHub
        </a>
      </footer>
    </div>
  );
}

export function useProposals() {
  const [proposals, setProposals] = useState<unknown[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch('/api/proposals')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => setProposals(data))
      .catch((err) => setError(String(err)));
  }, []);
  return { proposals, error };
}