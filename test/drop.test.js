import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dropPosition, dropText, offsetAtPoint, unsuitable } from '../lib/drop.js';

const m = { lineHeight: 20, charWidth: 8, padLeft: 10, padTop: 10 };

test('a point maps to a line and column', () => {
  const text = 'abc\nhello world\n\tx';
  assert.equal(offsetAtPoint(text, { ...m, x: 10, y: 10 }), 0); // start
  assert.equal(offsetAtPoint(text, { ...m, x: 10 + 8 * 5, y: 35 }), 4 + 5); // line 2, after "hello"
  assert.equal(offsetAtPoint(text, { ...m, x: 10 + 8 * 2 + 3, y: 12 }), 2); // rounds to the nearer gap
  assert.equal(offsetAtPoint(text, { ...m, x: 900, y: 12 }), 3); // past the end of a line: its end
  assert.equal(offsetAtPoint(text, { ...m, x: 10, y: 900 }), text.length - 2); // below the text: last line
  // a tab is 4 columns wide: column 4 is just after it
  assert.equal(offsetAtPoint(text, { ...m, x: 10 + 8 * 4, y: 50 }), 16 + 1);
  assert.equal(offsetAtPoint(text, { ...m, x: 10 + 8 * 1, y: 50 }), 16); // inside the tab: before it
  // scrolled down one line and right two columns
  assert.equal(offsetAtPoint(text, { ...m, x: 10, y: 10, scrollTop: 20, scrollLeft: 16 }), 4 + 2);
});

test('dropped files go in whole, each on its own lines', () => {
  assert.equal(dropText([{ content: 'one' }, { content: 'two\n' }]), 'one\ntwo\n');
  const t = 'line one\nline two';
  assert.deepEqual(dropPosition(t, 0), { at: 0, prefix: '' }); // start of a line: there
  assert.deepEqual(dropPosition(t, 9), { at: 9, prefix: '' });
  assert.deepEqual(dropPosition(t, 4), { at: 9, prefix: '' }); // mid-line: the next line
  assert.deepEqual(dropPosition(t, 8), { at: 9, prefix: '' }); // end of a line: the next line
  assert.deepEqual(dropPosition(t, 12), { at: t.length, prefix: '\n' }); // last line: a new line
  assert.deepEqual(dropPosition('', 0), { at: 0, prefix: '' });
  assert.equal(unsuitable({ content: 'a\u0000b' }), 'it looks like a binary file');
  assert.equal(unsuitable({ content: 'fine' }), null);
});
