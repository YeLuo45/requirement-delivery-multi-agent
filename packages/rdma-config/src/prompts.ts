/**
 * Compose / resolve the per-agent prompt bundle.
 *
 * `soul.md` is the agent's voice; `user.md` is an optional template;
 * `memory.md` is long-lived context. We export two pure helpers so PM /
 * Dev / QA can reuse them without each owning a slightly different
 * version. The Anthropic API rejects multiple system messages, so we
 * fold soul + memory into a single system block.
 */

import type { AgentPromptBundle } from './types.js';

/**
 * Compose the system prompt for an LLM call.
 *
 * Layout (each non-empty block gets joined with a blank line):
 *   1. `prompts.soul` (agent voice, highest priority)
 *   2. `defaultPrompt` (built-in fallback)
 *   3. `prompts.memory` (long-lived context, labeled with `# memory`)
 *
 * Returns `defaultPrompt` unchanged when no overrides are supplied.
 */
export function composeSystemPrompt(
  defaultPrompt: string,
  prompts: AgentPromptBundle | undefined,
): string {
  if (!prompts) return defaultPrompt;
  const blocks: string[] = [];
  if (prompts.soul && prompts.soul.trim().length > 0) {
    blocks.push(prompts.soul.trim());
  }
  if (defaultPrompt.length > 0) blocks.push(defaultPrompt);
  if (prompts.memory && prompts.memory.trim().length > 0) {
    blocks.push(`# memory\n${prompts.memory.trim()}`);
  }
  if (blocks.length === 0) return defaultPrompt;
  return blocks.join('\n\n');
}

/**
 * Returns the user prompt for an LLM call: either the configured
 * `user.md` template (verbatim — operators are expected to interpolate
 * placeholders themselves) or `null` to let the agent render its own
 * structured user prompt from the proposal.
 */
export function resolveUserPrompt(prompts: AgentPromptBundle | undefined): string | null {
  if (!prompts?.user) return null;
  const trimmed = prompts.user.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Marker that an empty / null bundle should keep the agent in mock mode
 * even when a model is provided. The CLI uses this to skip per-agent
 * provider instantiation when no configuration is on disk.
 */
export function isEmptyPromptBundle(prompts: AgentPromptBundle | undefined): boolean {
  if (!prompts) return true;
  return (
    (prompts.soul === null || prompts.soul.trim().length === 0) &&
    (prompts.user === null || prompts.user.trim().length === 0) &&
    (prompts.memory === null || prompts.memory.trim().length === 0)
  );
}
