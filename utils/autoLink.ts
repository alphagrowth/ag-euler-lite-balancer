const URL_RE = /https?:\/\/[^\s<>"')\]]+/g
const BOLD_RE = /\*\*(.+?)\*\*/g
const NEWLINE_RE = /\r?\n/g

const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const formatInline = (text: string): string =>
  escapeHtml(text)
    .replace(BOLD_RE, '<strong>$1</strong>')
    .replace(NEWLINE_RE, '<br>')

export const formatEulerLabelText = (text: string): string => {
  let lastIndex = 0
  let formatted = ''

  for (const match of text.matchAll(URL_RE)) {
    const [url] = match
    const index = match.index ?? 0

    formatted += formatInline(text.slice(lastIndex, index))
    formatted += `<a href="${url}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`
    lastIndex = index + url.length
  }

  formatted += formatInline(text.slice(lastIndex))
  return formatted
}

export const autoLink = formatEulerLabelText
