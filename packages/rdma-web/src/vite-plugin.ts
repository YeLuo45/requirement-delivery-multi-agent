/**
 * Vite middleware plugin: serve proposals + audit logs from .rdma/data/
 * at /api/proposals and /api/proposals/:id.
 */

import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  at: string;
  detail: Record<string, unknown>;
}

interface ControlPlanePayload {
  directions: string[];
  collaboration: string;
  cost: { proposalId: string; maxUsd: number; spentUsd: number; remainingUsd: number };
  decisions: Array<{
    role: string;
    permissions: { canRead: boolean; canComment: boolean; canModifyArtifacts: boolean };
    lease?: { expiresAt: string };
  }>;
}

async function readJsonl(filePath: string): Promise<AuditEntry[]> {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return content
      .split('\n')
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l) as AuditEntry);
  } catch {
    return [];
  }
}

function handoffChain(entries: AuditEntry[]): string[] {
  const chain: string[] = [];
  for (const e of entries) {
    if (e.actor === 'system') continue;
    if (chain[chain.length - 1] !== e.actor) chain.push(e.actor);
  }
  return chain;
}

async function readBody(req: {
  on: (event: string, handler: (chunk?: Buffer | Error) => void) => unknown;
  destroy?: () => void;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk?: Buffer | Error) => {
      if (Buffer.isBuffer(chunk)) chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', (err?: Buffer | Error) => reject(err));
  });
}

function datePrefix(date: Date): string {
  return `${date.getUTCFullYear()}${(date.getUTCMonth() + 1).toString().padStart(2, '0')}${date
    .getUTCDate()
    .toString()
    .padStart(2, '0')}`;
}

function nextSequence(ids: ReadonlyArray<string>, prefix: string): number {
  let max = 0;
  for (const id of ids) {
    if (!id.startsWith(prefix)) continue;
    const n = Number(id.slice(prefix.length));
    if (Number.isFinite(n)) max = Math.max(max, n);
  }
  return max + 1;
}

async function createLocalProposal(dataRoot: string, body: unknown) {
  if (typeof body !== 'object' || body === null) throw new Error('expected object body');
  const title = (body as { title?: unknown }).title;
  const requirement = (body as { requirement?: unknown }).requirement;
  const sourceUrl = (body as { sourceUrl?: unknown }).sourceUrl;
  if (typeof title !== 'string' || title.trim().length === 0) throw new Error('title is required');
  if (typeof requirement !== 'string' || requirement.trim().length === 0) {
    throw new Error('requirement is required');
  }

  await fs.mkdir(path.join(dataRoot, 'proposals'), { recursive: true });
  await fs.mkdir(path.join(dataRoot, 'audit'), { recursive: true });
  await fs
    .writeFile(
      path.join(dataRoot, 'meta.json'),
      JSON.stringify({ version: 1, createdAt: new Date().toISOString() }, null, 2),
      { flag: 'wx' },
    )
    .catch(() => undefined);
  const existing = await listLocalProposals(dataRoot);
  const now = new Date();
  const prefix = datePrefix(now);
  const proposalSeq = nextSequence(
    existing.map((p) => p.id),
    `P-${prefix}-`,
  );
  const projectSeq = nextSequence(
    existing.map((p) => p.projectId),
    `PRJ-${prefix}-`,
  );
  const timestamp = now.toISOString();
  const proposal = {
    id: `P-${prefix}-${proposalSeq.toString().padStart(3, '0')}`,
    projectId: `PRJ-${prefix}-${projectSeq.toString().padStart(3, '0')}`,
    title: title.trim(),
    rawRequirement: requirement.trim(),
    ...(typeof sourceUrl === 'string' && sourceUrl.trim().length > 0
      ? { sourceUrl: sourceUrl.trim() }
      : {}),
    status: 'research_direction_pending',
    owner: null,
    clarificationRound: 0,
    artifacts: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    tags: {},
  };
  const proposalDir = path.join(dataRoot, 'proposals', proposal.projectId);
  await fs.mkdir(proposalDir, { recursive: true });
  await fs.writeFile(
    path.join(proposalDir, `${proposal.id}.json`),
    JSON.stringify(proposal, null, 2),
  );
  const auditDir = path.join(dataRoot, 'audit', proposal.projectId);
  await fs.mkdir(auditDir, { recursive: true });
  await fs.appendFile(
    path.join(auditDir, `${proposal.id}.jsonl`),
    `${JSON.stringify({
      id: `audit-${Date.now()}`,
      proposalId: proposal.id,
      projectId: proposal.projectId,
      actor: 'system',
      action: 'proposal.create',
      at: timestamp,
      detail: { title: proposal.title, status: proposal.status, projectId: proposal.projectId },
    })}\n`,
    'utf8',
  );
  return proposal;
}

async function listLocalProposals(
  dataRoot: string,
): Promise<Array<{ id: string; projectId: string; createdAt: string }>> {
  const proposals: Array<{ id: string; projectId: string; createdAt: string }> = [];
  const projects = await fs.readdir(path.join(dataRoot, 'proposals')).catch(() => []);
  for (const pid of projects) {
    const dir = path.join(dataRoot, 'proposals', pid);
    const files = await fs.readdir(dir).catch(() => []);
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const content = await fs.readFile(path.join(dir, f), 'utf8');
      proposals.push(JSON.parse(content));
    }
  }
  proposals.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return proposals;
}

export function rdmaApiPlugin(dataRoot: string): Plugin {
  return {
    name: 'rdma-api',
    configureServer(server) {
      server.middlewares.use('/api/proposals/create', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'method not allowed' }));
          return;
        }
        try {
          const raw = await readBody(req as never);
          const proposal = await createLocalProposal(dataRoot, JSON.parse(raw));
          res.statusCode = 201;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(proposal));
        } catch (err) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
      });

      server.middlewares.use('/api/control-plane/cost', async (req, res) => {
        try {
          const { parseLedgerFromDisk, loadLedgerFromStorage, renderControlPlanePanel } =
            await import('@rdma/delivery-control');
          const proposalId = req.url?.split('?')[0]?.split('/').pop();
          const ledgerPath = proposalId
            ? path.join(dataRoot, 'ledgers', `${proposalId}.ledger.json`)
            : null;
          const snapshot =
            ledgerPath && existsSync(ledgerPath)
              ? loadLedgerFromStorage(parseLedgerFromDisk(ledgerPath))
              : { proposalId: 'panel', maxUsd: 1, spentUsd: 0, remainingUsd: 1, records: [] };
          const text = renderControlPlanePanel({
            metrics: { counters: { rdma_cost_records: snapshot.records.length } },
            snapshot,
            mode: 'prom',
          });
          res.setHeader('Content-Type', 'text/plain; version=0.0.4');
          res.end(text);
        } catch (err) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
      });

      server.middlewares.use('/api/control-plane/panel', async (_req, res) => {
        try {
          const { formatCollaborationPanel } = await import('@rdma/delivery-control');
          const payload: ControlPlanePayload = {
            directions: [
              'A:delivery-sandbox',
              'B:collaboration',
              'C:tool-governance',
              'D:cost-router',
            ],
            collaboration: formatCollaborationPanel([
              {
                allowed: true,
                role: 'viewer',
                reason: 'seed',
                permissions: { canRead: true, canComment: false, canModifyArtifacts: false },
                lease: {
                  holderId: 'seed',
                  proposalId: 'panel',
                  expiresAt: '1970-01-01T00:00:00.000Z',
                },
              },
            ]),
            cost: { proposalId: 'panel', maxUsd: 1, spentUsd: 0, remainingUsd: 1 },
            decisions: [
              {
                role: 'viewer',
                permissions: { canRead: true, canComment: false, canModifyArtifacts: false },
                lease: { expiresAt: '1970-01-01T00:00:00.000Z' },
              },
            ],
          };
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(payload));
        } catch (err) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
      });

      server.middlewares.use('/api/config', async (_req, res) => {
        try {
          const { loadAgentConfig } = await import('@rdma/config');
          // `dataRoot` is `.rdma/data`; agent config lives at `.rdma/`.
          const configRoot = dataRoot.replace(/\/data$/, '');
          const configs = await loadAgentConfig({ root: configRoot });
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(configs));
        } catch (err) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
      });

      server.middlewares.use('/api/proposals', async (_req, res) => {
        try {
          const proposals: unknown[] = [];
          const projects = await fs.readdir(path.join(dataRoot, 'proposals')).catch(() => []);
          for (const pid of projects) {
            const dir = path.join(dataRoot, 'proposals', pid);
            const files = await fs.readdir(dir).catch(() => []);
            for (const f of files) {
              if (!f.endsWith('.json')) continue;
              const content = await fs.readFile(path.join(dir, f), 'utf8');
              proposals.push(JSON.parse(content));
            }
          }
          proposals.sort((a: unknown, b: unknown) => {
            const ax = (a as { createdAt: string }).createdAt;
            const bx = (b as { createdAt: string }).createdAt;
            return bx.localeCompare(ax);
          });
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(proposals));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(err) }));
        }
      });

      server.middlewares.use('/api/proposals/', async (req, res) => {
        const id = req.url?.split('?')[0]?.replace(/^\/+/, '');
        if (!id) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'missing id' }));
          return;
        }
        try {
          // Search all project directories for the proposal id.
          const projects = await fs.readdir(path.join(dataRoot, 'proposals')).catch(() => []);
          let proposal: Record<string, unknown> | null = null;
          let projectId: string | null = null;
          for (const pid of projects) {
            const candidate = path.join(dataRoot, 'proposals', pid, `${id}.json`);
            try {
              const content = await fs.readFile(candidate, 'utf8');
              proposal = JSON.parse(content);
              projectId = pid;
              break;
            } catch {
              // not in this project
            }
          }
          if (!proposal || !projectId) {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: 'not found' }));
            return;
          }
          const auditPath = path.join(dataRoot, 'audit', projectId, `${id}.jsonl`);
          const audit = await readJsonl(auditPath);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ proposal, audit, handoffChain: handoffChain(audit) }));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(err) }));
        }
      });
    },
  };
}
