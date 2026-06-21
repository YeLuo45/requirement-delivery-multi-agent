# P-20260621-011 Technical Solution

## Package Surface

Extend `@rdma/delivery-control` with four operational helpers:

- `executeSandboxPatch(plan, request)`: validates relative paths, writes files under the isolated sandbox root, and returns a patch-bundle text plus test command list.
- `publishPolicyAuditEvent(input, publish)`: maps allow/deny tool decisions to `tool.policy.allowed` / `tool.policy.denied` events and publishes them through a provided callback.
- `createControlPlaneMetrics()` + `recordBudgetMetrics(snapshot, metrics)`: zero-dependency counter recorder for cost records, spent cents, and remaining cents.
- `formatCollaborationPanel(decisions)`: stable text panel showing collaborator role, effective access, and lease expiry.

## Design Notes

The implementation remains pure/local by default:

- No command execution in the sandbox executor; it records the intended test command only.
- No dependency on EventBus or observability packages, so the package can be reused from CLI, web, MCP server, and tests.
- Path traversal is denied before any write.
- Metrics are cents-based counters to avoid floating point drift at the exposition layer.

## Test Evidence

The first RED run failed with `does not provide an export named 'createControlPlaneMetrics'`. After implementation, `npm test --workspace=@rdma/delivery-control` passed with 9/9 tests.
