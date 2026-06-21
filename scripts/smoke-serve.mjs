#!/usr/bin/env node
/**
 * `scripts/smoke-serve.mjs`
 *
 * End-to-end smoke for `rdma serve`. Boots a daemon on an ephemeral port
 * with a fresh storage root, then exercises the public surface:
 *
 *   1. GET /health                    -> { status: "ok" }
 *   2. POST /deliver (sync, wait=1)   -> drives a proposal to delivered
 *   3. GET /proposals                 -> lists the new proposal
 *   4. GET /proposals/:id             -> returns detail with handoffChain
 *   5. GET /inspect/:id               -> returns JSON inspect view
 *   6. GET /events?proposal=<id>      -> returns the audit-derived event stream
 *   7. WebSocket /ws                  -> receives proposal.created + stage.transitioned
 *
 * Exits non-zero on the first failed assertion. Used by README verification
 * and CI smoke jobs.
 *
 * Usage:
 *   node scripts/smoke-serve.mjs [--port <n>] [--timeout-ms <ms>]
 *
 *   --port N         (optional) explicit port; default = ask the OS
 *   --timeout-ms N   (optional) overall timeout; default = 30000
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = parseArgs(process.argv.slice(2));
const timeoutMs = Number(args['timeout-ms'] ?? 30000);
const explicitPort = args.port ? Number(args.port) : 0;

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          flags[arg.slice(2)] = next;
          i++;
        } else {
          flags[arg.slice(2)] = true;
        }
      }
    }
  }
  return flags;
}

const { startServe } = await import(path.join(repoRoot, 'packages/rdma-cli/src/serve.ts'));

const storageRoot = mkdtempSync(path.join(tmpdir(), 'rdma-smoke-storage-'));
const shippedRoot = mkdtempSync(path.join(tmpdir(), 'rdma-smoke-shipped-'));

let handle;
let failed = null;
const fail = (msg, extra) => {
  failed = extra ? `${msg} (${extra})` : msg;
  console.error(`✗ ${failed}`);
};
const ok = (msg) => console.log(`✓ ${msg}`);

const overallTimer = setTimeout(() => {
  fail(`smoke exceeded ${timeoutMs}ms`);
  finish(1);
}, timeoutMs);

try {
  console.log(`[smoke] storage=${storageRoot}`);
  console.log(`[smoke] shipped=${shippedRoot}`);
  handle = await startServe({
    port: explicitPort,
    host: '127.0.0.1',
    storage: 'json',
    useLlm: false,
    storageRoot,
    shippedRoot,
  });
  ok(`daemon listening on http://127.0.0.1:${handle.port}`);

  // 1. /health
  const health = await fetchJson(`http://127.0.0.1:${handle.port}/health`);
  assertEq(health.status, 'ok', '/health.status');
  assertMatch(health.backend, /^json:/, '/health.backend');
  ok('GET /health returns ok');

  // 2. POST /deliver (sync)
  const deliver = await postDeliver(handle.port, {
    title: 'Smoke serve',
    requirement: 'A minimal end-to-end requirement that the daemon should drive to delivered.',
    wait: true,
  });
  assertEq(deliver.status, 'delivered', 'POST /deliver (sync).status');
  const proposalId = deliver.id;
  ok(`POST /deliver (sync) drives ${proposalId} to delivered`);

  // 3. GET /proposals
  const list = await fetchJson(`http://127.0.0.1:${handle.port}/proposals`);
  assertEq(list.find((p) => p.id === proposalId)?.status, 'delivered', 'GET /proposals');
  ok('GET /proposals includes the new proposal');

  // 4. GET /proposals/:id
  const detail = await fetchJson(`http://127.0.0.1:${handle.port}/proposals/${proposalId}`);
  assertEq(detail.id, proposalId, 'GET /proposals/:id.id');
  assertEq(detail.status, 'delivered', 'GET /proposals/:id.status');
  assertOk(
    Array.isArray(detail.handoffChain) && detail.handoffChain.length > 0,
    'GET /proposals/:id.handoffChain non-empty',
  );
  ok('GET /proposals/:id returns proposal + handoffChain');

  // 5. GET /inspect/:id
  const inspect = await fetchJson(`http://127.0.0.1:${handle.port}/inspect/${proposalId}`);
  assertEq(inspect.proposal.id, proposalId, 'GET /inspect/:id.proposal.id');
  assertOk(inspect.auditTimeline.length > 0, 'GET /inspect/:id.auditTimeline non-empty');
  ok('GET /inspect/:id returns proposal + handoffChain + auditTimeline');

  // 6. GET /events?proposal=<id>
  const events = await fetchJson(
    `http://127.0.0.1:${handle.port}/events?proposal=${proposalId}&limit=200`,
  );
  assertOk(events.count > 0, 'GET /events count > 0');
  assertEq(events.proposalFilter, proposalId, 'GET /events.proposalFilter');
  assertOk(
    events.events.some((e) => e.kind === 'agent.handle.start'),
    'GET /events has agent.handle.start',
  );
  assertOk(
    events.events.some((e) => e.kind === 'agent.handle.end'),
    'GET /events has agent.handle.end',
  );
  ok(`GET /events returns ${events.count} events for ${proposalId}`);

  // 7. WebSocket — observe proposal.created + stage.transitioned
  const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/ws`);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('ws open timeout')), 5000);
    ws.once('open', () => {
      clearTimeout(timer);
      resolve();
    });
    ws.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
  const wsEvents = [];
  ws.on('message', (raw) => {
    try {
      const frame = JSON.parse(String(raw));
      if (frame.type === 'event' && frame.event) wsEvents.push(frame.event.kind);
    } catch {
      // ignore malformed frames
    }
  });
  // Trigger another proposal so the WS sees a new proposal.created.
  await postDeliver(handle.port, {
    title: 'Smoke ws trigger',
    requirement: 'Trigger a WS event for the smoke test.',
    wait: true,
  });
  await delay(300);
  ws.close();
  assertOk(wsEvents.includes('proposal.created'), 'WS saw proposal.created');
  assertOk(wsEvents.includes('stage.transitioned'), 'WS saw stage.transitioned');
  ok(`WebSocket received ${wsEvents.length} pipeline events`);

  console.log('\n✓ rdma serve smoke passed');
  finish(0);
} catch (err) {
  fail(`smoke threw: ${err.message}`);
  finish(1);
} finally {
  clearTimeout(overallTimer);
}

function finish(code) {
  if (handle) {
    handle.shutdown().catch(() => undefined);
  }
  // Give the shutdown a brief moment, then exit.
  setTimeout(() => {
    try {
      rmSync(storageRoot, { recursive: true, force: true });
    } catch {}
    try {
      rmSync(shippedRoot, { recursive: true, force: true });
    } catch {}
    process.exit(failed ? 1 : code);
  }, 100).unref();
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`fetch ${url} -> HTTP ${res.status}: ${body.slice(0, 120)}`);
  }
  return res.json();
}

async function postDeliver(port, body) {
  const url = new URL(`http://127.0.0.1:${port}/deliver`);
  if (body.wait) url.searchParams.set('wait', '1');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: body.title, requirement: body.requirement }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST /deliver -> HTTP ${res.status}: ${text.slice(0, 120)}`);
  }
  return res.json();
}

function assertEq(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function assertMatch(actual, pattern, label) {
  if (!pattern.test(String(actual))) {
    throw new Error(`${label}: ${JSON.stringify(actual)} does not match ${pattern}`);
  }
}

function assertOk(condition, label) {
  if (!condition) {
    throw new Error(`${label}: condition failed`);
  }
}
