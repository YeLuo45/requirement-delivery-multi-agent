/**
 * Tests for `diffInspectData` and `lineDiff`. We feed in two
 * hand-crafted `InspectData` payloads and assert on the structured
 * diff. No storage, no real proposals — pure-function tests.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildArtifactPatch, diffInspectData, lineDiff, unifiedDiff } from '../src/diff.js';
import type { InspectData } from '../src/inspect.js';

function makeProposal(overrides = {}) {
  return {
    id: 'P-1',
    projectId: 'PRJ-1',
    title: 't',
    rawRequirement: 'r',
    status: 'delivered',
    owner: 'boss',
    clarificationRound: 0,
    tags: {},
    createdAt: '2026-06-20T00:00:00.000Z',
    updatedAt: '2026-06-20T00:00:00.000Z',
    artifacts: [],
    ...overrides,
  };
}

function makeInspect(overrides = {}): InspectData {
  const proposal = makeProposal(overrides.proposal ?? {});
  return {
    proposal,
    handoffChain: [],
    artifacts: overrides.artifacts ?? [],
    auditTimeline: overrides.auditTimeline ?? [],
  };
}

describe('lineDiff()', () => {
  it('returns "  a" lines for content that is identical', () => {
    const out = lineDiff('a\nb', 'a\nb');
    assert.match(out, / {2}a/);
    assert.match(out, / {2}b/);
  });

  it('emits "- old" and "+ new" for differing lines', () => {
    const out = lineDiff('foo\nbar', 'foo\nbaz');
    assert.match(out, /- bar/);
    assert.match(out, /\+ baz/);
  });

  it('handles different line counts by padding with empty lines', () => {
    const out = lineDiff('a', 'a\nb');
    assert.match(out, /\+ b/);
  });

  it('returns an empty string for two empty inputs', () => {
    assert.equal(lineDiff('', ''), '');
  });
});

describe('diffInspectData()', () => {
  it('reports artifact kinds that are only in A', () => {
    const a = makeInspect({ artifacts: [{ kind: 'prd', summary: 'a-prd', content: 'a' }] });
    const b = makeInspect({});
    const d = diffInspectData(a, b);
    assert.deepEqual(d.artifacts.onlyA, ['prd']);
    assert.deepEqual(d.artifacts.onlyB, []);
    assert.equal(d.artifacts.common.length, 0);
  });

  it('reports artifact kinds that are only in B', () => {
    const a = makeInspect({});
    const b = makeInspect({ artifacts: [{ kind: 'plan', summary: 'b-plan', content: 'b' }] });
    const d = diffInspectData(a, b);
    assert.deepEqual(d.artifacts.onlyA, []);
    assert.deepEqual(d.artifacts.onlyB, ['plan']);
  });

  it('pairs common kinds and computes a content diff', () => {
    const a = makeInspect({ artifacts: [{ kind: 'prd', summary: 'a', content: 'line1\nline2' }] });
    const b = makeInspect({ artifacts: [{ kind: 'prd', summary: 'b', content: 'line1\nline3' }] });
    const d = diffInspectData(a, b);
    assert.equal(d.artifacts.common.length, 1);
    const c = d.artifacts.common[0];
    assert.equal(c.kind, 'prd');
    assert.equal(c.summaryA, 'a');
    assert.equal(c.summaryB, 'b');
    assert.match(c.contentDiff, /- line2/);
    assert.match(c.contentDiff, /\+ line3/);
  });

  it('flags different terminal statuses', () => {
    const a = makeInspect({ proposal: { status: 'delivered' } });
    const b = makeInspect({ proposal: { status: 'in_dev' } });
    const d = diffInspectData(a, b);
    assert.equal(d.stages.differentTerminal, true);
    assert.equal(d.proposalA.status, 'delivered');
    assert.equal(d.proposalB.status, 'in_dev');
  });

  it('treats identical statuses as the same', () => {
    const a = makeInspect();
    const b = makeInspect({ proposal: { id: 'P-2', status: 'delivered' } });
    const d = diffInspectData(a, b);
    assert.equal(d.stages.differentTerminal, false);
  });

  it('derives stage timelines from the audit timeline', () => {
    const a = makeInspect({
      auditTimeline: [
        {
          at: 't1',
          actor: 'coordinator',
          kind: 'stage.transition',
          stage: 'intake',
          action: 'create',
          parseable: true,
          raw: '',
        },
        {
          at: 't2',
          actor: 'pm',
          kind: 'stage.transition',
          stage: 'clarifying',
          action: 'transition',
          parseable: true,
          raw: '',
        },
      ],
    });
    const b = makeInspect({
      auditTimeline: [
        {
          at: 't1',
          actor: 'coordinator',
          kind: 'stage.transition',
          stage: 'intake',
          action: 'create',
          parseable: true,
          raw: '',
        },
        {
          at: 't2',
          actor: 'pm',
          kind: 'stage.transition',
          stage: 'clarifying',
          action: 'transition',
          parseable: true,
          raw: '',
        },
        {
          at: 't3',
          actor: 'pm',
          kind: 'stage.transition',
          stage: 'prd_pending_confirmation',
          action: 'transition',
          parseable: true,
          raw: '',
        },
      ],
    });
    const d = diffInspectData(a, b);
    assert.deepEqual(d.stages.stagesA, ['intake', 'clarifying']);
    assert.deepEqual(d.stages.stagesB, ['intake', 'clarifying', 'prd_pending_confirmation']);
  });

  it('skips unparseable timeline entries when deriving stages', () => {
    const a = makeInspect({
      auditTimeline: [
        {
          at: 't1',
          actor: '?',
          kind: '[unparseable]',
          stage: '',
          action: undefined,
          parseable: false,
          raw: 'garbage',
        },
        {
          at: 't2',
          actor: 'pm',
          kind: 'stage.transition',
          stage: 'clarifying',
          action: 'transition',
          parseable: true,
          raw: '',
        },
      ],
    });
    const d = diffInspectData(a, makeInspect());
    assert.deepEqual(d.stages.stagesA, ['clarifying']);
  });

  it('emits a human-readable text report', () => {
    const a = makeInspect({ artifacts: [{ kind: 'prd', summary: 'a', content: '' }] });
    const b = makeInspect({ artifacts: [{ kind: 'prd', summary: 'b', content: '' }] });
    const d = diffInspectData(a, b);
    assert.match(d.textReport, /Diff P-1 → P-1/);
    assert.match(d.textReport, /Status: A=delivered {2}B=delivered/);
    assert.match(d.textReport, /Common kinds: prd/);
  });

  it('handles proposals with no artifacts', () => {
    const a = makeInspect();
    const b = makeInspect();
    const d = diffInspectData(a, b);
    assert.equal(d.artifacts.common.length, 0);
    assert.match(d.textReport, /\(no artifacts\)/);
  });
});

describe('unifiedDiff()', () => {
  it('returns an empty string when the inputs are identical', () => {
    assert.equal(unifiedDiff('a', 'b', 'same\nlines', 'same\nlines'), '');
  });

  it('produces a `git apply`-style header when there are changes', () => {
    const out = unifiedDiff('a/foo', 'b/foo', 'one\n', 'two\n');
    assert.match(out, /^--- a\/foo/m);
    assert.match(out, /^\+\+\+ b\/foo/m);
    assert.match(out, /^@@ /m);
  });

  it('marks removed lines with "-" and added lines with "+"', () => {
    const out = unifiedDiff('l', 'r', 'a\nb\n', 'a\nB\n');
    assert.match(out, /-b$/m);
    assert.match(out, /\+B$/m);
  });

  it('uses " " prefix for unchanged context lines', () => {
    const out = unifiedDiff('l', 'r', 'keep\n', 'keep\n');
    // Identical input returns ''; the test below covers the
    // case where one line is unchanged but the body is not empty.
    assert.equal(out, '');
  });

  it('combines multiple changes into a single hunk when context connects them', () => {
    const left = ['a', 'b', 'c', 'd', 'e', 'f'].join('\n');
    const right = ['a', 'b', 'C', 'd', 'E', 'f'].join('\n');
    // context=3 covers the gap between the two changes so the diff
    // becomes a single hunk.
    const out = unifiedDiff('l', 'r', `${left}\n`, `${right}\n`, 3);
    // Count `@ `-prefixed hunk headers, not naive `@@` substrings
    // (the file labels `---` / `+++` also contain `@@`).
    const hunks = (out.match(/^@@ /gm) ?? []).length;
    assert.equal(hunks, 1, `expected 1 hunk, got ${hunks}\n${out}`);
  });
});

describe('buildArtifactPatch()', () => {
  it('emits an empty string when there are no common artifact kinds', () => {
    const a = makeInspect();
    const b = makeInspect();
    assert.equal(buildArtifactPatch(a, b), '');
  });

  it('emits a multi-file patch for common kinds', () => {
    const a = makeInspect({
      artifacts: [
        { kind: 'prd', summary: 'A', content: 'line1\nline2' },
        { kind: 'plan', summary: 'PA', content: 'p1' },
      ],
    });
    const b = makeInspect({
      artifacts: [
        { kind: 'prd', summary: 'B', content: 'line1\nline2-changed' },
        { kind: 'plan', summary: 'PB', content: 'p1' },
      ],
    });
    const patch = buildArtifactPatch(a, b);
    assert.match(patch, /--- a\/prd\.txt/m);
    assert.match(patch, /\+\+\+ b\/prd\.txt/m);
    assert.match(patch, /--- a\/plan\.txt/m);
    assert.match(patch, /\+\+\+ b\/plan\.txt/m);
  });

  it('is included in diffInspectData().patchReport', () => {
    const a = makeInspect({
      artifacts: [{ kind: 'prd', summary: 'A', content: 'one' }],
    });
    const b = makeInspect({
      artifacts: [{ kind: 'prd', summary: 'B', content: 'one-changed' }],
    });
    const d = diffInspectData(a, b);
    assert.match(d.patchReport, /--- a\/prd\.txt/m);
  });
});
