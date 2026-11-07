// Where text dropped at a point lands in the editor, and what dropping files inserts.
// The editor is a monospace textarea with no wrapping, so a point maps to a line and column.

// x, y: the point inside the textarea's box. Returns a character offset into `text`.
export function offsetAtPoint(text, { x, y, lineHeight, charWidth, tabSize = 4, padLeft = 0, padTop = 0, scrollLeft = 0, scrollTop = 0 }) {
  const lines = text.split('\n');
  const row = Math.max(0, Math.min(lines.length - 1, Math.floor((y - padTop + scrollTop) / lineHeight)));
  const col = Math.max(0, Math.round((x - padLeft + scrollLeft) / charWidth));
  // walk the line, counting tabs to the next tab stop
  const line = lines[row];
  let visual = 0;
  let i = 0;
  while (i < line.length) {
    const w = line[i] === '\t' ? tabSize - (visual % tabSize) : 1;
    if (visual + w / 2 >= col) break;
    visual += w;
    i++;
  }
  let offset = 0;
  for (let r = 0; r < row; r++) offset += lines[r].length + 1;
  return offset + i;
}

// The text to insert for dropped files: each file's contents, one after another,
// each ending in a new line so the next starts on its own line.
export function dropText(files) {
  return files.map((f) => (f.content.endsWith('\n') ? f.content : `${f.content}\n`)).join('');
}

// Dropped files go in as whole lines: a drop in the middle or at the end of a line goes in
// at the start of the next line. On the last line, with no line after it, it starts a new one.
// Returns { at, prefix }: where to insert, and anything to put first.
export function dropPosition(text, at) {
  if (at === 0 || text[at - 1] === '\n') return { at, prefix: '' };
  const next = text.indexOf('\n', at);
  if (next >= 0) return { at: next + 1, prefix: '' };
  return { at: text.length, prefix: '\n' };
}

// Files iEdit won't paste in: likely binary (a NUL character) or very large.
export function unsuitable(file, maxBytes = 2_000_000) {
  if (file.content.includes('\u0000')) return 'it looks like a binary file';
  if (file.content.length > maxBytes) return 'it is over 2 MB';
  return null;
}
