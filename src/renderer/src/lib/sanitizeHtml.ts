/**
 * Minimal HTML sanitizer for store descriptions (Steam `detailed_description`).
 *
 * The description is third-party markup rendered with dangerouslySetInnerHTML.
 * Even with a sandboxed renderer, inline event handlers would still run and
 * could reach `window.api`, so only a small set of formatting tags and safe
 * http(s) URLs is kept. Everything else is either unwrapped or dropped.
 */

const ALLOWED_TAGS = new Set([
  'a',
  'b',
  'strong',
  'i',
  'em',
  'u',
  's',
  'p',
  'br',
  'ul',
  'ol',
  'li',
  'blockquote',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'img',
  'div',
  'span',
  'table',
  'thead',
  'tbody',
  'tr',
  'td',
  'th',
  'hr',
  'sub',
  'sup',
  'code',
  'pre'
])

/** Tags whose content is not useful/readable when unwrapped — dropped whole. */
const DROP_TAGS = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'svg',
  'math',
  'link',
  'meta',
  'noscript',
  'template',
  'audio',
  'video',
  'source'
])

const ALLOWED_ATTRS: Record<string, string[]> = {
  a: ['href', 'title'],
  img: ['src', 'alt', 'width', 'height'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan']
}

function isSafeUrl(value: string, allowDataImage: boolean): boolean {
  const trimmed = value.trim()
  if (allowDataImage && /^data:image\/(png|jpe?g|gif|webp);/i.test(trimmed)) return true
  try {
    const url = new URL(trimmed)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/** Returns sanitized inner HTML, or undefined when there is nothing left. */
export function sanitizeHtml(html?: string): string | undefined {
  if (!html) return undefined
  const doc = new DOMParser().parseFromString(html, 'text/html')

  // querySelectorAll returns a static list; parents may disappear while we edit,
  // so skip elements that were detached by an earlier replacement.
  for (const el of Array.from(doc.body.querySelectorAll('*'))) {
    if (!el.isConnected) continue
    const tag = el.tagName.toLowerCase()

    if (DROP_TAGS.has(tag)) {
      el.remove()
      continue
    }
    if (!ALLOWED_TAGS.has(tag)) {
      el.replaceWith(...Array.from(el.childNodes))
      continue
    }

    const allowed = ALLOWED_ATTRS[tag] ?? []
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase()
      if (!allowed.includes(name)) {
        el.removeAttribute(attr.name)
        continue
      }
      if (name === 'href' && !isSafeUrl(attr.value, false)) el.removeAttribute(attr.name)
      if (name === 'src' && !isSafeUrl(attr.value, true)) el.removeAttribute(attr.name)
    }

    if (tag === 'a') {
      el.setAttribute('target', '_blank')
      el.setAttribute('rel', 'noopener noreferrer')
    }
    if (tag === 'img') {
      el.setAttribute('loading', 'lazy')
      el.setAttribute('referrerpolicy', 'no-referrer')
    }
  }

  // comments are harmless but there is no reason to render them
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_COMMENT)
  const comments: Comment[] = []
  while (walker.nextNode()) comments.push(walker.currentNode as Comment)
  for (const comment of comments) comment.remove()

  const result = doc.body.innerHTML.trim()
  return result || undefined
}
