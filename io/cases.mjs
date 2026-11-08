// The functions whose inputs and outputs are recorded in io/ios.txt (see io/engine.mjs).
import { buildRegex, findAll, replaceAll, fileMatcher } from '../lib/search.js';
import { languageFor, highlight, countStats } from '../lib/highlight.js';
import { offsetAtPoint, dropPosition } from '../lib/drop.js';

export const title = 'iEdit';

const CODE = ['main :- writeln("hi"), X is 1 + 2.', 'const x = 1; // note\nfunction f(a) { return a * 2; }', '# Title\n\nSome *text* here.', 'def f(x):\n    return x + 1  # add', '{"a": 1, "b": [true, null]}', '<p class="x">Hi</p>'];
const FILES = ['a.pl', 'b.js', 'README.md', 'x.py', 'data.json', 'page.html', 'notes.txt', 'Makefile', 'style.css', 'run.sh'];
const re = (q) => { try { return buildRegex(...q); } catch (e) { return null; } };

export const cases = [
  { name: 'buildRegex', run: (q, o) => { const r = buildRegex(q, o); return r ? { source: r.source, flags: r.flags } : r; }, make: (rnd) => [rnd.pick(['cat', 'a.b', '\\d+', 'word', 'foo(', 'x|y', '[A-Z]']), { caseSensitive: rnd.chance(0.5), wholeWord: rnd.chance(0.5), regex: rnd.chance(0.5) }] },
  { name: 'findAll', run: (text, q, o) => { const r = re([q, o]); return r ? findAll(text, r) : 'bad pattern'; }, make: (rnd) => [Array.from({ length: rnd.int(1, 3) }, () => rnd.sentence()).join('\n'), rnd.pick(['the', 'a', 'Book', 'logic', 'e.', 'o\\w']), { caseSensitive: rnd.chance(0.3), wholeWord: rnd.chance(0.5), regex: rnd.chance(0.3) }] },
  { name: 'replaceAll', run: (text, q, rep, o) => { const r = re([q, o]); return r ? replaceAll(text, r, rep, o) : 'bad pattern'; }, make: (rnd) => [rnd.sentence(), rnd.pick(['the', 'a', '(\\w+)ing', 'o']), rnd.pick(['THE', '[$1]', '', '$&$&']), { regex: rnd.chance(0.5), wholeWord: rnd.chance(0.5) }] },
  { name: 'fileMatcher', run: (pattern, names) => { const m = fileMatcher(pattern); return names.filter((n) => m(n)); }, make: (rnd) => [rnd.pick(['*.pl', '*.js', '*.{js,md}', 'README*', '', '*', '*.txt', '!*.md']), FILES] },
  { name: 'languageFor', run: languageFor, make: (rnd) => [rnd.pick(FILES)] },
  { name: 'highlight', run: highlight, make: (rnd) => { const i = rnd.int(0, CODE.length - 1); return [CODE[i], ['prolog', 'js', 'markdown', 'python', 'json', 'html'][i]]; } },
  { name: 'countStats', run: countStats, make: (rnd) => { const t = Array.from({ length: rnd.int(1, 4) }, () => rnd.sentence()).join('\n'); return [t, rnd.int(0, t.length)]; } },
  { name: 'offsetAtPoint', run: offsetAtPoint, make: (rnd) => [Array.from({ length: rnd.int(1, 5) }, () => rnd.words(1, 6)).join('\n') + (rnd.chance(0.3) ? '\n\tindented' : ''), { x: rnd.int(-5, 400), y: rnd.int(-5, 120), lineHeight: 20, charWidth: 8, padLeft: rnd.pick([0, 6]), padTop: rnd.pick([0, 4]), scrollTop: rnd.pick([0, 20]) }] },
  { name: 'dropPosition', run: dropPosition, make: (rnd) => { const t = Array.from({ length: rnd.int(1, 3) }, () => rnd.words(1, 5)).join('\n'); return [t, rnd.int(-2, t.length + 2)]; } }
];
