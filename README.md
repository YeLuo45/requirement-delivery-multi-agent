# requirement-delivery-multi-agent

> Multi-agent system that takes an internet-sourced requirement and delivers it end-to-end through a 7-agent state machine.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node >=20](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](package.json)
[![packages](https://img.shields.io/badge/packages-11-blue)](packages)

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
npm install --ignore-scripts

# run the end-to-end smoke test (no API keys needed)
npm run e2e

# or run a single requirement manually
npm run cli -- deliver "Build me a CLI that converts JSON to CSV"

# start the monitoring dashboard
npm run dev:web

# run the MCP server (exposes RDMA tools to external agents)
npm run dev:server
```

The CLI writes all proposals under `.rdma/` (local JSON + audit log). The web dashboard reads from the same directory.

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
│   └── rdma-web/          # React + Vite dashboard
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

## License

MIT — see [LICENSE](LICENSE).

## Related repositories

- [pi-mono](https://github.com/YeLuo45/pi-mono) — base monorepo conventions
- [ma-prj-proposal-manager](https://github.com/YeLuo45/ma-prj-proposal-manager) — multi-agent proposal manager
- [spec-kit](https://github.com/YeLuo45/spec-kit) — Spec-Driven Development toolkit
- [OpenSpec](https://github.com/YeLuo45/OpenSpec) — OpenSpec framework
- [pm-skills](https://github.com/YeLuo45/pm-skills) — PM skills marketplace
- [superpowers](https://github.com/YeLuo45/superpowers) — Agent skills methodology