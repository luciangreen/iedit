// Small syntax highlighters: return escaped HTML with <span class="t-..."> tokens.
// Languages: prolog, markdown, html, js, plain. Chosen from the file name.

export function languageFor(name = '') {
  const ext = name.toLowerCase().split('.').pop();
  if (['pl', 'pro', 'prolog'].includes(ext)) return 'prolog';
  if (['md', 'markdown'].includes(ext)) return 'markdown';
  if (['html', 'htm', 'xml', 'svg'].includes(ext)) return 'html';
  if (['js', 'mjs', 'cjs', 'json', 'ts', 'css'].includes(ext)) return 'js';
  return 'plain';
}

export const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Generic tokenizer: rules are [className|null, sticky regex]; first match wins.
function tokenize(text, rules) {
  let out = '';
  let i = 0;
  let plain = '';
  const flushPlain = () => {
    if (plain) out += escapeHtml(plain);
    plain = '';
  };
  outer: while (i < text.length) {
    for (const [cls, re] of rules) {
      re.lastIndex = i;
      const m = re.exec(text);
      if (m && m[0].length) {
        flushPlain();
        out += cls ? `<span class="t-${cls}">${escapeHtml(m[0])}</span>` : escapeHtml(m[0]);
        i += m[0].length;
        continue outer;
      }
    }
    plain += text[i++];
  }
  flushPlain();
  return out;
}

const PROLOG = [
  ['comment', /%[^\n]*/y],
  ['comment', /\/\*[\s\S]*?(\*\/|$)/y],
  ['string', /"(?:[^"\\\n]|\\.)*"?/y],
  ['atom', /'(?:[^'\\\n]|\\.)*'?/y],
  ['string', /`(?:[^`\\\n]|\\.)*`?/y],
  ['number', /0'.|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y],
  ['var', /[A-Z_][A-Za-z0-9_]*/y],
  ['keyword', /:-|-->|\?-|\bis\b|=\.\.|\\\+|->|!/y],
  ['functor', /[a-z][A-Za-z0-9_]*(?=\()/y],
  [null, /[a-z][A-Za-z0-9_]*/y]
];

const JS = [
  ['comment', /\/\/[^\n]*/y],
  ['comment', /\/\*[\s\S]*?(\*\/|$)/y],
  ['string', /"(?:[^"\\\n]|\\.)*"?/y],
  ['string', /'(?:[^'\\\n]|\\.)*'?/y],
  ['string', /`(?:[^`\\]|\\.)*`?/y],
  ['number', /\b\d+(?:\.\d+)?\b/y],
  ['keyword', /\b(?:const|let|var|function|return|if|else|for|while|do|break|continue|new|class|extends|import|from|export|default|async|await|try|catch|finally|throw|typeof|instanceof|in|of|true|false|null|undefined|this|switch|case)\b/y],
  ['functor', /[A-Za-z_$][\w$]*(?=\()/y],
  [null, /[A-Za-z_$][\w$]*/y]
];

const HTML = [
  ['comment', /<!--[\s\S]*?(-->|$)/y],
  ['tag', /<\/?[A-Za-z][\w:-]*/y],
  ['tag', /\/?>/y],
  ['attr', /[A-Za-z_:][\w:.-]*(?==)/y],
  ['string', /"[^"]*"?|'[^']*'?/y],
  ['entity', /&[#\w]+;/y]
];

function markdown(text) {
  const lines = text.split('\n');
  let inFence = false;
  return lines
    .map((line) => {
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        return `<span class="t-code">${escapeHtml(line)}</span>`;
      }
      if (inFence) return `<span class="t-code">${escapeHtml(line)}</span>`;
      if (/^#{1,6}\s/.test(line)) return `<span class="t-heading">${escapeHtml(line)}</span>`;
      if (/^\s*>/.test(line)) return `<span class="t-comment">${escapeHtml(line)}</span>`;
      return tokenize(line, [
        ['keyword', /^\s*(?:[-*+]|\d+\.)\s(?:\[[ xX]\]\s)?/y],
        ['code', /`[^`]*`?/y],
        ['strong', /\*\*[^*]+\*\*|__[^_]+__/y],
        ['link', /\[[^\]]*\]\([^)]*\)/y]
      ]);
    })
    .join('\n');
}

export function highlight(text, lang) {
  switch (lang) {
    case 'prolog': return tokenize(text, PROLOG);
    case 'js': return tokenize(text, JS);
    case 'html': return tokenize(text, HTML);
    case 'markdown': return markdown(text);
    default: return escapeHtml(text);
  }
}

export function countStats(text, cursor) {
  const before = text.slice(0, cursor);
  const line = before.split('\n').length;
  const col = cursor - before.lastIndexOf('\n');
  const words = (text.match(/\S+/g) ?? []).length;
  const lines = text.length ? text.split('\n').length : 1;
  return { chars: text.length, words, lines, line, col };
}
