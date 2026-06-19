/**
 * Designer agent — produces a UI/UX spec for UI-bearing requirements.
 *
 * Owns the `ideation` stage. Skipped entirely for non-UI work (the
 * coordinator decides whether to route through designer based on a
 * keyword scan).
 *
 * The default implementation produces a structured spec document
 * describing: layout, components, user flow, accessibility notes.
 */

import type { Agent, AgentContext, AgentId, AgentResult, Stage } from '@rdma/core';

export const DESIGNER_ID: AgentId = 'designer';

export const DESIGNER_SCOPE: ReadonlyArray<Stage> = ['ideation'];

export function createDesignerAgent(): Agent {
  return {
    id: DESIGNER_ID,
    name: 'designer',
    scope: DESIGNER_SCOPE,
    async handle(ctx: AgentContext): Promise<AgentResult> {
      const p = ctx.proposal;

      const content = [
        `# UI/UX Spec: ${p.title}`,
        '',
        `## Layout`,
        `- Centered container, max-width 960px`,
        `- Header: project title + status badge`,
        `- Body: primary content area`,
        `- Footer: action bar (primary + secondary buttons)`,
        '',
        `## Components`,
        `- StatusBadge (pill, color-coded)`,
        `- PrimaryButton (filled, brand color)`,
        `- EmptyState (illustration + headline + CTA)`,
        `- Toast (top-right, auto-dismiss after 4s)`,
        '',
        `## User flow`,
        `1. Land on home → see empty state`,
        `2. Click primary CTA → reveal input form`,
        `3. Submit → see result + option to copy`,
        `4. Refresh → state persists (localStorage)`,
        '',
        `## Accessibility`,
        `- All interactive elements keyboard-navigable`,
        `- ARIA labels on icon-only buttons`,
        `- Color contrast >= 4.5:1 for body text`,
        `- prefers-reduced-motion respected on transitions`,
        '',
        `## Responsive`,
        `- Mobile (< 640px): single column, stacked actions`,
        `- Tablet (640-1024px): single column, larger spacing`,
        `- Desktop (>= 1024px): max-width container, side gutters`,
      ].join('\n');

      return {
        kind: 'handoff',
        to: 'pm',
        reason: 'UI spec drafted; handing off to PM for PRD.',
        artifact: {
          kind: 'design_spec',
          agentId: DESIGNER_ID,
          summary: `UI/UX spec for ${p.title}`,
          content,
        },
      };
    },
  };
}