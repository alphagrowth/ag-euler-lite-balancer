const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

/**
 * Object.assign wrapper that filters out prototype-pollution keys.
 * Use when merging data from external APIs into reactive objects.
 */
export function safeAssign<T extends Record<string, unknown>>(
  target: T,
  source: Record<string, unknown>,
): T {
  for (const key of Object.keys(source)) {
    if (!DANGEROUS_KEYS.has(key)) {
      (target as any)[key] = source[key]
    }
  }
  return target
}
