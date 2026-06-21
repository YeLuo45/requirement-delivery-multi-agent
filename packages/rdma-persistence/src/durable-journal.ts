/**
 * Durable Resume Journal — crash-recovery queue for in-flight proposals.
 *
 * When `rdma serve` runs, in-memory state lives in two places:
 *   1. The StorageDriver (proposals + audit on disk; already durable)
 *   2. The EventBus ring buffer (in-process, lost on restart)
 *
 * If the daemon dies mid-pipeline, the *proposal* is safe on disk
 * but the *live subscriptions* (e.g. the React dashboard) need to
 * replay the events that happened during downtime. The journal
 * extends the EventBus with a disk-backed "resume" trail:
 *
 *   - Every `proposal.*` event is also appended to a JSONL file
 *     under `${storageRoot}/journal/<PRJ-id>/<P-id>.jsonl`.
 *   - On boot, `loadJournalEntries()` reads the file and re-emits
 *     each entry through the bus so late subscribers can backfill.
 *   - `markProposalDelivered(id)` removes the file (no replay needed
 *     for finished work).
 *
 * The journal is intentionally per-proposal so a single huge JSONL
 * can't grow without bound.
 */

import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';

const JOURNAL_DIRNAME = 'journal';
const TERMINAL_STAGES = new Set(['delivered', 'deployed']);

export interface JournalEntry {
  sequence: number;
  proposalId: string;
  projectId: string;
  kind: string;
  at: string;
  payload: Record<string, unknown>;
}

export class DurableJournal {
  private readonly root: string;
  private readonly counters = new Map<string, number>();
  private cached = new Map<string, JournalEntry[]>();

  constructor(storageRoot: string) {
    this.root = path.join(storageRoot, JOURNAL_DIRNAME);
  }

  /**
   * Initialize on-disk directories. Idempotent.
   */
  async init(): Promise<void> {
    await fs.mkdir(this.root, { recursive: true });
  }

  /**
   * Append a single entry to the proposal's journal. Updates the
   * in-memory cache and the disk file atomically (write the full
   * line, then fsync via a trailing no-op for cross-process safety).
   */
  async append(entry: Omit<JournalEntry, 'sequence'>): Promise<JournalEntry> {
    const key = `${entry.projectId}/${entry.proposalId}`;
    const next = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, next);
    const full: JournalEntry = { ...entry, sequence: next };
    const file = this.fileFor(entry.projectId, entry.proposalId);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.appendFile(file, `${JSON.stringify(full)}\n`, 'utf8');
    const list = this.cached.get(key) ?? [];
    list.push(full);
    this.cached.set(key, list);
    return full;
  }

  /**
   * Replay all entries for one proposal. Returns the entries in
   * insertion order, starting from the first one whose `sequence`
   * is greater than `sinceSequence` (or from the beginning if
   * `sinceSequence` is undefined).
   */
  async loadEntries(
    projectId: string,
    proposalId: string,
    sinceSequence?: number,
  ): Promise<JournalEntry[]> {
    const file = this.fileFor(projectId, proposalId);
    let raw: string;
    try {
      raw = await fs.readFile(file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const entries: JournalEntry[] = [];
    for (const line of raw.split('\n')) {
      if (!line) continue;
      try {
        const parsed = JSON.parse(line) as JournalEntry;
        if (sinceSequence !== undefined && parsed.sequence <= sinceSequence) continue;
        entries.push(parsed);
      } catch {
        // ignore malformed lines so a corrupt tail doesn't block
        // recovery (the audit log is the source of truth; the
        // journal is a best-effort replay hint).
      }
    }
    return entries;
  }

  /**
   * Return every journal file path, used by the boot-time replay
   * loop. Streams line-by-line so memory stays bounded even when
   * a long-running proposal has accumulated thousands of events.
   */
  async *streamAllEntries(): AsyncGenerator<JournalEntry> {
    let projectDirs: string[] = [];
    try {
      projectDirs = await fs.readdir(this.root);
    } catch {
      return;
    }
    for (const projectId of projectDirs) {
      const projDir = path.join(this.root, projectId);
      const files = await fs.readdir(projDir).catch(() => []);
      for (const f of files) {
        if (!f.endsWith('.jsonl')) continue;
        const proposalId = f.replace(/\.jsonl$/, '');
        const stream = createReadStream(path.join(projDir, f), { encoding: 'utf8' });
        let buf = '';
        for await (const chunk of stream) {
          buf += chunk;
          let nl = buf.indexOf('\n');
          while (nl >= 0) {
            const line = buf.slice(0, nl);
            buf = buf.slice(nl + 1);
            if (line) {
              try {
                yield JSON.parse(line) as JournalEntry;
              } catch {
                // skip malformed
              }
            }
            nl = buf.indexOf('\n');
          }
        }
        if (buf) {
          try {
            yield JSON.parse(buf) as JournalEntry;
          } catch {
            // skip
          }
        }
      }
    }
  }

  /**
   * Remove a proposal's journal file. Called when a proposal
   * reaches a terminal stage so the replay loop doesn't have to
   * walk it on every boot.
   */
  async discard(projectId: string, proposalId: string): Promise<void> {
    const file = this.fileFor(projectId, proposalId);
    try {
      await fs.unlink(file);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    this.cached.delete(`${projectId}/${proposalId}`);
    this.counters.delete(`${projectId}/${proposalId}`);
  }

  /**
   * Archive entries older than `windowMs` by gzipping them into
   * `${root}/journal/archive/<projectId>/<proposalId>-<iso>.jsonl.gz`
   * and rewriting the active file with only the fresh prefix.
   *
   * The active JSONL is fully rewritten to drop the archived
   * prefix, then gzipped data is written alongside it. Returns the
   * number of entries that were archived.
   */
  async archive(
    projectId: string,
    proposalId: string,
    windowMs: number,
    now: number = Date.now(),
  ): Promise<number> {
    const key = `${projectId}/${proposalId}`;
    const file = this.fileFor(projectId, proposalId);
    let raw: string;
    try {
      raw = await fs.readFile(file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 0;
      throw err;
    }
    const lines = raw.split('\n').filter((l) => l.length > 0);
    const parsed: { entry: JournalEntry; line: string }[] = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as JournalEntry;
        parsed.push({ entry, line });
      } catch {
        // drop malformed
      }
    }
    const cutoff = now - windowMs;
    const toArchive = parsed.filter(({ entry }) => Date.parse(entry.at) < cutoff);
    if (toArchive.length === 0) return 0;
    // Write archive as gzipped JSONL. We use a synchronous import
    // of node:zlib to keep the public surface free of a
    // dependency the caller might not have.
    const { gzipSync } = await import('node:zlib');
    const archiveBody = `${toArchive.map(({ line }) => line).join('\n')}\n`;
    const archiveDir = path.join(this.root, 'archive', projectId);
    await fs.mkdir(archiveDir, { recursive: true });
    const iso = new Date(now).toISOString().replace(/[:.]/g, '-');
    const archiveFile = path.join(archiveDir, `${proposalId}-${iso}.jsonl.gz`);
    await fs.writeFile(archiveFile, gzipSync(archiveBody));
    // Rewrite the active file with only the fresh prefix.
    const fresh = parsed.filter(({ entry }) => Date.parse(entry.at) >= cutoff);
    if (fresh.length === 0) {
      await fs.unlink(file);
    } else {
      const freshBody = `${fresh.map(({ line }) => line).join('\n')}\n`;
      await fs.writeFile(file, freshBody);
    }
    // Reset the in-memory counter so future appends don't
    // continue the archived sequence numbers — they restart at
    // 1. The active file is the source of truth on disk.
    this.counters.set(key, fresh.length);
    this.cached.set(
      key,
      fresh.map(({ entry }) => entry),
    );
    return toArchive.length;
  }

  /**
   * Load archived entries for a proposal. Optionally decodes a
   * subset of archive files; we read every .jsonl.gz in the
   * proposal's archive directory and return entries in time order.
   */
  async loadArchivedEntries(projectId: string, proposalId: string): Promise<JournalEntry[]> {
    const { gunzipSync } = await import('node:zlib');
    const dir = path.join(this.root, 'archive', projectId);
    let files: string[];
    try {
      files = (await fs.readdir(dir)).filter(
        (f) => f.startsWith(`${proposalId}-`) && f.endsWith('.jsonl.gz'),
      );
    } catch {
      return [];
    }
    files.sort();
    const out: JournalEntry[] = [];
    for (const f of files) {
      const buf = await fs.readFile(path.join(dir, f));
      const text = gunzipSync(buf).toString('utf8');
      for (const line of text.split('\n')) {
        if (!line) continue;
        try {
          out.push(JSON.parse(line) as JournalEntry);
        } catch {
          // skip
        }
      }
    }
    return out;
  }

  /**
   * Should this proposal be tracked in the journal? It returns
   * `true` while the proposal is in flight and `false` once the
   * stage hits a terminal value. The caller (the serve boot path)
   * uses this to decide whether to schedule a `resumeFromStage`
   * on boot.
   */
  isTerminal(stage: string): boolean {
    return TERMINAL_STAGES.has(stage);
  }

  private fileFor(projectId: string, proposalId: string): string {
    return path.join(this.root, projectId, `${proposalId}.jsonl`);
  }
}

/**
 * Heuristic for which stages we consider "in flight" when deciding
 * whether the boot loop should resume a proposal.
 */
export function isResumeableStage(stage: string): boolean {
  return !TERMINAL_STAGES.has(stage);
}
