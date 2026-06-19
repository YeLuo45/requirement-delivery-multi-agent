---
description: Render the implementation plan for a proposal.
argument-hint: "<proposal-id>"
---

Show the latest implementation plan for a proposal.

## Steps

```bash
npm run cli -- show <proposal-id>
```

The implementation plan is the artifact with kind `plan`, produced by the
PM agent when a proposal enters the `approved_for_dev` stage.

## Editing the plan

In v0.1 the plan is generated automatically. To customize:

1. Edit `packages/rdma-pm/src/agent.ts` — `renderPlan()` function.
2. Re-run the proposal.

## Next commands

- `/implement` — start the dev agent against the plan
- `/test` — run QA against the implementation