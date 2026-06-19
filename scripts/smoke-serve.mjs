/**
 * Standalone smoke test: open a WebSocket to the running `rdma serve`
 * daemon, POST a deliver request, and confirm the WS client sees
 * realtime events.
 *
 * Usage:
 *   node scripts/smoke-serve.mjs [baseUrl]
 */

import { RealtimeClient } from '@rdma/realtime';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:47555';
const wsUrl = baseUrl.replace(/^http/, 'ws') + '/ws';

const c = new RealtimeClient({ url: wsUrl });
await c.ready();
console.log(`WS connected to ${wsUrl}`);

const seen = new Set();
const stages = [];
c.onAny((e) => {
  seen.add(e.kind);
  if (e.kind === 'stage.transitioned') {
    const to = e.payload?.to;
    if (to) stages.push(to);
  }
  console.log(`  → ${e.kind}${e.payload ? ' ' + JSON.stringify(e.payload) : ''}`);
});

const res = await fetch(`${baseUrl}/deliver`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    title: 'WS E2E smoke',
    requirement: 'Confirm the dashboard sees realtime events from the daemon.',
  }),
});
const { id } = await res.json();
console.log(`Posted proposal ${id} (status ${res.status})`);

await new Promise((r) => setTimeout(r, 1500));
console.log(`\nTotal event kinds: ${seen.size} → ${[...seen].sort().join(', ')}`);
console.log(`Stage transitions: ${stages.join(' → ')}`);
c.close();
process.exit(0);
