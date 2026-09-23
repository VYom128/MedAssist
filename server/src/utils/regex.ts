/** Escapes regex metacharacters so user input can be used in a `RegExp` as plain text. */
export const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Case-insensitive "contains" match for `?q=` searches. */
export const containsRegex = (s: string) => new RegExp(escapeRegex(s), 'i');

/** Case-insensitive whole-value match (duplicate-name checks). */
export const exactRegex = (s: string) => new RegExp(`^${escapeRegex(s)}$`, 'i');
