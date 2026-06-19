---
description: Walk a proposal through the clarification stage with the PM agent.
argument-hint: "<proposal-id>"
---

Run a clarification round on a proposal that is in the `clarifying` stage.

## Steps

1. Load the proposal:
   ```bash
   npm run cli -- show <proposal-id>
   ```
2. Identify ambiguities in the PRD artifact (kind: `prd`).
3. Append an inline Q&A as new tags:
   ```bash
   # Not yet automated in v0.1 — manual Q&A in the proposal comments.
   # See docs/workflows.md for the v0.2 plan.
   ```
4. Advance the proposal:
   ```bash
   # Pipeline.step is exposed as the MCP tool rdma.step
   ```

## Notes

The PM agent in v0.1 auto-advances after one clarification round. To exercise
multiple rounds, see `scripts/e2e-hello-world.test.ts` — the QA rework loop
test demonstrates a multi-round handoff pattern.

## Next commands

- `/prd` — render the updated PRD
- `/plan` — render the implementation plan