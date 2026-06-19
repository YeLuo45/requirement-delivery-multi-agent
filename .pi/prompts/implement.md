---
description: Drive a proposal through the implementation stage.
argument-hint: "<proposal-id>"
---

Drive a proposal through `in_tdd_test` and `in_dev` stages. The Dev agent
produces a test plan first, then an implementation sketch.

## Steps

```bash
# Auto-driven end-to-end
npm run cli -- deliver "<title>" --requirement "<text>"

# Or step manually
npm run cli -- step <proposal-id>   # MCP server only in v0.1
```

## Inspecting implementation artifacts

```bash
npm run cli -- show <proposal-id>
```

Look for:
- `test_plan` — the failing tests as code blocks
- `implementation` — the code blocks designed to make the tests pass

## Next commands

- `/test` — run QA against the implementation
- `/accept` — boss acceptance (auto-approves in v0.1)
- `/ship` — boss deploys