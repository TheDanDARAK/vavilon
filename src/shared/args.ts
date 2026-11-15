/**
 * Command-line argument helpers for the game editor.
 *
 * The old editor did `args.trim().split(/\s+/)`, which broke every path with
 * spaces. These functions follow the Windows C-runtime quoting rules closely
 * enough for launcher arguments: quotes group whitespace, \" is a literal
 * quote, and trailing backslashes are preserved.
 */

export function parseArgs(input: string): string[] {
  const args: string[] = []
  let current = ''
  let inQuotes = false
  let tokenStarted = false
  let i = 0

  while (i < input.length) {
    const ch = input[i]

    if (ch === '\\') {
      let count = 0
      while (i < input.length && input[i] === '\\') {
        count++
        i++
      }
      if (i < input.length && input[i] === '"') {
        // 2n backslashes + quote => n backslashes + delimiter quote
        // 2n+1 backslashes + quote => n backslashes + literal quote
        current += '\\'.repeat(Math.floor(count / 2))
        tokenStarted = true
        if (count % 2 === 1) {
          current += '"'
          i++
        }
      } else {
        current += '\\'.repeat(count)
        tokenStarted = true
      }
      continue
    }

    if (ch === '"') {
      // doubled quotes inside a quoted argument produce one literal quote
      if (inQuotes && input[i + 1] === '"') {
        current += '"'
        tokenStarted = true
        i += 2
        continue
      }
      inQuotes = !inQuotes
      tokenStarted = true
      i++
      continue
    }

    if (!inQuotes && (ch === ' ' || ch === '\t')) {
      if (tokenStarted) {
        args.push(current)
        current = ''
        tokenStarted = false
      }
      i++
      continue
    }

    current += ch
    tokenStarted = true
    i++
  }

  if (tokenStarted) args.push(current)
  return args
}

function quoteArg(arg: string): string {
  if (arg === '') return '""'
  if (!/[\s"]/.test(arg) && !arg.endsWith('\\')) return arg

  // escape backslashes that precede a quote, and double trailing backslashes
  const escaped = arg
    .replace(/(\\*)"/g, (_match, slashes: string) => `${slashes}${slashes}\\"`)
    .replace(/\\+$/, (slashes) => `${slashes}${slashes}`)
  return `"${escaped}"`
}

export function formatArgs(args: string[]): string {
  return args.map(quoteArg).join(' ')
}
