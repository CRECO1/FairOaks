/** A list of record ids from a request body: strings that look like uuids, de-duplicated, capped. Anything else is dropped. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function cleanIdList(v: unknown, max = 50): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((x): x is string => typeof x === 'string' && UUID.test(x)))].slice(0, max);
}
