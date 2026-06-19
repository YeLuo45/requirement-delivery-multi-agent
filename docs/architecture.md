# Architecture

## High-level

```
                ┌──────────────────────────────────────────────┐
                │                CLI / Web / MCP                │
                │  (entry points that talk to the coordinator) │
                └────────────────────┬─────────────────────────┘
                                     │
                                     ▼
                ┌──────────────────────────────────────────────┐
                │         Pipeline  (rdma-coordinator)         │
                │  - holds AgentRegistry                       │
                │  - drives step() until status=delivered      │
                │  - writes audit log on every transition      │
                └────────────────────┬─────────────────────────┘
                                     │
            ┌────────────────────────┼────────────────────────────┐
            ▼                        ▼                            ▼
   ┌────────────────┐       ┌────────────────┐          ┌────────────────┐
   │ market_research│       │     pm         │          │     qa        │
   │ coordinator    │       │     dev        │          │    boss       │
   │ designer       │       └────────────────┘          └────────────────┘
   └────────────────┘
                                     │
                                     ▼
                ┌──────────────────────────────────────────────┐
                │           rdma-core (state machine)          │
                │  - STATUS_TRANSITIONS, OWNERSHIP            │
                │  - Storage (.rdma/data/)                    │
                │  - AuditLog (.rdma/audit/)                   │
                │  - HandoffLog / emitHandoff                  │
                └──────────────────────────────────────────────┘
```

## Layering

| Layer | Package | What it owns |
|---|---|---|
| Entry | `rdma-cli`, `rdma-web`, `rdma-mcp-server` | Talk to humans / external agents |
| Pipeline | `rdma-coordinator` | Walks the state machine one step at a time |
| Agents | `rdma-research`, `rdma-designer`, `rdma-pm`, `rdma-dev`, `rdma-qa`, `rdma-boss` | Each owns 1–3 stages; emit handoffs |
| Core | `rdma-core` | State machine, storage, audit log, handoff |

The dependencies flow strictly downward:

```
entry → coordinator → agents → core
                            ↘  ↗
```

`core` depends on nothing. `agents` depend only on `core`. The coordinator
depends on `core` and orchestrates agents. Entry points depend on everything.

## Why monorepo

Three reasons:

1. **State machine + ownership stay in lockstep.** The `STAGES`,
   `STATUS_TRANSITIONS`, and `OWNERSHIP` tables in `core/state-machine.ts`
   must match what every agent declares in its `scope` array. In a
   multi-repo setup this drifts; in a monorepo it doesn't.
2. **Type sharing without overhead.** `Proposal`, `Artifact`, `Agent`,
   `AgentContext` etc. are imported from `@rdma/core`. No duplicated
   type definitions, no risk of drift.
3. **End-to-end testability.** `scripts/e2e-hello-world.test.ts` exercises
   a real proposal through every agent. In a multi-repo setup that test
   would need a complicated fixture story.

## Data flow per step

```
Pipeline.step(proposal)
  ├── audit.record(agent.handle.start)
  ├── result = agent.handle(ctx)
  ├── audit.record(agent.handle.end)
  └── if result.kind === 'handoff':
        emitHandoff({ proposal, to: result.to, ... })
          ├── assertValidTransition(proposal.status, targetStage)
          ├── storage.saveProposal(nextProposal)
          └── audit.record(handoff.emit)
      elif result.kind === 'transition':
        transition(proposal, result.nextStage)
          + storage.saveProposal(nextProposal)
          + audit.record(stage.transition)
      elif result.kind === 'block':
        (record artifact if any, but no transition)
```

## Storage layout

```
.rdma/
├── data/
│   ├── meta.json                                    # schema version
│   ├── proposals/<PRJ-id>/<P-id>.json               # proposal state
│   └── audit/<PRJ-id>/<P-id>.jsonl                  # append-only audit
└── shipped/<PRJ-id>/<P-id>.json                     # deployment records
```

The `STORAGE_ROOT` walks up from cwd looking for a `package.json` with
`workspaces`. Override via `RDMA_STORAGE_ROOT` env var.

## Why JSON + JSONL instead of SQLite

- Zero external dependencies.
- The web dashboard reads files directly via Vite middleware — no API server.
- A tarball of `.rdma/data/` is a complete snapshot of the system.
- Easy to inspect / grep / debug.

Trade-off: no atomic transactions. Concurrent writers race. For v0.1 this
is fine because the CLI is single-process. For v0.2 swap in SQLite behind
the `Storage` interface.

## Failure modes

1. **Agent returns `block` indefinitely** — `Pipeline.runToCompletion()`
   detects this (no transition in a step) and throws. The caller can
   inspect and resume.
2. **State machine rejects a transition** — `assertValidTransition` throws
   `InvalidTransitionError`. This means an agent tried to skip a stage.
3. **Audit log write fails** — `Storage.appendAudit` errors propagate. The
   proposal save succeeds but the audit log is incomplete. v0.2 should
   make these atomic.
4. **Boss agent hangs forever** — `runToCompletion` has a `maxSteps`
   safety brake (default 100). Increase via `pipeline.runToCompletion(p, 500)`
   if needed.

## Extension points

- **New agent** — add to `AGENT_IDS` in `core/types.ts`, define stages +
  ownership in `core/state-machine.ts`, create `packages/rdma-<id>/src/agent.ts`,
  register in `buildDeps()` in `cli/src/run.ts`.
- **New artifact kind** — add to `ARTIFACT_KINDS` in `core/types.ts`,
  produce in the relevant agent.
- **New stage** — add to `STAGES`, set ownership, update `STATUS_TRANSITIONS`,
  add a test that walks the new edges.
- **Real LLM provider** — swap the agent factory implementations. The
  `Agent` interface stays the same.