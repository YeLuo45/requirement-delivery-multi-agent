---
name: prd-authoring
description: How the PM agent drafts PRDs and what makes a good one in RDMA.
---

The PM agent in `@rdma/pm` produces PRDs from the proposal's research brief
and design spec. PRD shape is defined in `packages/rdma-pm/src/agent.ts`
(`renderPRD`).

## What makes a good PRD in this system

1. **Problem statement is verbatim from the raw requirement** — do not
   paraphrase. The PRD must be checkable against the original ask.
2. **Goals are testable** — each goal should map to an acceptance criterion.
3. **Non-goals are explicit** — this is what keeps the implementation small.
4. **Acceptance criteria are mechanically checkable** — they become the
   QA acceptance tests downstream.

## When to override the default PRD

The default `renderPRD()` produces a generic PRD. Override when:

- The requirement is a specific bug fix → swap goals for "regression scenarios".
- The requirement is a research spike → swap goals for "questions answered".
- The requirement is internal tooling → add a "rollback plan" section.

To override, edit `renderPRD()` directly. Keep the shape (`# Problem`,
`## Goals`, `## Acceptance criteria`) so downstream tools can parse it.