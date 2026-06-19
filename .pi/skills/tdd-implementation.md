---
name: tdd-implementation
description: How the Dev agent produces test-first implementations.
---

The Dev agent in `@rdma/dev` follows a two-stage flow:

1. **in_tdd_test** — produces a `test_plan` artifact (failing tests as code blocks)
2. **in_dev** — produces an `implementation` artifact (code that makes the tests pass)

## Conventions

- The test plan is ALWAYS emitted first, BEFORE implementation. This is non-negotiable.
- The test plan uses `describe` / `it` blocks (Jest / node:test style) regardless of target language.
- The implementation is a code SKETCH, not a full solution. Real implementations
  should plug a code-generation model behind the same `handle()` signature.

## When to override

- **Non-code deliverables** (e.g., a docs page, a process change) → swap
  `test_plan` for `acceptance_checklist` and `implementation` for `deliverable`.
- **Performance work** → add a benchmark to the test plan.
- **Bug fixes** → add a regression test that fails on `main` and passes after.

To override, edit `packages/rdma-dev/src/agent.ts` — `renderTestPlan()` and
`renderImplementation()`.