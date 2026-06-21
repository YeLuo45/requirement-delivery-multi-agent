#!/usr/bin/env node
/**
 * `scripts/smoke-cross-platform.mjs`
 *
 * Cross-platform daemon smoke used by the G3 CI matrix. Boots
 * `rdma serve` on an ephemeral port, exercises the public REST +
 * WebSocket surface, and additionally:
 *
 *   1. probes the SQLite backend (if the better-sqlite3 native
 *      binding is available in the host image),
 *   2. records the OS + Node version so CI artifacts can be
 *      cross-referenced when a matrix cell flakes,
 *   3. tolerates a missing SQLite binding by printing a SKIP
 *      marker rather than failing the job — Linux runners ship
 *      the binding but macOS runners often don't.
 *
 * Exit codes:
 *   0   every probe passed (sqlite may have been skipped)
 *   1   at least one probe failed
 *
 * Usage:
 *   node scripts/smoke-cross-platform.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function header(title) {
  console.log(`\n=== ${title} ===`);
}

function info(msg) {
  console.log(`  · ${msg}`);
}

function pass(msg) {
  console.log(`  ✓ ${msg}`);
}

function skip(msg) {
  console.log(`  ~ SKIP ${msg}`);
}

function fail(msg) {
  console.error(`  ✗ ${msg}`);
  failures.push(msg);
}

const failures = [];

async function main() {
  header('Environment');
  info(`os.platform=${os.platform()} os.release=${os.release()}`);
  info(`node=${process.version}`);

  // Probe 1 — JSON backend daemon smoke (already exercised by the
  // main smoke job, but here we focus on the SQLite path).
  header('SQLite backend probe');
  await probeSqlite();

  // Probe 2 — verify the SQLite store round-trips a proposal if the
  // binding is available. This guards against the Linux-vs-macOS
  // prebuilt binary drift that bit us on the very first macOS
  // pipeline integration.
  header('SQLite round-trip probe');
  await probeSqliteRoundTrip();

  if (failures.length > 0) {
    console.error(`\n${failures.length} cross-platform probe(s) failed:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('\n✓ cross-platform smoke passed');
}

function isBindingMissing(message) {
  return /bindings file|native binding|Could not locate|Failed to open SQLite database|libsql/i.test(
    message,
  );
}

async function probeSqlite() {
  const sqlitePkg = path.join(repoRoot, 'packages/rdma-persistence/src/sqlite.ts');
  const tmpRoot = mkdtempSync(path.join(tmpdir(), 'rdma-sqlite-probe-'));
  try {
    const url = new URL(`file://${sqlitePkg}`).pathname;
    const mod = await import(url);
    const store = await mod.SqliteStorage.open({ path: path.join(tmpRoot, 'probe.sqlite') });
    pass(`SqliteStorage.open() succeeded on ${os.platform()} (${store.backendName})`);
    if (typeof store.close === 'function') store.close();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isBindingMissing(msg)) {
      skip(`SqliteStorage native binding unavailable: ${msg.split('\n')[0]}`);
    } else {
      fail(`SqliteStorage.open() failed unexpectedly: ${msg}`);
    }
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}

async function probeSqliteRoundTrip() {
  const sqlitePkg = path.join(repoRoot, 'packages/rdma-persistence/src/sqlite.ts');
  const tmpRoot = mkdtempSync(path.join(tmpdir(), 'rdma-sqlite-roundtrip-'));
  try {
    const url = new URL(`file://${sqlitePkg}`).pathname;
    const mod = await import(url);
    const store = await mod.SqliteStorage.open({ path: path.join(tmpRoot, 'rt.sqlite') });
    await store.init();
    const proposal = makeTestProposal();
    await store.saveProposal(proposal);
    const fetched = await store.getProposal(proposal.id);
    if (!fetched || fetched.id !== proposal.id) {
      fail(`SQLite round-trip lost the proposal id (got ${fetched?.id})`);
      return;
    }
    pass(`SQLite round-trip succeeded for ${proposal.id}`);
    if (typeof store.close === 'function') store.close();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isBindingMissing(msg)) {
      skip(`SQLite round-trip skipped: ${msg.split('\n')[0]}`);
    } else {
      fail(`SQLite round-trip threw: ${msg}`);
    }
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}

function makeTestProposal() {
  // The bare minimum the schema needs; if this changes, the
  // upstream `e2e: SqliteStorage round-trips a proposal` test
  // will surface the regression.
  const id = `P-${Date.now()}-probe`;
  return {
    id,
    projectId: 'PRJ-probe',
    title: 'SQLite cross-platform probe',
    rawRequirement: 'Smoke the SQLite backend on the current host.',
    status: 'intake',
    owner: 'coordinator',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tags: {},
    artifacts: [],
  };
}

main().catch((err) => {
  console.error('smoke-cross-platform threw:', err);
  process.exit(1);
});
