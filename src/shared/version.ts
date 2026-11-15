/** Compares dotted version strings ("0.6.0", "v1.2.3") numerically. */
export function isNewerVersion(latest: string, current: string): boolean {
  const parts = (version: string): number[] =>
    version
      .replace(/^v/i, '')
      .split('.')
      .map((part) => Number.parseInt(part, 10) || 0)

  const a = parts(latest)
  const b = parts(current)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const left = a[i] ?? 0
    const right = b[i] ?? 0
    if (left > right) return true
    if (left < right) return false
  }
  return false
}
