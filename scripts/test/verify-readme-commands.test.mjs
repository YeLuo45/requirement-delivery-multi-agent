import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildReadmeCommandSandboxPlan } from '../verify-readme-commands.mjs';

describe('verify-readme command sandbox planning', () => {
  it('plans oneshot README commands inside a copied sandbox without mutating the repo root', () => {
    const plan = buildReadmeCommandSandboxPlan({
      repoRoot: '/repo',
      sandboxRoot: '/tmp/rdma-readme-sandbox',
      command: 'npm run cli -- status',
    });

    assert.equal(plan.mutatesRepoRoot, false);
    assert.deepEqual(plan.setupCommands, [
      'mkdir -p /tmp/rdma-readme-sandbox',
      'rsync -a --delete --exclude .git /repo/ /tmp/rdma-readme-sandbox/',
    ]);
    assert.equal(plan.command, 'cd /tmp/rdma-readme-sandbox && npm run cli -- status');
  });
});
