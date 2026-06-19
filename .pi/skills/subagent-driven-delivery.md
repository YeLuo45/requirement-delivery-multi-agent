---
name: subagent-driven-delivery
description: How to drive a proposal through the full RDMA pipeline.
---

This skill is the canonical workflow for running a requirement through the
7-agent state machine.

## Step 1: Create the proposal

```bash
cd /path/to/requirement-delivery-multi-agent
npm run cli -- deliver "<title>" --requirement "<text>" [--url "<src>"]
```

The CLI calls `Pipeline.runToCompletion()`, which drives the proposal
through every remaining step until it reaches `delivered`.

## Step 2: Inspect the result

```bash
npm run cli -- show <proposal-id>
```

Look for:

- `status: delivered` — terminal state reached
- 8–9 artifacts attached (research brief + prd + plan + test plan +
  implementation + test report + deployment record, plus the coordinator
  intake form and possibly a design spec)
- A clean handoff chain with each agent appearing exactly once

## Step 3: Verify the artifacts

```bash
# Each artifact's content is rendered in `show` output.
# Sanity-check the PRD against the raw requirement.
# Sanity-check the implementation against the test plan.
```

## Step 4: Promote or rollback

The default v0.1 flow auto-progresses through every agent. If you need to
gate at the boss step:

1. Edit `packages/rdma-boss/src/agent.ts` — the `accepted` case should
   return `{ kind: 'block', reason: 'awaiting human approval' }`.
2. Re-run the proposal. It will stop at `accepted`.
3. Inspect, approve, then call `pipeline.step()` again to advance to `deployed`.

## Anti-patterns

- Do NOT call individual agents directly. Always use the Pipeline.
- Do NOT mutate `proposal.status` by hand — it bypasses the audit log.
- Do NOT skip the PM stage. Even "trivial" proposals benefit from a PRD.