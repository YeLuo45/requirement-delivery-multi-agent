# AGENTS.md

This is the single source of truth for any coding agent (human or LLM) working in this repository. Read it in full before opening a PR, editing code, or running a release.

---

## 1. Conversational Style

- Keep answers short and concise.
- No emojis in commits, issues, PR comments, or code.
- No fluff or cheerful filler text.
- Technical prose only; be direct.
- When the user asks a question, answer it first before making edits or running implementation commands.
- When responding to user feedback or an analysis, explicitly say whether you agree or disagree before saying what you changed.

## 2. Repository Purpose

`requirement-delivery-multi-agent` (RDMA) is a multi-agent system that **delivers internet-sourced requirements end-to-end**. A 7-agent state machine — research → coordinator → designer → pm → dev → qa → boss — picks up a raw requirement, plans it, implements it, tests it, and reports back. The design fuses:

| Inspiration | What we adopt |
|---|---|
| [pi-mono](https://github.com/YeLuo45/pi-mono) | Monorepo structure (packages/*), `.pi/` directory conventions, AGENTS.md-driven rules, Node strip-only TypeScript mode. |
| [ma-prj-proposal-manager](https://github.com/YeLuo45/ma-prj-proposal-manager) | 7-agent state machine, agent roster, handoff timeline, MCP-driven proposal store. |
| [spec-kit](https://github.com/YeLuo45/spec-kit) | Spec-Driven Development, integration subpackage pattern, template-driven commands, extensions. |
| [OpenSpec](https://github.com/YeLuo45/OpenSpec) | Artifact graph (proposal → spec → plan → impl → deliverable), workspace isolation. |
| [pm-skills](https://github.com/YeLuo45/pm-skills) | Plugin > Command > Skill layering, PM workflow stages, command chaining. |
| [superpowers](https://github.com/YeLuo45/superpowers) | Brainstorm → spec → plan → TDD → subagent-driven implementation → verification-before-completion. |

Do **not** treat the upstream repos as forks. This is a standalone project. Reference them for design intent, not for code reuse.

## 3. Project Layout

```
requirement-delivery-multi-agent/
├── AGENTS.md                              # this file
├── README.md                              # user-facing overview
├── README.zh-CN.md                        # 中文 README
├── LICENSE
├── package.json                           # workspace root (npm workspaces)
├── tsconfig.base.json                     # strip-only TS config
├── tsconfig.json
├── biome.json                             # lint + format
├── .pi/                                   # pi-style agent config (see §8)
│   ├── extensions/
│   ├── prompts/
│   └── skills/
├── docs/                                  # architecture / state machine / agents
├── examples/
│   └── hello-world/                       # end-to-end smoke test
├── scripts/                               # e2e + bootstrap helpers
└── packages/
    ├── rdma-core/                         # state machine + Agent protocol + handoff
    ├── rdma-coordinator/                  # intake + dispatch
    ├── rdma-research/                     # market research / internet requirement scan
    ├── rdma-designer/                     # UI/UX specs (optional)
    ├── rdma-pm/                           # PRD authoring + clarification
    ├── rdma-dev/                          # implementation + TDD
    ├── rdma-qa/                           # test acceptance
    ├── rdma-boss/                         # final decision
    ├── rdma-mcp-server/                   # MCP tool surface
    ├── rdma-cli/                          # `rdma` CLI entry
    └── rdma-web/                          # React + Vite monitoring dashboard
```

## 4. Code Quality

- Read files in full before wide-ranging changes; do not rely on search snippets.
- **No `any`**. Use `unknown` + narrowing when the shape is uncertain.
- Inline single-line helpers that have only one call site.
- Top-level imports only — no `await import()`, no dynamic type imports.
- Never remove or downgrade code to fix type errors from outdated deps; upgrade the dep instead.
- Use only erasable TypeScript syntax (Node strip-only mode) in code checked by the root config: no parameter properties, `enum`, `namespace`/`module`, `import =`, `export =`. Use explicit fields with constructor assignments.
- Always ask before removing functionality or code that appears intentional.
- Do not preserve backward compatibility unless the user asks for it.
- Never hardcode agent IDs or stage names that already exist as exported constants.

## 5. Commands

- After code changes (not docs only): `npm run check` (full output, no tail). Fix all errors, warnings, and infos before committing. Does not run tests.
- Run tests with `npm test` from the repo root.
- For ad-hoc scripts, write them under `scripts/` and run via `node scripts/<name>.mjs`.
- For e2e flow validation: `npm run e2e` — runs the hello-world scenario end-to-end through every agent.
- Never commit unless the user asks.

## 6. State Machine Discipline

The 7-agent state machine in `packages/rdma-core/src/state-machine.ts` is the **single source of truth** for transitions. Rules:

- Status transitions go through `state-machine.ts` only — never mutate `proposal.status` directly.
- Skipping stages returns `INVALID_TRANSITION` (do not silently allow it).
- Every transition writes an entry to the audit log (`audit-log.ts`) including: timestamp, actor (agent id), from/to status, and a human-readable reason.
- Adding a new stage requires:
  1. Add the stage constant to `STAGES` in `state-machine.ts`.
  2. Update `STATUS_TRANSITIONS` with valid inbound/outbound edges.
  3. Update `OWNERSHIP` to map the stage to the owning agent.
  4. Document in `docs/state-machine.md`.
  5. Add a test in `state-machine.test.ts` that walks every new edge.

## 7. Agent Protocol

Every agent implements the `Agent` interface from `rdma-core`:

```ts
interface Agent {
  readonly id: AgentId;
  readonly scope: ReadonlyArray<Stage>;
  readonly name: string;
  /** Invoked when a proposal enters a stage this agent owns. */
  handle(proposal: Proposal, ctx: AgentContext): Promise<AgentResult>;
}
```

- Agents do not call other agents directly — they emit a `HandoffEvent` and let the coordinator dispatch.
- Agents are stateless across proposals; they read the full proposal context from storage.
- Agent outputs (PRD, plan, test report, etc.) are written as **artifacts** under `proposal.artifacts[]`, not as separate files on disk — keep the artifact graph the only durable surface.

## 8. The `.pi/` Directory

The `.pi/` directory is the agent-facing surface of this repository. Conventions:

- `.pi/prompts/*.md` — slash-command prompts. Each file starts with YAML frontmatter (`description`, optional `argument-hint`) and the prompt body. Commands chain by referencing the next command in their final paragraph.
- `.pi/skills/*.md` — skills auto-loaded by agent runtime. Skills describe *how* to do something; commands describe *when* to trigger it.
- `.pi/extensions/*.ts` — TypeScript modules loaded by the runtime to extend behavior. They MUST not import from outside `packages/*` and MUST be side-effect-safe at import time.
- Naming convention: `kebab-case.md` and `kebab-case.ts` only. No `PascalCase`, no `snake_case`.

## 9. Dependency & Install Security

- Treat npm dep and lockfile changes as reviewed code. Direct external deps stay pinned to exact versions.
- Hydrate/update locally with `npm install --ignore-scripts`; clean/CI-style with `npm ci --ignore-scripts`. Don't run lifecycle scripts unless the user asks.
- If dep metadata changes, refresh `package-lock.json` with `npm install --package-lock-only --ignore-scripts`.
- This repo does **not** have lifecycle scripts enabled — every `package.json` uses standard scripts only.
- New third-party deps require a justification line in the PR body.

## 10. Git

Multiple agent sessions may run in this cwd at the same time, each modifying different files. Follow these rules:

- Commit only files YOU changed in THIS session.
- Stage explicit paths (`git add <path1> <path2>`); never `git add -A` / `git add .`.
- Before committing, run `git status` and verify you are only staging your files.
- Message format: `{feat,fix,docs,refactor,test}[(core,coordinator,pm,dev,qa,research,designer,boss,mcp,cli,web)]: <commit message>`. Concise, present tense, imperative.

Never run (destroys other agents' work or bypasses checks):

- `git reset --hard`, `git checkout .`, `git clean -fd`, `git stash`, `git add -A`, `git add .`, `git commit --no-verify`.

If rebase conflicts occur:

- Resolve conflicts only in files you modified.
- If a conflict is in a file you did not modify, abort and ask the user.
- Never force push to `main`.

## 11. Issues and PRs

See `CONTRIBUTING.md` for the contributor gate (PR template, quality bar, scope rules).

When creating issues:

- Add labels for affected packages (`pkg:core`, `pkg:coordinator`, `pkg:pm`, `pkg:dev`, `pkg:qa`, `pkg:research`, `pkg:designer`, `pkg:boss`, `pkg:mcp`, `pkg:cli`, `pkg:web`); use all that apply.

When posting issue/PR comments:

- Write the comment to a temp file and post with `--body-file` (never multi-line markdown via `--body`).
- Keep comments concise, technical, in the user's tone.

## 12. Testing

- Every package ships with `vitest` tests under `test/`.
- The end-to-end test under `scripts/e2e-hello-world.mjs` walks a proposal from intake to delivery through every agent — keep it green at all times.
- New functionality MUST include at least one test that exercises it through the public API surface.

## 13. Changelog

Location: `packages/*/CHANGELOG.md` (one per package).

Sections under `## [Unreleased]`: `### Breaking Changes`, `### Added`, `### Changed`, `### Fixed`, `### Removed`.

Rules:

- All new entries go under `## [Unreleased]`. Read the full section first and append to existing subsections; never duplicate them.
- Released version sections are immutable; never modify them.

## 14. Releasing

**Lockstep versioning**: all packages share one version; every release updates all together. `patch` = fixes + additions, `minor` = breaking changes. No major releases.

1. Update each `packages/*/CHANGELOG.md` `[Unreleased]` section.
2. Local smoke test: `npm run e2e` + `npm test`.
3. Bump version in `package.json` + every `packages/*/package.json`.
4. Tag `v<X.Y.Z>` and push.

## 15. Things That Are Out Of Scope

- Hosting a real LLM provider — agents run in-process with deterministic mock models so the e2e flow is reproducible without API keys. Swap mocks for real providers behind the same interface.
- Persisting to a remote database — storage is local JSON under `.rdma/`. A SQLite or Postgres backend can be added later behind `storage.ts`.
- Multi-tenant web UI — the dashboard is single-tenant, single-user.
- Production deployment — there is no production deployment. `rdma-web` runs locally only.