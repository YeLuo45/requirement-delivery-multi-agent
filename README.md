# requirement-delivery-multi-agent

> Multi-agent system that takes an internet-sourced requirement and delivers it end-to-end through a 7-agent state machine.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node >=20](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](package.json)
[![packages](https://img.shields.io/badge/packages-17-blue)](packages)

## What is this?

`requirement-delivery-multi-agent` (RDMA) is a multi-agent system that picks up a **raw requirement** (e.g. "build me a CLI that converts JSON to CSV"), parses it through a research agent, drafts a PRD with a PM agent, designs it (optional), implements it with a Dev agent using TDD, runs it through a QA acceptance loop, and reports back to a Boss agent for final approval. Every step is auditable through a handoff timeline.

The system fuses design intent from six reference repositories:

| Inspiration | What we adopted |
|---|---|
| [pi-mono](https://github.com/YeLuo45/pi-mono) | Monorepo layout, `.pi/` directory, AGENTS.md-driven rules |
| [ma-prj-proposal-manager](https://github.com/YeLuo45/ma-prj-proposal-manager) | 7-agent state machine, agent roster, handoff timeline |
| [spec-kit](https://github.com/YeLuo45/spec-kit) | Spec-Driven Development, integration subpackages |
| [OpenSpec](https://github.com/YeLuo45/OpenSpec) | Artifact graph (proposal → spec → plan → impl → deliverable) |
| [pm-skills](https://github.com/YeLuo45/pm-skills) | Plugin > Command > Skill layering, PM workflow stages |
| [superpowers](https://github.com/YeLuo45/superpowers) | Brainstorm → spec → plan → TDD → subagent-driven implementation |

## The 7-agent state machine

```
   ┌────────────────┐
   │ market_research│  ← scans internet for requirement context
   └────────┬───────┘
            ▼
   ┌────────────────┐
   │   coordinator  │  ← registers proposal, captures intent
   └────────┬───────┘
            ▼
   ┌────────────────┐
   │    designer    │  ← (optional) UI/UX spec
   └────────┬───────┘
            ▼
   ┌────────────────┐
   │       pm       │  ← PRD authoring + clarification rounds
   └────────┬───────┘
            ▼
   ┌────────────────┐
   │       dev      │  ← TDD + subagent-driven implementation
   └────────┬───────┘
            ▼
   ┌────────────────┐
   │       qa       │  ← test acceptance
   └────────┬───────┘
            ▼
   ┌────────────────┐
   │      boss      │  ← final accept / revise / ship
   └────────────────┘
```

Stages (full list, see `docs/state-machine.md`):

`research_direction_pending` → `research` → `intake` → `ideation` → `clarifying` →
`prd_pending_confirmation` → `approved_for_dev` → `in_tdd_test` → `in_dev` →
`in_test_acceptance` → `test_failed` → `accepted` → `deployed` → `delivered`

## Quickstart

```bash
# install
npm install --include=dev --ignore-scripts

# run the end-to-end smoke test (no API keys needed)
npm run e2e

# run the full suite and enforce source coverage >=95%
npm test
npm run coverage

# run the complete local release gate and dirty-file classifier
npm run release:local

# emit machine-readable release evidence without running gates
npm run release:local -- --json --proposal P-20260623-019 --title "V22-V24 ledger"

# persist that JSON payload under artifacts/release-local/
npm run release:local -- --json --proposal P-20260623-019 --title "V22-V24 ledger" --write-history

# summarize release history and generate copy-ready PR text/stage suggestions
npm run cli -- release-ops --pr-draft

# emit stable automation JSON and GitHub Actions step-summary markdown
npm run cli -- release-ops --json
npm run cli -- release-ops --ci-summary

# persist delivery-report.md, ci-evidence.md, and automation.json under release-local/
npm run cli -- release-ops --write-reports

# preview or recover safe proposal status transitions without skipping the MCP state machine
npm run cli -- release-ops apply-status --proposal P-20260623-022 --to deployed --dry-run
npm run cli -- release-ops --recovery-plan

# CI-only release evidence workflow uploads artifacts/release-local
# .github/workflows/release-ops-evidence.yml

# or run a single requirement manually
npm run cli -- deliver "Build me a CLI that converts JSON to CSV" \
  --requirement "Convert a JSON array of objects to CSV."

# start the monitoring dashboard (long-running; stop with Ctrl+C)
npm run dev:web

# run the MCP server (long-running; exposes RDMA tools to external agents)
npm run dev:server
```

The CLI writes all proposals under `.rdma/` (local JSON + audit log). The web dashboard reads from the same directory.

### Web operator mode

After `npm run dev:web`, browser operators can use the Web mode for every TUI operation:

| TUI capability | Web surface |
|---|---|
| `list` | `/operator` and `/proposals` |
| `show <id>` | `/proposals/:id` |
| `config` | `/config` backed by `GET /api/config` |
| `new` | `/proposals` backed by `POST /api/proposals/create` |
| `control-plane` | `/control-plane` backed by `GET /api/control-plane/panel` |
| `release-ops` | `/release-ops` backed by `GET /api/release-ops`, `GET /api/release-ops/actions`, `GET /api/release-diff`, `GET /api/workflow-runs`, and `GET /api/release-history` |

`GET /api/operator` returns the same parity map plus proposal totals for automated checks. `GET /api/acceptance-evidence` returns the same evidence dashboard model used by the home Overview. `GET /api/release-ops?format=automation` returns safe status suggestions, stage commands, PR draft markdown, and remediation markdown for CI or operator dashboards. `GET /api/release-ops/actions` returns copy-ready status/stage actions, `GET /api/release-diff` returns the artifact diff viewer model, and `GET /api/workflow-runs` returns a workflow status dashboard. The Overview also surfaces an acceptance-evidence panel that summarizes check, test, coverage, README verification, and build gates from accepted/deployed/delivered proposal notes.

## Repository layout

```
requirement-delivery-multi-agent/
├── AGENTS.md              # single source of truth for coding agents
├── README.md              # this file
├── docs/                  # architecture, state machine, agents, workflows
├── .pi/                   # agent-facing prompts + skills + extensions
├── packages/
│   ├── rdma-core/         # state machine, agent protocol, handoff, storage
│   ├── rdma-coordinator/  # intake + dispatch
│   ├── rdma-research/     # internet requirement scanner
│   ├── rdma-designer/     # UI/UX specs
│   ├── rdma-pm/           # PRD + clarification
│   ├── rdma-dev/          # TDD + implementation
│   ├── rdma-qa/           # test acceptance
│   ├── rdma-boss/         # final decision
│   ├── rdma-mcp-server/   # MCP tool surface
│   ├── rdma-cli/          # `rdma` CLI
│   ├── rdma-web/          # React + Vite dashboard
│   └── rdma-delivery-control/ # sandbox, collaboration, tool policy, cost routing
└── examples/
    └── hello-world/       # end-to-end example
```

## Why monorepo?

The 7 agents + the core state machine + the storage layer + the CLI + the dashboard all need to evolve together. A monorepo keeps:

- The state machine `STATUS_TRANSITIONS` table and the agent `OWNERSHIP` table in lockstep.
- The proposal/artifact type definitions shared without a package boundary.
- Tests that exercise a real proposal end-to-end across all packages.

## What is "an internet requirement"?

The `market_research` agent scans a requirement URL (or accepts raw text) and produces a structured **requirement brief** that the rest of the pipeline consumes. The brief includes:

- One-paragraph restatement of the requirement in the user's voice.
- Top 3 similar open-source projects (URLs + one-line summaries) found via web search.
- 3-5 candidate decomposition angles (what is the smallest slice that delivers value?).
- A risk register: unknowns, ambiguities, hard parts.

The brief is then handed to the coordinator, who registers a proposal and starts the pipeline.

## Status

**v0.1.0** — initial scaffolding. End-to-end flow works with deterministic mock agents. The `market_research` agent uses a stubbed web search that returns canned data; swap with a real provider behind the same interface.

## Delivery control plane

`@rdma/delivery-control` provides reusable control-plane helpers for safe autonomous delivery:

- `buildDeliveryPlan()` and `executeSandboxPatch()` plan and apply file writes inside an isolated sandbox root.
- `evaluateToolRequest()` and `publishPolicyAuditEvent()` turn tool-policy decisions into auditable allow/deny events.
- `subscribePolicyAuditBus()` fans policy audit events out to multiple subscribers (CLI/TUI/Web).
- `attachPolicyAuditToEventBus()` adapts `PolicyAuditBus` to a real `EventBus`-style publisher so allow/deny events flow through the existing realtime stream.
- `renderCostPrometheus()` exports `rdma_cost_*` counters in Prometheus text format.
- `renderControlPlanePanel({mode: 'prom' | 'json' | 'tui'})` produces a unified panel payload for CLI/TUI/Web.
- `buildSandboxPreview()` produces a patch bundle without writing to disk.
- `rdma sandbox apply --workspace-root <path> --proposal <id> --files <path>=<content> [--dry-run]` applies (or previews) a sandbox patch from the CLI.
- `rdma metrics --cost` prints the rdma_cost_* Prometheus metrics; `rdma tui --control-plane` (or the in-TUI `[p]lane` command) prints the panel summary.
- `GET /api/control-plane/panel` and `GET /api/control-plane/cost` on the web dashboard expose the panel JSON and Prometheus text.

These helpers are pure local TypeScript APIs; they do not execute shell commands or call external networks.

## License

MIT — see [LICENSE](LICENSE).

## Related repositories

- [pi-mono](https://github.com/YeLuo45/pi-mono) — base monorepo conventions
- [ma-prj-proposal-manager](https://github.com/YeLuo45/ma-prj-proposal-manager) — multi-agent proposal manager
- [spec-kit](https://github.com/YeLuo45/spec-kit) — Spec-Driven Development toolkit
- [OpenSpec](https://github.com/YeLuo45/OpenSpec) — OpenSpec framework
- [pm-skills](https://github.com/YeLuo45/pm-skills) — PM skills marketplace
- [superpowers](https://github.com/YeLuo45/superpowers) — Agent skills methodology