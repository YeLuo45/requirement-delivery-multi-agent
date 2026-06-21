import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseMetricsArgs } from '../src/metrics.js';

describe('rdma metrics --cost flag', () => {
  it('forces prom format and enables the cost branch', () => {
    const flags = parseMetricsArgs(['--cost']);
    assert.equal(flags.cost, true);
    assert.equal(flags.format, 'prom');
  });

  it('keeps cost disabled when --cost is not passed', () => {
    const flags = parseMetricsArgs(['--walk']);
    assert.equal(flags.cost, false);
    assert.equal(flags.format, 'human');
  });

  it('explicit --format overrides --cost auto-format', () => {
    const flags = parseMetricsArgs(['--cost', '--format', 'json']);
    assert.equal(flags.cost, true);
    assert.equal(flags.format, 'json');
  });
});
