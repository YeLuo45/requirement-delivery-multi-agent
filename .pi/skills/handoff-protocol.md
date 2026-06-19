---
name: handoff-protocol
description: How agents hand work off to each other in RDMA.
---

Agents in RDMA never call each other directly. They emit a `HandoffEvent`
(or a `TransitionEvent`) and let the coordinator's `Pipeline.step()` walk
the state machine.

## Three event shapes

1. **`{ kind: 'transition', nextStage, reason, artifact? }`**
   Stay in the same agent's ownership. Used for advancing within the
   agent's own scope (e.g. pm moves from `clarifying` to `prd_pending_confirmation`).

2. **`{ kind: 'handoff', to, reason, artifact? }`**
   Move to a stage owned by a different agent. Used for handing off to
   the next agent in the pipeline (e.g. pm → dev at `approved_for_dev`).

3. **`{ kind: 'block', reason, artifact? }`**
   Do not transition. Used when the agent needs external input (e.g.
   boss agent waiting for human approval). In v0.1 this is rare — most
   blocks are simulated with auto-advance.

## Rules

- Never emit a transition that `state-machine.ts` would reject. Use
  `assertValidTransition` if you need to check before emitting.
- Always include `reason` — this becomes the audit log entry's detail.
- Always include `artifact` if you produced work in this step — it gets
  attached to the proposal before the transition.

## Reference

- State machine: `packages/rdma-core/src/state-machine.ts`
- Handoff helper: `packages/rdma-core/src/handoff.ts` (`emitHandoff`)
- Pipeline driver: `packages/rdma-coordinator/src/agent.ts` (`Pipeline.step`)