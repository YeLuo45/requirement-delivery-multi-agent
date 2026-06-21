/**
 * @rdma/llm — provider abstraction for swapping LLM implementations.
 *
 * Why this exists:
 *   - Each RDMA agent (research, pm, dev, qa, ...) eventually needs an LLM
 *     call to render its artifact (PRD, plan, implementation, ...).
 *   - We want to swap providers without touching agent code.
 *   - We want to test agents without an API key by using the Mock provider.
 *
 * Usage:
 *   ```ts
 *   import { createAnthropicProvider } from '@rdma/llm/anthropic';
 *   import { createPmAgent } from '@rdma/pm';
 *
 *   const provider = createAnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! });
 *   const agent = createPmAgent({ model: provider.fastModel() });
 *   ```
 */

/** A chat-style message in a conversation. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionRequest {
  messages: ChatMessage[];
  /** Hard upper bound on tokens generated. */
  maxTokens?: number;
  /** 0–1; lower is more deterministic. */
  temperature?: number;
  /** Stop sequences. The model stops emitting when it hits any of these. */
  stopSequences?: string[];
  /** Model id override; defaults to the provider's default model. */
  model?: string;
}

export interface CompletionResult {
  /** The model's text output. */
  text: string;
  /** Token usage accounting. */
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  /** Why the model stopped. */
  stopReason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | 'error';
}

export class LlmError extends Error {
  readonly provider: string;
  readonly cause?: unknown;
  constructor(provider: string, message: string, cause?: unknown) {
    super(`[${provider}] ${message}`);
    this.name = 'LlmError';
    this.provider = provider;
    this.cause = cause;
  }
}

/**
 * Provider interface — every LLM backend (Anthropic, OpenAI, Mock, ...)
 * implements this.
 */
export interface LlmProvider {
  readonly name: string;
  readonly defaultModel: string;
  complete(request: CompletionRequest): Promise<CompletionResult>;
  /** Cheap, fast model for short-form tasks (intake classification, routing). */
  fastModel(): string;
}

/**
 * A request-scoped wrapper that records usage + caches repeated prompts.
 * Wraps any provider; use it to track cost in agent tests.
 */
export class MeteredProvider implements LlmProvider {
  readonly provider: LlmProvider;
  readonly usage: Array<{ at: string; model: string; inputTokens: number; outputTokens: number }> =
    [];

  constructor(provider: LlmProvider) {
    this.provider = provider;
  }

  get name(): string {
    return `metered(${this.provider.name})`;
  }

  get defaultModel(): string {
    return this.provider.defaultModel;
  }

  fastModel(): string {
    return this.provider.fastModel();
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const result = await this.provider.complete(request);
    this.usage.push({
      at: new Date().toISOString(),
      model: request.model ?? this.provider.defaultModel,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    });
    return result;
  }
}
