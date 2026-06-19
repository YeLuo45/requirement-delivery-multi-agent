---
description: Run the QA agent against a proposal's implementation.
argument-hint: "<proposal-id>"
---

Run the QA agent's acceptance checks against a proposal's implementation.

## Steps

1. The QA agent runs automatically when the proposal enters `in_test_acceptance`.
2. View the test report:
   ```bash
   npm run cli -- show <proposal-id>
   ```
3. Look for the artifact with kind `test_report`. The summary starts with
   `QA PASS:` or `QA FAIL:`.

## Forcing a failure (test mode)

In v0.1 the QA agent has a `forceFailure: true` config flag. Tests use it to
exercise the rework loop:

```ts
import { createQaAgent } from '@rdma/qa';
registry.register(createQaAgent({ forceFailure: true }));
```

A real implementation would run the implementation in a sandbox and check
actual test output.