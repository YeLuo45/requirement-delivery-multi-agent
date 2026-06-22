/**
 * ControlPlanePanel — pure-presentation component for the web dashboard.
 *
 * Fetches /api/control-plane/panel and renders a deterministic HTML block.
 * The component itself does no routing, no state beyond the fetched
 * strings, and no side effects; this keeps the existing test suite
 * (which exercises vite-plugin middleware in isolation) free of jsdom /
 * React DOM dependencies.
 */

import { useEffect, useState } from 'react';

interface PanelResponse {
  readonly directions: ReadonlyArray<string>;
  readonly collaboration: string;
  readonly cost: {
    readonly proposalId: string;
    readonly maxUsd: number;
    readonly spentUsd: number;
    readonly remainingUsd: number;
  };
}

interface ControlPlanePanelProps {
  readonly proposalId?: string;
  readonly fetcher?: (proposalId?: string) => Promise<{ panel: PanelResponse; costText: string }>;
}

const DEFAULT_FETCHER = async (proposalId?: string) => {
  const url = proposalId
    ? `/api/control-plane/panel?proposalId=${encodeURIComponent(proposalId)}`
    : '/api/control-plane/panel';
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`control-plane fetch failed: ${res.status}`);
  }
  const data = (await res.json()) as PanelResponse;
  return { panel: data, costText: '' };
};

export function renderControlPlanePanelHtml(panel: PanelResponse, costText: string): string {
  const directions = panel.directions.map((d) => `<li>${d}</li>`).join('');
  return `<section class="control-plane"><h2>Control plane</h2><p>proposal: ${panel.cost.proposalId}</p><p>budget: spent=${panel.cost.spentUsd.toFixed(2)} USD remaining=${panel.cost.remainingUsd.toFixed(2)} USD</p><ul>${directions}</ul><pre>${costText}</pre><pre>${panel.collaboration}</pre></section>`;
}

export function ControlPlanePanel({
  proposalId,
  fetcher = DEFAULT_FETCHER,
}: ControlPlanePanelProps) {
  const [state, setState] = useState<
    { panel: PanelResponse; costText: string } | { error: string } | null
  >(null);
  useEffect(() => {
    fetcher(proposalId)
      .then((payload) => setState(payload))
      .catch((err: unknown) =>
        setState({ error: err instanceof Error ? err.message : String(err) }),
      );
  }, [proposalId, fetcher]);
  if (!state) {
    return `<section class="control-plane">loading…</section>`;
  }
  if ('error' in state) {
    return `<section class="control-plane error">${state.error}</section>`;
  }
  return renderControlPlanePanelHtml(state.panel, state.costText);
}

export type { ControlPlanePanelProps, PanelResponse };
