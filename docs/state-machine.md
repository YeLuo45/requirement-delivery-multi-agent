# State machine

## Stages

```
research_direction_pending → research → intake → ideation → clarifying
  → prd_pending_confirmation → approved_for_dev → in_tdd_test → in_dev
  → in_test_acceptance ⇄ test_failed → accepted → deployed → delivered
```

14 stages total. `delivered` is the only terminal stage.

## Ownership table

| Stage | Owning agent |
|---|---|
| `research_direction_pending` | `market_research` |
| `research` | `market_research` |
| `intake` | `coordinator` |
| `ideation` | `designer` |
| `clarifying` | `pm` |
| `prd_pending_confirmation` | `pm` |
| `approved_for_dev` | `pm` |
| `in_tdd_test` | `dev` |
| `in_dev` | `dev` |
| `in_test_acceptance` | `qa` |
| `test_failed` | `qa` |
| `accepted` | `boss` |
| `deployed` | `boss` |
| `delivered` | `boss` |

## Transition table

Adjacency list (every valid edge). Source: `packages/rdma-core/src/state-machine.ts`.

| From | To (any of) |
|---|---|
| `research_direction_pending` | `research` |
| `research` | `intake`, `research_direction_pending` |
| `intake` | `ideation`, `clarifying` |
| `ideation` | `clarifying` |
| `clarifying` | `clarifying` (loop), `prd_pending_confirmation` |
| `prd_pending_confirmation` | `approved_for_dev`, `clarifying` (rollback) |
| `approved_for_dev` | `in_tdd_test` |
| `in_tdd_test` | `in_dev`, `approved_for_dev` (re-anchor) |
| `in_dev` | `in_test_acceptance`, `in_tdd_test` (test failure re-entry) |
| `in_test_acceptance` | `accepted`, `test_failed` |
| `test_failed` | `in_test_acceptance` (re-test), `in_dev` (back to dev) |
| `accepted` | `deployed`, `in_dev` (rollback) |
| `deployed` | `delivered`, `in_test_acceptance` (hotfix) |
| `delivered` | (terminal) |

## Why these edges exist

- **`research → research_direction_pending`** — if the research brief reveals
  the requirement is too vague, send back for direction.
- **`intake → ideation` vs `intake → clarifying`** — UI work routes through
  designer first; non-UI work goes straight to PM. The coordinator decides.
- **`clarifying → clarifying`** — clarification can loop multiple rounds.
- **`prd_pending_confirmation → clarifying`** — boss asks for revisions.
- **`in_tdd_test → approved_for_dev`** — if test design reveals scope issues,
  re-anchor with the PM.
- **`in_dev → in_tdd_test`** — test failures discovered during impl re-enter TDD.
- **`test_failed → in_test_acceptance`** — after dev fixes, re-run QA.
- **`accepted → in_dev`** — boss rollback if needed post-acceptance.
- **`deployed → in_test_acceptance`** — production hotfix path.

## Sanity tests

Every stage + transition + ownership is exercised in `state-machine.test.ts`:

- `validateRoster()` — every agent owns at least one stage; every stage has
  a valid owner.
- `findPath(from, to)` — returns a valid path or null.
- `isValidTransition(from, to)` — membership check; throws on self-loops.
- `assertValidTransition(from, to)` — throws `InvalidTransitionError` on
  invalid edges.

## How to add a new stage

1. Add to `STAGES` in `core/types.ts`.
2. Update `STATUS_TRANSITIONS` in `core/state-machine.ts` — at minimum, give
   it incoming edges from the stages that should be able to reach it, and
   outgoing edges to the stages it should reach.
3. Update `OWNERSHIP` to map it to an agent id.
4. Add a test in `state-machine.test.ts` that walks every new edge.
5. Update the e2e test if your new stage appears in the happy path.
6. Update this document.