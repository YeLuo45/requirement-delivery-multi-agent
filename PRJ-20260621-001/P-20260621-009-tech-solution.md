# P-20260621-009 Technical Solution

## Package

Add `packages/rdma-delivery-control` as a zero-dependency TypeScript workspace package.

## Public API

- `buildDeliveryPlan()` creates an isolated sandbox path, allowed write roots, TDD checkpoints, and required artifacts.
- `approveCollaborator()` maps share mode + requested access into permission and lease decisions.
- `evaluateToolRequest()` applies allowed tool, risk, network, command denylist, and write-root policy checks.
- `createBudgetLedger()` records spend and exposes max/spent/remaining snapshots.
- `routeModelForAgent()` routes cheap/standard/premium model tiers and downgrades when the remaining budget is tight.
- `summarizeControlPlane()` produces a compact report across all four directions.

## Testing Strategy

Use Node's built-in test runner with `tsx`. The test file covers each A/B/C/D direction plus an integrated summary path. The first RED run failed because `src/index.js` did not exist, then the implementation made the tests pass.

## Safety

The package is pure decision logic. It does not execute commands, write files, call networks, or mutate proposal state directly.
