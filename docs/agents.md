# Agents

7 agents, each owning 1–3 stages of the pipeline.

| Agent | Stages owned | Purpose |
|---|---|---|
| `market_research` | `research_direction_pending`, `research` | Scans internet for similar projects; produces a structured requirement brief. |
| `coordinator` | `intake` | Captures user intent; decides whether to route through designer; produces intake form. |
| `designer` | `ideation` | Produces UI/UX spec (skipped for non-UI work). |
| `pm` | `clarifying`, `prd_pending_confirmation`, `approved_for_dev` | Drafts PRD, runs clarification rounds, writes implementation plan. |
| `dev` | `in_tdd_test`, `in_dev` | Produces test plan first, then implementation sketch. |
| `qa` | `in_test_acceptance`, `test_failed` | Runs acceptance checks; routes failures back to dev. |
| `boss` | `accepted`, `deployed`, `delivered` | Final acceptance, deploys, marks delivered. |

## Agent interface

Every agent implements:

```ts
interface Agent {
  readonly id: AgentId;
  readonly scope: ReadonlyArray<Stage>;
  readonly name: string;
  handle(ctx: AgentContext): Promise<AgentResult>;
}

type AgentResult =
  | { kind: 'transition'; nextStage: Stage; reason: string; artifact?: Artifact }
  | { kind: 'handoff'; to: AgentId; reason: string; artifact?: Artifact }
  | { kind: 'block'; reason: string; artifact?: Artifact };
```

The agent:

1. Receives a proposal that has just entered one of its scoped stages.
2. Returns one of three event shapes.
3. NEVER calls another agent directly — it emits a handoff and lets the
   coordinator dispatch.

See `packages/rdma-core/src/types.ts` and the `handoff-protocol` skill.

## Per-agent notes

### `market_research`

- v0.1 uses a deterministic `CannedResearchProvider` that returns plausible
  similar-project lists based on keyword scans.
- To plug a real provider, implement `ResearchProvider.searchSimilarProjects()`
  and pass it to `createResearchAgent(provider)`.
- Always advances to `intake` after producing the brief.

### `coordinator`

- Decides whether the requirement is UI work via a word-boundary regex:
  `\b(ui|ux|interface|frontend|page|web\s*app|webapp)\b|design\s+(spec|system|doc)`
- UI work routes to `designer` → `pm`. Non-UI work goes straight to `pm`.
- Captures priority (default P2) and scope (default medium) tags.

### `designer`

- v0.1 produces a static UI/UX spec with layout, components, user flow,
  accessibility, responsive notes.
- To customize, edit `packages/rdma-designer/src/agent.ts`.

### `pm`

- v0.1 auto-advances after one clarification round. The PRD + plan are
  generated from the proposal's research brief + design spec.
- To plug a real LLM, replace the body of `handle()` with a model call.
- The PRD shape is checked by downstream agents — keep `# Problem`,
  `## Goals`, `## Acceptance criteria` headers intact.

### `dev`

- v0.1 produces a `test_plan` artifact (Jest/node:test style blocks) and
  an `implementation` artifact (TypeScript sketch).
- For non-code deliverables (docs, processes), swap the artifacts in
  `renderTestPlan()` / `renderImplementation()`.

### `qa`

- v0.1 has a `forceFailure` config flag that flips between pass and fail
  modes. Used by the e2e test to exercise the rework loop.
- A real implementation would sandbox-run the `implementation` artifact
  and parse test output.

### `boss`

- v0.1 auto-approves. Writes a deployment record to `.rdma/shipped/`
  when transitioning from `deployed` → `delivered`.
- To gate behind human approval, edit the `accepted` case in
  `packages/rdma-boss/src/agent.ts` to return `{ kind: 'block', ... }`.