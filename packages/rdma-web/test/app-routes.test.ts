import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { appNavItems, appRoutes } from '../src/App.js';

describe('App route discoverability', () => {
  it('exposes the control-plane panel in navigation and routes', () => {
    assert.ok(
      appNavItems.some((item) => item.href === '/control-plane' && item.label === 'Control Plane'),
    );
    assert.ok(appRoutes.some((route) => route.path === '/control-plane'));
  });

  it('keeps acceptance evidence on the home overview route', () => {
    assert.ok(appRoutes.some((route) => route.path === '/' && route.label === 'Overview'));
  });

  it('exposes the delivery report page in navigation and routes', () => {
    assert.ok(
      appNavItems.some(
        (item) =>
          item.href === '/delivery-report/P-20260623-015' && item.label === 'Delivery Report',
      ),
    );
    assert.ok(appRoutes.some((route) => route.path === '/delivery-report/:id'));
  });

  it('exposes release history as a top-level operator route', () => {
    assert.ok(appNavItems.some((item) => item.href === '/release-history'));
    assert.ok(appRoutes.some((route) => route.path === '/release-history'));
  });
});
