/**
 * `createInMemoryMetrics()` — convenience factory that returns a
 * `MetricsRecorder` whose snapshot includes everything that has
 * been recorded so far. Use this in tests to assert that the
 * right counters fired without needing to mock a real backend.
 */

import { InMemoryMetrics } from './in-memory.js';
import type { MetricsRecorder } from './index.js';

export function createInMemoryMetrics(options: { timingCap?: number } = {}): MetricsRecorder {
  return new InMemoryMetrics(options);
}
