import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countStats, escapeHtml, highlight, languageFor } from '../lib/highlight.js';
import { buildRegex, fileMatcher, findAll, replaceAll, replaceAt } from '../lib/search.js';

const stripTags = (html) => html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

test('find: plain, case, whole word, regex', () => {
  const text = 'Cat cat catalog\nconcat cat.';
  assert.equal(findAll(text, buildRegex('cat')).length, 5);
  assert.equal(findAll(text, buildRegex('cat', { caseSensitive: true })).length, 4);
  assert.equal(findAll(text, buildRegex('cat', { wholeWord: true })).length, 3);
  const hits = findAll(text, buildRegex('c(a|o)n', { regex: true }));
  assert.deepEqual(hits.map((h) => [h.line, h.col]), [[2, 1]]);
  assert.equal(hits[0].text, 'concat cat.');
});

test('find: special characters are literal outside regex mode', () => {
  assert.equal(findAll('a.b axb', buildRegex('a.b')).length, 1);
  assert.equal(findAll('a.b axb', buildRegex('a.b', { regex: true })).length, 2);
});

test('find: bad regex gives a readable error', () => {
  assert.throws(() => buildRegex('(', { regex: true }), /Regular expression problem/);
});

test('replace all: literal and with groups', () => {
  let r = replaceAll('a $1 a', buildRegex('a'), '$1');
  assert.deepEqual(r, { text: '$1 $1 $1', count: 2 });
  r = replaceAll('john smith\njane doe', buildRegex('^(\\w+) (\\w+)$', { regex: true }), '$2, $1', { regex: true });
  assert.deepEqual(r, { text: 'smith, john\ndoe, jane', count: 2 });
});

test('replace one match at a position', () => {
  const re = buildRegex('x');
  const r = replaceAt('x x x', re, 2, 'YY');
  assert.equal(r.text, 'x YY x');
  assert.equal(replaceAt('x x x', re, 1, 'YY'), null);
});

test('file matcher', () => {
  const m = fileMatcher('*.pl, *.txt');
  assert.ok(m('a.pl'));
  assert.ok(m('NOTES.TXT'));
  assert.ok(!m('a.js'));
});

test('highlighting keeps the text exactly and escapes HTML', () => {
  const samples = {
    prolog: "a(X, 'q q', \"s % t\") :- X is 1 + 2, !. % done\n/* block */ b --> [x].",
    js: 'const x = `a ${b}` // c\nfunction f() { return "<b>"; }',
    html: '<a href="x">y &amp; z</a><!-- c -->',
    markdown: '# Title\n- item `code` **bold** [l](u)\n```\n<raw>\n```'
  };
  for (const [lang, text] of Object.entries(samples)) {
    const html = highlight(text, lang);
    assert.equal(stripTags(html), text, lang);
    assert.doesNotMatch(html.replace(/<\/?span[^>]*>/g, ''), /<(?!\/?span)/, lang);
  }
  assert.match(highlight('foo(X) :- bar.', 'prolog'), /t-var">X</);
  assert.match(highlight("% c\nx.", 'prolog'), /t-comment">% c</);
  assert.equal(escapeHtml('<&>'), '&lt;&amp;&gt;');
});

test('language from file name', () => {
  assert.equal(languageFor('a/b/x.pl'), 'prolog');
  assert.equal(languageFor('README.md'), 'markdown');
  assert.equal(languageFor('index.html'), 'html');
  assert.equal(languageFor('a.json'), 'js');
  assert.equal(languageFor('file.txt'), 'plain');
});

test('status bar counts', () => {
  assert.deepEqual(countStats('one two\nthree', 9), { chars: 13, words: 3, lines: 2, line: 2, col: 2 });
  assert.deepEqual(countStats('', 0), { chars: 0, words: 0, lines: 1, line: 1, col: 1 });
});
