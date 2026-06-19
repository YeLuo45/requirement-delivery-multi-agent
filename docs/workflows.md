# Workflows

## End-to-end: deliver a requirement

The most common workflow. From raw requirement to delivered artifact.

```bash
# 1. Deliver
npm run cli -- deliver "JSON to CSV CLI" \
  --requirement "Convert a JSON array of objects to CSV." \
  --priority P2

# 2. Watch the artifact log
# (already shown by the CLI; saved to .rdma/data/proposals/...)

# 3. Inspect
npm run cli -- show P-YYYYMMDD-NNN
npm run cli -- list
npm run cli -- status

# 4. (Optional) Web dashboard
npm run dev:web    # http://localhost:5173
```

## Via MCP server

The MCP server exposes the same operations as tools. Use it from any MCP
client (Claude Code, Cursor, etc.):

```json
{
  "mcpServers": {
    "rdma": {
      "command": "npm",
      "args": ["run", "start", "--workspace=@rdma/mcp-server"],
      "cwd": "/path/to/requirement-delivery-multi-agent"
    }
  }
}
```

Available tools: `rdma.deliver`, `rdma.list`, `rdma.show`, `rdma.status`,
`rdma.step`, `rdma.reset`.

## Step-by-step (manual)

For finer-grained control:

```ts
import { AgentRegistry, AuditLog, Storage } from '@rdma/core';
import { Pipeline, createCoordinatorAgent } from '@rdma/coordinator';
import { createResearchAgent } from '@rdma/research';
// ... etc

const storage = new Storage({ root: '.rdma/data' });
await storage.init();
const audit = new AuditLog(storage);

const registry = new AgentRegistry();
registry.register(createResearchAgent());
registry.register(createCoordinatorAgent());
registry.register(createDesignerAgent());
registry.register(createPmAgent());
registry.register(createDevAgent());
registry.register(createQaAgent());
registry.register(createBossAgent());

const pipeline = new Pipeline({ registry, storage, audit });

// Create + walk manually
let p = await pipeline.createProposal({ title, rawRequirement });
while (p.status !== 'delivered') {
  p = await pipeline.step(p);
  // inspect, gate, log, etc.
}
```

## Rework loop (QA fail → dev fix → QA re-test)

The QA agent can be configured to fail on demand (`forceFailure: true`).
The e2e test exercises this:

```ts
// Start with a passing QA
registry.register(createQaAgent());

// Mid-pipeline, swap to a failing QA before first QA call
registry.replace(createQaAgent({ forceFailure: true }));

// After dev fixes, swap back to passing QA
registry.replace(createQaAgent({ forceFailure: false }));
```

This produces two `test_report` artifacts (one FAIL, one PASS) in the
proposal.

## Bootstrapping fresh data

```bash
npm run cli -- reset --yes    # wipe .rdma
npm run cli -- demo           # seed 3 sample proposals
```

## Inspecting the audit log

The audit log is JSONL — one entry per line:

```bash
cat .rdma/audit/<PRJ-id>/<P-id>.jsonl
```

Each entry has:

```json
{
  "id": "...",
  "proposalId": "P-...",
  "actor": "pm",
  "action": "stage.transition",
  "at": "2026-06-19T01:42:01.539Z",
  "detail": { "from": "clarifying", "to": "prd_pending_confirmation", "reason": "..." }
}
```

Actions include: `proposal.create`, `stage.transition`, `artifact.append`,
`handoff.emit`, `agent.handle.start`, `agent.handle.end`, `qa.failure`,
`boss.accept`.

## Web dashboard architecture

The dashboard is a Vite-served React SPA. Vite middleware (`rdmaApiPlugin`)
serves two API endpoints:

- `GET /api/proposals` — list of all proposals (newest first)
- `GET /api/proposals/:id` — full proposal + audit log + handoff chain

In production, swap the middleware for a websocket / SSE feed that pushes
audit entries as they happen. v0.1 just polls on page load.