# Hello world — run RDMA end-to-end

This example drives a single requirement through every agent in the pipeline
and prints the result.

## What it does

1. Builds the full agent registry (research, coordinator, designer, pm,
   dev, qa, boss).
2. Creates one proposal: "JSON to CSV CLI".
3. Drives the proposal through every agent until it reaches `delivered`.
4. Prints the handoff chain, the artifact list, and the deployment record
   location.

## Run it

```bash
cd /path/to/requirement-delivery-multi-agent
node --import tsx examples/hello-world/run.mjs
```

## Expected output

```
→ JSON to CSV CLI
   P-20260619-001  status=delivered  chain=market_research → coordinator → pm → dev → qa → boss  artifacts=8
```

The CLI command does the same thing with nicer formatting:

```bash
npm run cli -- deliver "JSON to CSV CLI" --requirement "Convert JSON to CSV"
```

## Code

The script is `examples/hello-world/run.mjs`. It's a thin wrapper around
the bootstrap demo (`scripts/bootstrap-demo.mjs`) that runs a single
proposal instead of three.