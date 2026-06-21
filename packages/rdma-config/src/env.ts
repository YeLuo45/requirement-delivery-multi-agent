/**
 * `${ENV_VAR}` substitution helper.
 *
 * The CLI / config layer keeps secrets in environment variables and lets
 * the user reference them from `agents.yaml` like so:
 *
 *   apiKey: ${ANTHROPIC_API_KEY}
 *
 * `expandEnvVars` only substitutes patterns that match
 * /\$\{[A-Z_][A-Z0-9_]*\}/ — anything else is returned unchanged so the
 * agent YAML can still mention literal `$` characters if it needs to.
 *
 * Missing variables raise an explicit error rather than silently expanding
 * to `undefined`. We do this because a missing API key downstream causes
 * a confusing 401 from the provider; surfacing the problem at config load
 * time is easier to debug.
 */

export type EnvLookup = Record<string, string | undefined>;

const PLACEHOLDER = /\$\{([A-Z_][A-Z0-9_]*)\}/g;

export class EnvExpansionError extends Error {
  readonly variable: string;
  constructor(variable: string) {
    super(`[rdma-config] environment variable "${variable}" is referenced but not set`);
    this.name = 'EnvExpansionError';
    this.variable = variable;
  }
}

/**
 * Expand every `${NAME}` placeholder in `value`. Returns the substituted
 * string. Throws `EnvExpansionError` on the first missing variable.
 */
export function expandEnvVars(value: string, env: EnvLookup = process.env): string {
  return value.replace(PLACEHOLDER, (match, name: string) => {
    const v = env[name];
    if (v === undefined || v === '') {
      throw new EnvExpansionError(name);
    }
    return v;
  });
}

/**
 * Convenience variant: walks an object tree and expands every string value
 * in place. Non-string values (numbers, booleans, null) are left alone.
 */
export function expandEnvVarsDeep<T>(input: T, env: EnvLookup = process.env): T {
  if (typeof input === 'string') return expandEnvVars(input, env) as unknown as T;
  if (Array.isArray(input)) {
    return input.map((v) => expandEnvVarsDeep(v, env)) as unknown as T;
  }
  if (input !== null && typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = expandEnvVarsDeep(v, env);
    }
    return out as T;
  }
  return input;
}
