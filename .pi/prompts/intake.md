---
description: Capture a new internet-sourced requirement and start the multi-agent pipeline.
argument-hint: "<title> [--requirement <text>] [--url <source>]"
---

Register a new requirement with the RDMA pipeline.

## Inputs

- `title` — short title (positional)
- `--requirement` (required) — the raw requirement text
- `--url` (optional) — source URL where the requirement came from
- `--priority` (optional) — P0 / P1 / P2 / P3
- `--scope` (optional) — small / medium / large

## Steps

1. Run the CLI:
   ```bash
   npm run cli -- deliver "<title>" --requirement "<text>" --url "<src>"
   ```
2. Read the proposal id from the output (`P-YYYYMMDD-NNN`).
3. Inspect the proposal at any time:
   ```bash
   npm run cli -- show <proposal-id>
   npm run cli -- list
   npm run cli -- status
   ```
4. Open the web dashboard for a visual view of the handoff timeline:
   ```bash
   npm run dev:web
   ```

## Output

The CLI drives the proposal through every agent (market_research → coordinator
→ [designer] → pm → dev → qa → boss) and writes 8–9 artifacts along the way.
The final status is `delivered`.

## Next commands

- `/clarify` — ask follow-up questions to the PM agent mid-flight
- `/prd` — re-render the PRD for an existing proposal
- `/plan` — re-render the implementation plan
- `/ship` — force a proposal to the boss agent for final acceptance