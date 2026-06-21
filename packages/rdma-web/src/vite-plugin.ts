/**
 * Vite middleware plugin: serve proposals + audit logs from .rdma/data/
 * at /api/proposals and /api/proposals/:id.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  at: string;
  detail: Record<string, unknown>;
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

export function rdmaApiPlugin(dataRoot: string): Plugin {
  return {
    name: 'rdma-api',
    configureServer(server) {
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
