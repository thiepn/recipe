// Shared deterministic comparison for JSONB-normalized cloud documents.
// Object key order is irrelevant; array order remains significant.
export function canonicalJson(value: unknown): string {
  if (value === undefined || value === null) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  const obj = value as Record<string, unknown>;
  return '{' + Object.keys(obj).sort()
    .filter(key => obj[key] !== undefined)
    .map(key => JSON.stringify(key) + ':' + canonicalJson(obj[key])).join(',') + '}';
}
