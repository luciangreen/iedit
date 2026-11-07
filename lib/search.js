// Find and replace logic, shared by the editor and its tests.

// Snippets for the regular-expression helper menu.
export const REGEX_HELPERS = [
  { label: 'or: a|b', text: '(a|b)' },
  { label: 'not followed by', text: '(?!x)' },
  { label: 'not preceded by', text: '(?<!x)' },
  { label: 'not one of these characters', text: '[^abc]' },
  { label: 'any characters', text: '.*' },
  { label: 'word boundary', text: '\\b' },
  { label: 'start of line', text: '^' },
  { label: 'end of line', text: '$' },
  { label: 'digit', text: '\\d' },
  { label: 'space', text: '\\s' },
  { label: 'group (use $1 in Replace)', text: '(x)' }
];

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Returns a global RegExp, or throws Error with a readable message.
export function buildRegex(query, { caseSensitive = false, wholeWord = false, regex = false } = {}) {
  if (!query) throw new Error('Type something to find');
  let source = regex ? query : escapeRegex(query);
  if (wholeWord) source = `(?<![\\w])(?:${source})(?![\\w])`;
  try {
    return new RegExp(source, `g${caseSensitive ? '' : 'i'}m`);
  } catch (err) {
    throw new Error(`Regular expression problem: ${err.message.replace(/^Invalid regular expression: /, '')}`);
  }
}

// All matches: [{ index, length, line (1-based), col (1-based), text (whole line) }]
export function findAll(text, re, limit = 10000) {
  const out = [];
  re.lastIndex = 0;
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1);
  let m;
  while ((m = re.exec(text)) && out.length < limit) {
    if (m[0].length === 0) {
      re.lastIndex++;
      if (re.lastIndex > text.length) break;
      continue;
    }
    const line = upperBound(lineStarts, m.index);
    const start = lineStarts[line - 1];
    const end = text.indexOf('\n', start);
    out.push({ index: m.index, length: m[0].length, line, col: m.index - start + 1, text: text.slice(start, end === -1 ? text.length : end) });
  }
  return out;
}

function upperBound(arr, x) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// Replace every match. In regex mode, $1 etc. refer to groups; otherwise the replacement is literal.
export function replaceAll(text, re, replacement, { regex = false } = {}) {
  let count = 0;
  const rep = regex ? replacement : replacement.replace(/\$/g, '$$$$');
  const result = text.replace(re, (...args) => {
    const match = args[0];
    if (match.length === 0) return match;
    count++;
    if (!regex) return replacement;
    // Apply $-substitutions for this one match.
    return match.replace(new RegExp(re.source, re.flags.replace('g', '')), rep);
  });
  return { text: result, count };
}

// Replace only the match at `index` (used by Replace / Replace and find next).
export function replaceAt(text, re, index, replacement, { regex = false } = {}) {
  re.lastIndex = index;
  const m = re.exec(text);
  if (!m || m.index !== index) return null;
  const single = new RegExp(re.source, re.flags.replace('g', ''));
  const rep = regex ? m[0].replace(single, replacement) : replacement;
  return { text: text.slice(0, index) + rep + text.slice(index + m[0].length), length: rep.length };
}

// Simple wildcard file filter: "*.pl, *.txt"
export function fileMatcher(pattern) {
  const parts = (pattern || '*').split(',').map((p) => p.trim()).filter(Boolean);
  const res = parts.map((p) => new RegExp('^' + p.split('*').map(escapeRegex).join('.*') + '$', 'i'));
  return (name) => res.some((r) => r.test(name));
}
