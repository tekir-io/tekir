// XSS Sanitization helpers

/**
 * Strip all HTML tags from a string.
 *
 * @example
 * sanitize('<script>alert(1)</script>Hello') // => 'Hello'
 */
export function sanitize(input: string): string {
  if (typeof input !== "string") return String(input)
  // Remove tags including any attributes and content inside script/style tags.
  return input
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
}

/** Map of characters to their HTML entity equivalents. */
const HTML_ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#x27;",
  "/": "&#x2F;",
  "`": "&#x60;",
  "=": "&#x3D;",
}

const HTML_ESCAPE_REGEX = /[&<>"'`=/]/g

/**
 * Escape HTML special characters to their entity equivalents.
 * Safe for output inside HTML attribute values and text nodes.
 *
 * @example
 * escapeHtml('<b>bold</b>') // => '&lt;b&gt;bold&lt;&#x2F;b&gt;'
 */
export function escapeHtml(input: string): string {
  if (typeof input !== "string") return String(input)
  return input.replace(
    HTML_ESCAPE_REGEX,
    (char) => HTML_ESCAPE_MAP[char] ?? char
  )
}

/**
 * Reverse of `escapeHtml` — decode HTML entities back to plain characters.
 *
 * @example
 * unescapeHtml('&lt;b&gt;') // => '<b>'
 */
export function unescapeHtml(input: string): string {
  if (typeof input !== "string") return String(input)
  return input
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#x60;/g, "`")
    .replace(/&#x3D;/g, "=")
}
