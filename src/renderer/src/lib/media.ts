/** Builds a media:// URL for a local file path (served by the main process protocol). */
export function mediaUrl(path?: string): string | undefined {
  if (!path) return undefined
  return `media://local/${encodeURIComponent(path)}`
}
