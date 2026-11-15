/** Human-readable message from an unknown thrown value (strips "Error: "). */
export function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.replace(/^Error:\s*/, '')
}
