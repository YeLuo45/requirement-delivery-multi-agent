---
description: Render the PRD artifact for a proposal.
argument-hint: "<proposal-id>"
---

Show the latest PRD artifact for a proposal.

## Steps

```bash
npm run cli -- show <proposal-id>
```

The PRD is the artifact with kind `prd`. If the proposal has not yet reached
the `prd_pending_confirmation` stage, this command will show that no PRD
exists yet.

## Editing the PRD

In v0.1 the PRD is generated automatically by the PM agent. To customize:

1. Edit `packages/rdma-pm/src/agent.ts` — `renderPRD()` function.
2. Re-run the proposal: `npm run cli -- deliver "..." --requirement "..."`.
3. The PRD will reflect your changes on the next run.

A future v0.2 will allow editing the PRD inline and re-running the
pipeline from that point.