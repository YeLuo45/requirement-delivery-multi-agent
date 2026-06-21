/**
 * `rdma serve` — start a long-running daemon that:
 *   - exposes REST endpoints for `deliver` / `list` / `show` over HTTP
 *   - exposes a WebSocket endpoint that broadcasts pipeline events
 *   - keeps the pipeline state in storage (JSON or SQLite) so a restart
 *     picks up where it left off
 *
 * Endpoints:
 *   GET  /health             → { status: "ok", backend, wsClients }
 *   GET  /proposals          → list of summaries
 *   GET  /proposals/:id      → one proposal + audit chain
 *   GET  /inspect/:id        → JSON inspect view (handoff + audit timeline)
 *   GET  /events?proposal=…&limit=N&since-seq=M
 *                            → JSON event stream (audit-derived)
 *   POST /deliver            → { title, requirement, sourceUrl?, useLlm? }
 *                              → 202 { id, projectId, status }   (async)
 *                              → 200 { id, projectId, status, artifacts }  (sync when ?wait=1)
 *   GET  /ws                 → WebSocket; subscribes to the realtime bus
 *
 * CLI flags:
 *   --port <n>       port to listen on (default 47555)
 *   --host <ip>      bind address (default 127.0.0.1; use 0.0.0.0 for LAN)
 *   --storage <k>    json|sqlite (overrides RDMA_STORAGE env)
 *   --use-llm        wire Anthropic/OpenAI provider if API keys present
 *
 * Lifecycle: this command resolves with a promise that never settles while
 * the server is running. SIGINT / SIGTERM trigger a graceful close.
 */

import { type IncomingMessage, type ServerResponse, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Proposal } from '@rdma/core';
import { ProposalNotFoundError } from '@rdma/core';
import {
  InMemoryExporter,
  InMemoryMetrics,
  type MetricsRecorder,
  type Span,
  createTracer,
  setGlobalTracer,
} from '@rdma/observability';
import { DurableJournal, isResumeableStage } from '@rdma/persistence';
import { RealtimeServer } from '@rdma/realtime';
import { buildEventsData, buildInspectData } from './inspect.js';
import { renderMetricsText } from './metrics.js';
import { SHIPPED_ROOT, STORAGE_ROOT, buildDeps } from './run.js';

interface ParsedFlags {
  positional: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedFlags {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
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
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

interface DeliverBody {
  title: string;
  requirement: string;
  sourceUrl?: string;
  useLlm?: boolean;
}

function isDeliverBody(x: unknown): x is DeliverBody {
  if (typeof x !== 'object' || x === null) return false;
  const t = (x as { title?: unknown }).title;
  const r = (x as { requirement?: unknown }).requirement;
  return typeof t === 'string' && t.length > 0 && typeof r === 'string' && r.length > 0;
}

function sendJson(res: ServerResponse, code: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

function summarize(p: Proposal): {
  id: string;
  projectId: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  artifactCount: number;
} {
  return {
    id: p.id,
    projectId: p.projectId,
    title: p.title,
    status: p.status,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    artifactCount: p.artifacts.length,
  };
}

async function readBody(req: IncomingMessage, maxBytes = 1_000_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;
    req.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (received > maxBytes) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export interface ServeOptions {
  port: number;
  host: string;
  storage: 'json' | 'sqlite';
  useLlm: boolean;
  storageRoot?: string;
  shippedRoot?: string;
  /**
   * Internal hook for tests: inject a pre-built metrics recorder /
   * span exporter. Production callers leave this undefined and
   * startServe() allocates fresh InMemory implementations.
   */
  metrics?: MetricsRecorder;
  exporter?: InMemoryExporter;
}

export interface ServeHandle {
  port: number;
  host: string;
  httpServer: import('node:http').Server;
  realtime: RealtimeServer;
  shutdown: () => Promise<void>;
  /** Number of proposals resumed from a previous run's journal. */
  resumed: number;
  metrics: MetricsRecorder;
  exporter: InMemoryExporter;
}

export async function startServe(opts: ServeOptions): Promise<ServeHandle> {
  if (opts.storageRoot) process.env.RDMA_STORAGE_ROOT = opts.storageRoot;
  if (opts.shippedRoot) process.env.RDMA_SHIPPED_ROOT = opts.shippedRoot;

  // F5: spin up an in-memory tracer + metrics recorder and wire them
  // into the pipeline. We also push the tracer into the global
  // registry so any new Pipeline() built after this point picks up
  // the same exporter (handy for tests that want to inspect traces).
  const exporter = opts.exporter ?? new InMemoryExporter();
  const tracer = createTracer(exporter);
  setGlobalTracer(tracer);
  const metrics = opts.metrics ?? new InMemoryMetrics();

  const {
    pipeline,
    storage: store,
    audit,
    bus,
  } = await buildDeps(opts.storageRoot, { useLlm: opts.useLlm, storage: opts.storage });

  // Swap in the metrics recorder onto the live pipeline. We keep the
  // Pipeline's default noop recorder so /metrics reads from the same
  // recorder the pipeline writes into.
  pipeline.setMetrics(metrics);

  const httpServer = createServer((req, res) => {
    void handleHttp(req, res, {
      pipeline,
      storage: store,
      audit,
      bus,
      storageRoot: opts.storageRoot,
      metrics,
      exporter,
    });
  });
  const realtime = new RealtimeServer({ bus, httpServer, path: '/ws' });

  // Wire a durable journal for crash recovery. The journal appends
  // every `proposal.*` event to a per-proposal JSONL so the next
  // daemon boot can replay them to late subscribers.
  const journalRoot = opts.storageRoot ?? STORAGE_ROOT;
  const journal = new DurableJournal(journalRoot);
  await journal.init();
  const journalSub = bus.subscribe('*', async (ev) => {
    try {
      await journal.append({
        proposalId: ev.proposalId,
        projectId: ev.projectId,
        kind: ev.kind,
        at: ev.at,
        payload: ev.payload ?? {},
      });
      if (ev.kind === 'proposal.updated' && typeof ev.payload?.status === 'string') {
        if (journal.isTerminal(ev.payload.status as string)) {
          await journal.discard(ev.projectId, ev.proposalId);
        }
      }
    } catch {
      // ignore — journal is best-effort
    }
  });

  // Boot-time replay: any in-flight proposal from the previous run
  // is scheduled to resume from its current stage. The pipeline
  // already writes a `pipeline.resumed` audit entry, which the
  // journal will append like any other event.
  const resumeSummary = await bootResume(pipeline, journal, bus);
  if (resumeSummary.resumed > 0) {
    console.error(
      `[rdma] resumed ${resumeSummary.resumed} in-flight proposal(s) from previous run`,
    );
  } else if (resumeSummary.skipped > 0) {
    console.error(`[rdma] boot resume: ${resumeSummary.skipped} terminal proposal(s) skipped`);
  }
  // Capture for the unsubscribe so shutdown can clean up.
  void journalSub;

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(opts.port, opts.host, () => {
      httpServer.off('error', reject);
      resolve();
    });
  });
  const addr = httpServer.address() as AddressInfo | null;
  const boundPort = addr ? addr.port : opts.port;
  const boundHost = addr ? addr.address : opts.host;
  console.error(`[rdma] serve listening on http://${boundHost}:${boundPort}`);
  console.error('[rdma]           health:    GET  /health');
  console.error('[rdma]           list:      GET  /proposals');
  console.error('[rdma]           detail:    GET  /proposals/:id');
  console.error('[rdma]           inspect:   GET  /inspect/:id');
  console.error('[rdma]           events:    GET  /events?proposal=...&limit=...&since-seq=...');
  console.error('[rdma]           deliver:   POST /deliver {title,requirement}');
  console.error('[rdma]           realtime:  GET  /ws');
  console.error(`[rdma]           storage:   ${store.backendName}`);

  const shutdown = async (): Promise<void> => {
    try {
      await realtime.close();
    } catch {
      // ignore
    }
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  };
  return {
    port: boundPort,
    host: boundHost,
    httpServer,
    realtime,
    shutdown,
    resumed: resumeSummary.resumed,
    metrics,
    exporter,
  };
}

export async function cmdServe(argv: string[]): Promise<void> {
  const { flags } = parseArgs(argv);
  const port = Number(flags.port ?? 47555);
  const host = typeof flags.host === 'string' ? (flags.host as string) : '127.0.0.1';
  const storage = ((): 'json' | 'sqlite' => {
    const raw = typeof flags.storage === 'string' ? (flags.storage as string) : undefined;
    if (raw === 'json' || raw === 'sqlite') return raw;
    return 'json';
  })();
  const useLlm = flags['use-llm'] === true;

  const handle = await startServe({ port, host, storage, useLlm });
  console.error(`[rdma]           shipped:   ${SHIPPED_ROOT}`);

  const shutdown = async (signal: string): Promise<void> => {
    console.error(`[rdma] received ${signal}; shutting down`);
    await handle.shutdown();
    setTimeout(() => process.exit(0), 50).unref();
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  // Keep the process alive until SIGINT/SIGTERM.
  await new Promise<void>(() => undefined);
}

interface HttpCtx {
  pipeline: import('@rdma/coordinator').Pipeline;
  storage: import('@rdma/core').StorageDriver;
  audit: import('@rdma/core').AuditLog;
  bus: import('@rdma/persistence').EventBus;
  storageRoot?: string;
  metrics: MetricsRecorder;
  exporter: InMemoryExporter;
}

/**
 * Boot-time crash-recovery routine. Walks every project on disk,
 * classifies proposals by their last recorded stage, and resumes the
 * in-flight ones. Terminal proposals are skipped and their journal
 * files are discarded so the next boot stays cheap.
 */
async function bootResume(
  pipeline: import('@rdma/coordinator').Pipeline,
  journal: DurableJournal,
  bus: import('@rdma/persistence').EventBus,
): Promise<{ resumed: number; skipped: number }> {
  let resumed = 0;
  let skipped = 0;
  try {
    const projects = await pipeline.storage.listProjects();
    for (const projectId of projects) {
      const proposals = await pipeline.storage.listProposals(projectId);
      for (const p of proposals) {
        if (!isResumeableStage(p.status)) {
          await journal.discard(p.projectId, p.id);
          skipped++;
          continue;
        }
        try {
          await pipeline.resumeFromStage(p.id, p.status);
          resumed++;
        } catch {
          skipped++;
        }
      }
    }
  } catch {
    // Storage might be empty; nothing to do.
  }
  return { resumed, skipped };
}

async function handleHttp(req: IncomingMessage, res: ServerResponse, ctx: HttpCtx): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;
  const method = req.method ?? 'GET';

  if (path === '/health' && method === 'GET') {
    sendJson(res, 200, {
      status: 'ok',
      backend: ctx.storage.backendName,
      wsClients: 0, // placeholder; RealtimeServer tracks clients but we don't expose the count here
    });
    return;
  }

  if (path === '/proposals' && method === 'GET') {
    const status = url.searchParams.get('status');
    const all = await ctx.storage.listProposals();
    const filtered = status ? all.filter((p) => p.status === status) : all;
    sendJson(res, 200, filtered.map(summarize));
    return;
  }

  const detailMatch = path.match(/^\/proposals\/([A-Za-z0-9_-]+)$/);
  if (detailMatch && method === 'GET') {
    const id = detailMatch[1];
    if (id === undefined) {
      sendJson(res, 404, { error: 'proposal id missing' });
      return;
    }
    try {
      const proposal = await ctx.storage.getProposal(id);
      const chain = await ctx.audit.handoffChain(proposal.id, proposal.projectId);
      sendJson(res, 200, { ...proposal, handoffChain: chain });
    } catch (err) {
      if (err instanceof ProposalNotFoundError) {
        sendJson(res, 404, { error: 'proposal not found', id });
      } else {
        sendJson(res, 500, { error: String(err) });
      }
    }
    return;
  }

  if (path === '/deliver' && method === 'POST') {
    let body: unknown;
    try {
      body = JSON.parse(await readBody(req));
    } catch (err) {
      sendJson(res, 400, { error: `invalid JSON body: ${String(err)}` });
      return;
    }
    if (!isDeliverBody(body)) {
      sendJson(res, 400, {
        error: 'expected { title: string, requirement: string, sourceUrl?: string }',
      });
      return;
    }
    const want = url.searchParams.get('wait') === '1';
    const created = await ctx.pipeline.createProposal({
      title: body.title,
      rawRequirement: body.requirement,
      ...(body.sourceUrl !== undefined ? { sourceUrl: body.sourceUrl } : {}),
    });
    if (!want) {
      // Async: kick off the pipeline, respond immediately.
      void ctx.pipeline.runToCompletion(created).catch((err: unknown) => {
        ctx.bus.publish({
          kind: 'audit.appended',
          proposalId: created.id,
          projectId: created.projectId,
          at: new Date().toISOString(),
          payload: { error: String(err) },
        });
      });
      sendJson(res, 202, { id: created.id, projectId: created.projectId, status: created.status });
      return;
    }
    try {
      const final = await ctx.pipeline.runToCompletion(created);
      sendJson(res, 200, summarize(final));
    } catch (err) {
      sendJson(res, 500, { error: String(err), id: created.id });
    }
    return;
  }

  // /inspect/:id — JSON form of the inspect view (handoff chain + audit timeline)
  const inspectMatch = path.match(/^\/inspect\/([A-Za-z0-9_-]+)$/);
  if (inspectMatch && method === 'GET') {
    const id = inspectMatch[1];
    if (id === undefined) {
      sendJson(res, 404, { error: 'proposal id missing' });
      return;
    }
    try {
      const data = await buildInspectData(id, { storageRoot: ctx.storageRoot });
      sendJson(res, 200, data);
    } catch (err) {
      if (err instanceof Error && /not found/.test(err.message)) {
        sendJson(res, 404, { error: err.message, id });
      } else {
        sendJson(res, 500, { error: String(err) });
      }
    }
    return;
  }

  // /events?proposal=<id>&limit=N&since-seq=M — JSON event stream
  if (path === '/events' && method === 'GET') {
    const proposalId = url.searchParams.get('proposal') ?? undefined;
    const limitRaw = url.searchParams.get('limit');
    const sinceSeqRaw = url.searchParams.get('since-seq');
    const limit = limitRaw !== null ? Number(limitRaw) : 50;
    const sinceSeq = sinceSeqRaw !== null ? Number(sinceSeqRaw) : 0;
    if (Number.isNaN(limit) || limit <= 0) {
      sendJson(res, 400, { error: '--limit must be a positive integer' });
      return;
    }
    if (Number.isNaN(sinceSeq) || sinceSeq < 0) {
      sendJson(res, 400, { error: '--since-seq must be a non-negative integer' });
      return;
    }
    try {
      const data = await buildEventsData(proposalId, limit, sinceSeq, {
        storageRoot: ctx.storageRoot,
      });
      if (data.proposalNotFound) {
        sendJson(res, 404, { error: 'proposal not found', id: proposalId });
        return;
      }
      sendJson(res, 200, data);
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
    }
    return;
  }

  // /metrics — Prometheus exposition of the live metrics recorder.
  // We render directly from the in-memory recorder so the daemon
  // can serve Prometheus scrapers without any extra dependency.
  if (path === '/metrics' && method === 'GET') {
    const text = renderMetricsText(ctx.metrics.snapshot());
    res.writeHead(200, {
      'content-type': 'text/plain; version=0.0.4; charset=utf-8',
    });
    res.end(text);
    return;
  }

  // /traces?limit=N — JSON view of the most recent N spans the
  // in-memory exporter has captured. Intended for ad-hoc debug
  // dashboards; production callers should use the OTLP exporter
  // from the OtelAdapter instead.
  if (path === '/traces' && method === 'GET') {
    const limitRaw = url.searchParams.get('limit');
    const limit = limitRaw !== null ? Number(limitRaw) : 50;
    if (Number.isNaN(limit) || limit <= 0) {
      sendJson(res, 400, { error: '--limit must be a positive integer' });
      return;
    }
    const all = ctx.exporter.spans.slice(-limit);
    sendJson(res, 200, {
      count: all.length,
      spans: all.map((s: Span & Record<string, unknown>) => ({
        traceId: s.traceId,
        spanId: s.spanId,
        parentSpanId: s.parentSpanId,
        name: s.name,
        status: s.status,
        attributes: s.attributes,
        startMs: s.startMs,
        endMs: s.endMs,
      })),
    });
    return;
  }

  sendJson(res, 404, { error: 'not found', path });
}
