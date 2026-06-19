---
name: verification-before-completion
description: How to verify a proposal is actually delivered before reporting success to the user.
---

A proposal that reaches `delivered` is not automatically a successful
delivery. Before reporting to the user, run the verification checklist.

## Checklist

1. **Status is `delivered`** — `npm run cli -- show <id>` → check `status` field.
2. **Handoff chain is complete** — every agent that owns a stage ran.
3. **Every artifact has non-empty content** — `a.content.length > 0`.
4. **The deployment record exists on disk**:
   ```bash
   cat .rdma/shipped/<project-id>/<proposal-id>.json
   ```
5. **The PRD reflects the original requirement** — eyeball `prd` artifact
   against `rawRequirement` in the proposal.
6. **The test report is `QA PASS:`** — not `QA FAIL:`.

## If any check fails

- **Status is not `delivered`** → re-run `pipeline.runToCompletion(proposal)`.
  The pipeline will continue from the current stage.
- **Handoff chain is incomplete** → an agent short-circuited. Inspect the
  audit log for missing `agent.handle.start` entries.
- **Empty artifact** → the agent that produced it short-circuited.
  See `packages/<agent>/src/agent.ts`.
- **Deployment record missing** → the boss agent failed mid-deploy.
  Re-run; the boss agent's `deployed` case is idempotent.
- **PRD drifted** → edit `renderPRD()` and re-run.
- **Test report is FAIL** → this is the QA rework loop. Inspect the
  `implementation` artifact, fix it, and re-run.