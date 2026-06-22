import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  type PanelResponse,
  renderControlPlanePanelHtml,
} from '../src/components/ControlPlanePanel.jsx';

const panel: PanelResponse = {
  directions: ['A:delivery-sandbox', 'B:collaboration', 'C:tool-governance', 'D:cost-router'],
  collaboration: 'role       access                         lease',
  cost: {
    proposalId: 'P-20260622-007',
    maxUsd: 1,
    spentUsd: 0.4,
    remainingUsd: 0.6,
  },
};

describe('ControlPlanePanel renderer', () => {
  it('renders proposal + budget + directions + cost text + collaboration', () => {
    const html = renderControlPlanePanelHtml(panel, 'rdma_cost_spent_usd 0.40');
    assert.match(html, /<section class="control-plane">/);
    assert.match(html, /proposal: P-20260622-007/);
    assert.match(html, /spent=0\.40 USD remaining=0\.60 USD/);
    assert.match(html, /<li>A:delivery-sandbox<\/li>/);
    assert.match(html, /<li>D:cost-router<\/li>/);
    assert.match(html, /rdma_cost_spent_usd 0\.40/);
    assert.match(html, /role {7}access/);
  });
});
