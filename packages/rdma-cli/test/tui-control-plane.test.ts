import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { renderTuiControlPlane } from '../src/tui.js';

describe('rdma tui control plane', () => {
  it('renders a control-plane snapshot from an empty storage root', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rdma-tui-cp-'));
    try {
      const text = await renderTuiControlPlane(root);
      assert.match(text, /RDMA control plane/);
      assert.match(text, /proposal: panel/);
      assert.match(text, /A:delivery-sandbox/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
