---
description: Ship a proposal — drive it through boss's deploy + deliver.
argument-hint: "<proposal-id>"
---

Force a proposal to the boss's deploy + deliver stages. Writes a deployment
record under `.rdma/shipped/<project>/<proposal>.json`.

## Steps

```bash
# End-to-end (recommended)
npm run cli -- deliver "<title>" --requirement "<text>"

# Or just run the existing proposal to completion
# (the pipeline.runToCompletion walks every remaining step)
```

## Inspecting the deployment record

```bash
cat .rdma/shipped/<project-id>/<proposal-id>.json
```

Fields:
- `proposalId`, `projectId`, `title` — identifiers
- `deployedFromStatus` — always `accepted` in v0.1
- `deployedAt` — ISO 8601 timestamp
- `artifactsCount` — how many artifacts the proposal had at ship time

## Next commands

- `/status` — overall system status
- `/list` — all proposals