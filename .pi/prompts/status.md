---
description: Show system status, proposal counts by stage, and registered agents.
argument-hint: ""
---

Display the current system state.

## Steps

```bash
npm run cli -- status
```

Output includes:
- Storage root path
- Proposal count total + by stage
- Registered agents + their scope (which stages they own)

For a per-proposal view, use `npm run cli -- show <proposal-id>`.