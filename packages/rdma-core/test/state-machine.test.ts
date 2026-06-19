/**
 * State machine tests — cover every edge in STATUS_TRANSITIONS,
 * every ownership, and the handoff helper.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_IDS,
  InvalidTransitionError,
  STAGES,
  type Stage,
  STATUS_TRANSITIONS,
  assertValidTransition,
  findPath,
  isValidTransition,
  ownerOf,
  scopeOf,
  validateRoster,
} from '../src/state-machine.js';

describe('state-machine: roster', () => {
  it('every agent owns at least one stage, every stage has a valid owner', () => {
    const result = validateRoster();
    assert.deepEqual(result, { ok: true }, `roster invalid: ${JSON.stringify(result)}`);
  });

  it('every agent id appears in AGENT_IDS', () => {
    for (const id of ['market_research', 'coordinator', 'designer', 'pm', 'dev', 'qa', 'boss'] as const) {
      assert.ok(AGENT_IDS.includes(id));
    }
  });

  it('every stage is unique and listed in STAGES', () => {
    assert.equal(new Set(STAGES).size, STAGES.length);
  });
});

describe('state-machine: transitions', () => {
  it('every stage in STATUS_TRANSITIONS has at least one outgoing edge, except delivered', () => {
    for (const stage of STAGES) {
      if (stage === 'delivered') {
        assert.equal(STATUS_TRANSITIONS[stage].length, 0, 'delivered must be terminal');
      } else {
        assert.ok(STATUS_TRANSITIONS[stage].length > 0, `${stage} has no outgoing edges`);
      }
    }
  });

  it('no stage can transition to itself', () => {
    for (const stage of STAGES) {
      assert.equal(isValidTransition(stage, stage), false, `${stage} -> ${stage} must be rejected`);
    }
  });

  it('targets of every transition are valid stages', () => {
    for (const [from, targets] of Object.entries(STATUS_TRANSITIONS)) {
      for (const to of targets) {
        assert.ok(STAGES.includes(to as Stage), `${from} -> ${to}: ${to} is not a stage`);
      }
    }
  });

  it('assertValidTransition throws on bad edges', () => {
    assert.throws(() => assertValidTransition('delivered', 'intake'), InvalidTransitionError);
  });

  it('assertValidTransition accepts valid edges', () => {
    // intake -> clarifying is valid
    assert.doesNotThrow(() => assertValidTransition('intake', 'clarifying'));
  });
});

describe('state-machine: ownership', () => {
  it('every stage has exactly one owner', () => {
    const counts = new Map<string, number>();
    for (const stage of STAGES) {
      const owner = ownerOf(stage);
      counts.set(owner, (counts.get(owner) ?? 0) + 1);
    }
    for (const id of AGENT_IDS) {
      assert.ok((counts.get(id) ?? 0) > 0, `${id} owns no stages`);
    }
  });

  it('scopeOf returns the stages owned by the given agent', () => {
    const bossScope = scopeOf('boss');
    assert.ok(bossScope.includes('accepted'));
    assert.ok(bossScope.includes('deployed'));
    assert.ok(bossScope.includes('delivered'));
    assert.ok(!bossScope.includes('in_dev'));
  });
});

describe('state-machine: paths', () => {
  it('findPath returns a valid path from intake to delivered', () => {
    const path = findPath('intake', 'delivered');
    assert.ok(path !== null);
    assert.equal(path![0], 'intake');
    assert.equal(path![path!.length - 1], 'delivered');
  });

  it('findPath returns null for unreachable targets', () => {
    // delivered is terminal — nothing flows out of it.
    assert.equal(findPath('delivered', 'intake'), null);
  });

  it('findPath handles single-step paths', () => {
    const path = findPath('research_direction_pending', 'research');
    assert.deepEqual(path, ['research_direction_pending', 'research']);
  });
});

describe('state-machine: realistic flows', () => {
  it('happy path: intake -> clarifying -> prd -> approved -> tdd -> dev -> qa -> accepted -> deployed -> delivered', () => {
    const path = findPath('intake', 'delivered');
    assert.ok(path !== null);
    // Verify all the key transitions appear
    assert.ok(path!.includes('clarifying'));
    assert.ok(path!.includes('prd_pending_confirmation'));
    assert.ok(path!.includes('approved_for_dev'));
    assert.ok(path!.includes('in_tdd_test'));
    assert.ok(path!.includes('in_dev'));
    assert.ok(path!.includes('in_test_acceptance'));
    assert.ok(path!.includes('accepted'));
    assert.ok(path!.includes('deployed'));
    assert.ok(path!.includes('delivered'));
  });

  it('rework path: in_dev -> test_failed -> in_dev', () => {
    assert.ok(isValidTransition('in_dev', 'in_test_acceptance'));
    assert.ok(isValidTransition('in_test_acceptance', 'test_failed'));
    assert.ok(isValidTransition('test_failed', 'in_dev'));
    assert.ok(isValidTransition('test_failed', 'in_test_acceptance'));
  });

  it('boss rollback: accepted -> in_dev is allowed', () => {
    assert.ok(isValidTransition('accepted', 'in_dev'));
  });
});