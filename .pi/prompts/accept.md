---
description: Boss acceptance — final approval before deployment.
argument-hint: "<proposal-id>"
---

Mark a proposal as accepted by the boss agent.

In v0.1 the boss agent auto-approves on entry to the `accepted` stage. To
customize the acceptance gate:

1. Edit `packages/rdma-boss/src/agent.ts` — the `accepted` case.
2. Replace the auto-approve with a real prompt or environment-supplied
   decision file.

## Steps

```bash
npm run cli -- show <proposal-id>
```

The acceptance_decision artifact (kind) marks the boss's decision.