import type { z } from 'zod';

/**
 * Reading a model's reply as JSON (spec §9.1). Models in JSON mode still sometimes wrap the
 * object in code fences, think aloud first (`<think>…</think>`) or add a sentence around it, so
 * the reply is reduced to its first balanced `{…}` object before JSON.parse, then validated
 * with Zod. Problems are described by path and Zod message only – never values.
 */

export type ParsedReply<T> = { ok: true; data: T } | { ok: false; problem: string };

/** The first balanced {...} object in `text` (string-aware), or null. */
function firstObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * The JSON object in a model reply: drops reasoning blocks and code fences and any text around
 * the first object. Throws SyntaxError when there is no parsable object.
 */
export function extractJson(text: string): unknown {
  let body = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(body);
  if (fenced?.[1]?.includes('{')) body = fenced[1];
  const object = firstObject(body);
  if (object === null) throw new SyntaxError('No JSON object in the reply');
  return JSON.parse(object) as unknown;
}

/** At most 5 problems as `path: message` (paths and Zod messages only, never the values). */
export function describeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.length ? issue.path.join('.') : '(root)'}: ${issue.message}`)
    .join('; ');
}

export function parseJsonReply<T>(text: string, schema: z.ZodType<T>): ParsedReply<T> {
  let json: unknown;
  try {
    json = extractJson(text);
  } catch {
    return { ok: false, problem: 'the reply was not a JSON object' };
  }
  const result = schema.safeParse(json);
  return result.success
    ? { ok: true, data: result.data }
    : { ok: false, problem: describeIssues(result.error) };
}
