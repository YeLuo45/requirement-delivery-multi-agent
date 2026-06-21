/**
 * Tiny YAML subset parser — supports only what `agents.yaml` needs:
 *
 *   - top-level scalars: `key: value`
 *   - nested mappings via 2-space indentation
 *   - inline lists: `[a, b, c]`
 *   - block lists: lines starting with `- `
 *   - quoted strings: `"foo"` and `'foo'`
 *   - scalars: numbers, true/false/null
 *   - `# comments` until end of line
 *   - `${ENV}` placeholders (passed through untouched — `expandEnvVars`
 *     handles them after parsing)
 *
 * Anything more elaborate (anchors, multi-line strings, flow mappings)
 * is intentionally not supported. The parser raises a `YamlError` with a
 * line number for every parse failure so users can find the typo.
 */

import { EnvExpansionError, type EnvLookup, expandEnvVarsDeep } from './env.js';

export interface YamlError extends Error {
  readonly line: number;
}

export function makeYamlError(line: number, message: string): YamlError {
  const err = new Error(`[rdma-config] YAML parse error at line ${line}: ${message}`) as YamlError;
  err.line = line;
  return err;
}

/**
 * Top-level shape of an `agents.yaml` file. Only the fields we need are
 * declared; everything else is ignored so the schema can grow without
 * breaking older configs.
 */
export interface AgentsYaml {
  defaults?: {
    provider?: string;
    model?: string;
    apiKey?: string;
    baseUrl?: string;
    temperature?: number;
    maxTokens?: number;
    maxRetries?: number;
    [extra: string]: unknown;
  };
  agents?: Record<
    string,
    {
      provider?: string;
      model?: string;
      apiKey?: string;
      baseUrl?: string;
      temperature?: number;
      maxTokens?: number;
      maxRetries?: number;
      systemPrompt?: string;
      userPrompt?: string;
      [extra: string]: unknown;
    }
  >;
  [extra: string]: unknown;
}

const INDENT = '  ';

/**
 * Parse an `agents.yaml` document. Returns the parsed object on success
 * and throws `YamlError` (or `EnvExpansionError` from the env pass) on
 * failure.
 */
export function parseAgentsYaml(source: string, env?: EnvLookup): AgentsYaml {
  const parsed = parseDocument(source);
  return env ? (expandEnvVarsDeep(parsed, env) as AgentsYaml) : (parsed as AgentsYaml);
}

/* ----------------------------- internals ----------------------------- */

interface LineEntry {
  raw: string;
  line: number;
  indent: number;
  body: string;
}

interface Cursor {
  lines: LineEntry[];
  index: number;
}

function parseDocument(source: string): Record<string, unknown> {
  const lines = source
    .split(/\r?\n/)
    .map((line, idx) => ({
      raw: line,
      line: idx + 1,
      indent: countIndent(line),
      body: stripComment(line).trim(),
    }))
    .filter((entry) => entry.body.length > 0);

  const cursor: Cursor = { lines, index: 0 };
  return parseBlock(cursor, 0) as Record<string, unknown>;
}

function countIndent(line: string): number {
  let n = 0;
  while (n < line.length && line[n] === ' ') n++;
  return n;
}

function stripComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === '#' && !inSingle && !inDouble) return line.slice(0, i);
  }
  return line;
}

function parseBlock(cursor: Cursor, baseIndent: number): Record<string, unknown> | unknown[] {
  // Decide whether the first key in this block is a list or a mapping.
  const first = cursor.lines[cursor.index];
  if (!first) return {};
  if (first.body.startsWith('- ')) return parseList(cursor, baseIndent);

  const result: Record<string, unknown> = {};
  while (cursor.index < cursor.lines.length) {
    const entry = cursor.lines[cursor.index];
    if (entry.indent < baseIndent) break;
    if (entry.indent > baseIndent) {
      throw makeYamlError(entry.line, `unexpected indentation (expected ${baseIndent})`);
    }
    const m = /^([A-Za-z_][\w\-.]*)\s*:\s*(.*)$/.exec(entry.body);
    if (!m) {
      throw makeYamlError(
        entry.line,
        `expected "key: value" but got ${JSON.stringify(entry.body)}`,
      );
    }
    const key = m[1];
    const rest = (m[2] ?? '').trim();
    cursor.index++;
    if (rest === '') {
      const next = cursor.lines[cursor.index];
      if (next && next.indent > baseIndent) {
        result[key] = parseBlock(cursor, baseIndent + INDENT.length);
      } else {
        result[key] = null;
      }
    } else if (rest === '|') {
      // Block scalar — collect indented lines verbatim.
      const blockIndent = baseIndent + INDENT.length;
      const collected: string[] = [];
      while (
        cursor.index < cursor.lines.length &&
        cursor.lines[cursor.index].indent >= blockIndent
      ) {
        const stripped = cursor.lines[cursor.index].raw.slice(blockIndent);
        collected.push(stripped);
        cursor.index++;
      }
      result[key] = collected.join('\n');
    } else {
      result[key] = parseScalar(rest, entry.line);
    }
  }
  return result;
}

function parseList(cursor: Cursor, baseIndent: number): unknown[] {
  const result: unknown[] = [];
  while (cursor.index < cursor.lines.length) {
    const entry = cursor.lines[cursor.index];
    if (entry.indent < baseIndent) break;
    if (entry.indent > baseIndent) {
      throw makeYamlError(entry.line, 'unexpected indentation inside list');
    }
    if (!entry.body.startsWith('- ')) break;
    const rest = entry.body.slice(2);
    cursor.index++;
    if (rest.trim() === '') {
      const next = cursor.lines[cursor.index];
      if (next && next.indent > baseIndent) {
        result.push(parseBlock(cursor, baseIndent + INDENT.length));
      } else {
        result.push(null);
      }
    } else {
      // `- key: value` inline form
      const inline = /^([A-Za-z_][\w\-.]*)\s*:\s*(.*)$/.exec(rest);
      if (inline) {
        const obj: Record<string, unknown> = {};
        obj[inline[1]] = parseScalar(inline[2].trim(), entry.line);
        // Continuation of the same item — more keys on subsequent
        // indented lines.
        while (cursor.index < cursor.lines.length) {
          const peek = cursor.lines[cursor.index];
          if (peek.indent !== baseIndent + INDENT.length) break;
          const km = /^([A-Za-z_][\w\-.]*)\s*:\s*(.*)$/.exec(peek.body);
          if (!km) break;
          obj[km[1]] = parseScalar(km[2].trim(), peek.line);
          cursor.index++;
        }
        result.push(obj);
      } else {
        result.push(parseScalar(rest.trim(), entry.line));
      }
    }
  }
  return result;
}

function parseScalar(raw: string, line: number): unknown {
  if (raw === 'null' || raw === '~' || raw === '') return null;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
    return unescapeString(raw.slice(1, -1), '"', line);
  }
  if (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2) {
    return unescapeString(raw.slice(1, -1), "'", line);
  }
  if (raw.startsWith('[') && raw.endsWith(']')) {
    const inner = raw.slice(1, -1).trim();
    if (inner === '') return [];
    return inner.split(',').map((part) => parseScalar(part.trim(), line));
  }
  if (raw.startsWith('{') && raw.endsWith('}')) {
    const inner = raw.slice(1, -1).trim();
    if (inner === '') return {};
    const result: Record<string, unknown> = {};
    for (const piece of inner.split(',')) {
      const kv = piece.split(':');
      if (kv.length !== 2) {
        throw makeYamlError(line, `bad inline map entry: ${JSON.stringify(piece)}`);
      }
      result[kv[0].trim()] = parseScalar(kv[1].trim(), line);
    }
    return result;
  }
  if (/^-?\d+$/.test(raw)) return Number(raw);
  if (/^-?\d+\.\d+$/.test(raw)) return Number(raw);
  return raw;
}

function unescapeString(raw: string, quote: string, line: number): string {
  if (quote === '"') {
    return raw.replace(/\\(.)/g, (m, ch) => {
      switch (ch) {
        case 'n':
          return '\n';
        case 't':
          return '\t';
        case 'r':
          return '\r';
        case '\\':
          return '\\';
        case '"':
          return '"';
        default:
          throw makeYamlError(line, `unknown escape "\\${ch}"`);
      }
    });
  }
  return raw; // single-quoted: literal
}

// Re-export so callers can `import { parseAgentsYaml }` without touching env.js.
export { EnvExpansionError };
