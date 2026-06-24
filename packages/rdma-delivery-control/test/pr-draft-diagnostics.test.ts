import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { formatPrDraft } from '../src/index.js';

describe('PR draft git diagnostics', () => {
  it('embeds git apply --check failure diagnostics in the draft body', () => {
    const repoPath = mkdtempSync(path.join(tmpdir(), 'rdma-pr-draft-'));
    try {
      writeFileSync(path.join(repoPath, 'bad.txt'), 'already exists');
      const draft = formatPrDraft({
        proposalId: 'P-20260623-002',
        title: 'diagnostic draft',
        body: 'Operator summary.',
        repoPath,
        patch: {
          allowed: true,
          reason: 'preview',
          writtenFiles: ['bad.txt'],
          patchBundle: '',
        },
      });

      assert.equal(draft.gitCheck?.ok, false);
      assert.match(draft.body, /Git apply check: failed/);
      assert.match(draft.body, /git apply --check/);
    } finally {
      rmSync(repoPath, { recursive: true, force: true });
    }
  });
});
