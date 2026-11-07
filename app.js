// iEdit: multi-window text editor for the LucianOS suite.
import { api } from '/shared/api.js';
import { dropPosition, dropText, offsetAtPoint, unsuitable } from './lib/drop.js';
import { countStats, highlight, languageFor } from './lib/highlight.js';
import { REGEX_HELPERS, buildRegex, fileMatcher, findAll, replaceAll, replaceAt } from './lib/search.js';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c !== null && c !== undefined));
  return node;
};
const MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = MAC ? '⌘' : 'Ctrl+';
const HIGHLIGHT_LIMIT = 400_000; // characters; bigger files show without colours
const dirOf = (p) => p.split('/').slice(0, -1).join('/');
const nameOf = (p) => p.split('/').pop();

let windows = [];
let active = null;
let fontSize = 13;
let recentFolders = [];
let zTop = 10;
let untitledCount = 0;
const watchers = new Map(); // folder -> { close, count }

function notice(text, kind = 'quiet') {
  $('notice').textContent = text;
  $('notice').className = `status ${kind}`;
  clearTimeout(notice.t);
  if (text) notice.t = setTimeout(() => ($('notice').textContent = ''), 6000);
}

// ======================= Editor window =======================
class EditorWindow {
  constructor({ path = null, text = '', mtimeMs = null, dirty = false, geometry = null, cursor = 0, title = null }) {
    this.path = path;
    this.mtimeMs = mtimeMs;
    this.dirty = dirty;
    this.untitled = title ?? (path ? null : `Untitled ${++untitledCount}`);
    this.lang = languageFor(path ?? '');
    this.changedOnDisk = false;

    this.titleEl = el('span', { className: 'title' });
    const closeBtn = el('button', { textContent: '✕', title: 'Close window', onclick: (e) => { e.stopPropagation(); this.close(); } });
    this.titlebar = el('div', { className: 'titlebar' }, this.titleEl, closeBtn);
    this.gutter = el('div', { className: 'gutter', ariaHidden: 'true' });
    this.pre = el('pre', { ariaHidden: 'true' });
    this.ta = el('textarea', { spellcheck: false, autocapitalize: 'off', autocomplete: 'off' });
    this.ta.setAttribute('autocorrect', 'off');
    this.ta.setAttribute('wrap', 'off');
    this.ta.value = text;
    this.pathEl = el('span', { className: 'path', title: 'Show this folder' });
    this.posEl = el('span');
    this.countEl = el('span');
    this.warnEl = el('span', { className: 'warn' });
    this.root = el('div', { className: 'win' },
      this.titlebar,
      el('div', { className: 'code' }, this.gutter, el('div', { className: 'layers' }, this.pre, this.ta)),
      el('div', { className: 'statusbar' }, this.pathEl, this.warnEl, this.posEl, this.countEl));

    this.place(geometry);
    $('desktop').append(this.root);
    this.wire();
    this.lineCount = -1;
    this.refresh();
    this.renderTitle();
    if (cursor) this.ta.setSelectionRange(cursor, cursor);
    if (path) watchFolder(dirOf(path));
  }

  get displayName() {
    return this.path ? nameOf(this.path) : this.untitled;
  }

  place(g) {
    const n = windows.length;
    const d = $('desktop').getBoundingClientRect();
    const w = g?.w ?? Math.min(760, Math.max(320, d.width - 80));
    const h = g?.h ?? Math.min(560, Math.max(240, d.height - 80));
    const x = g?.x ?? 24 + (n % 8) * 28;
    const y = g?.y ?? 16 + (n % 8) * 28;
    Object.assign(this.root.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
  }

  geometry() {
    const s = this.root.style;
    return { x: parseInt(s.left, 10), y: parseInt(s.top, 10), w: this.root.offsetWidth || parseInt(s.width, 10), h: this.root.offsetHeight || parseInt(s.height, 10) };
  }

  wire() {
    this.root.addEventListener('pointerdown', () => this.focus(false), true);
    // drag by the title bar
    this.titlebar.addEventListener('pointerdown', (e) => {
      if (e.target.tagName === 'BUTTON' || matchMedia('(max-width: 760px)').matches) return;
      const start = { x: e.clientX, y: e.clientY, left: this.root.offsetLeft, top: this.root.offsetTop };
      this.titlebar.setPointerCapture(e.pointerId);
      const move = (ev) => {
        this.root.style.left = `${Math.max(-this.root.offsetWidth + 80, start.left + ev.clientX - start.x)}px`;
        this.root.style.top = `${Math.max(0, start.top + ev.clientY - start.y)}px`;
      };
      const up = () => {
        this.titlebar.removeEventListener('pointermove', move);
        this.titlebar.removeEventListener('pointerup', up);
        saveSession();
      };
      this.titlebar.addEventListener('pointermove', move);
      this.titlebar.addEventListener('pointerup', up);
    });
    new ResizeObserver(() => saveSession()).observe(this.root);

    this.ta.addEventListener('input', () => {
      this.setDirty(true);
      this.refresh();
      saveSession();
    });
    this.ta.addEventListener('scroll', () => this.syncScroll());
    for (const ev of ['keyup', 'click', 'select']) this.ta.addEventListener(ev, () => this.updateStatus());
    this.ta.addEventListener('keydown', (e) => this.onKey(e));
    this.pathEl.addEventListener('click', () => {
      if (this.path) openDialog({ mode: 'open', folder: dirOf(this.path) }).then((p) => p && openPath(p));
    });
  }

  onKey(e) {
    if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      insertText(this.ta, '\t');
    } else if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      // keep the indentation of the current line
      const v = this.ta.value;
      const start = v.lastIndexOf('\n', this.ta.selectionStart - 1) + 1;
      const indent = v.slice(start).match(/^[\t ]*/)[0];
      if (indent) {
        e.preventDefault();
        insertText(this.ta, '\n' + indent);
      }
    }
  }

  refresh() {
    const text = this.ta.value;
    // trailing newline + space so the last line lines up with the textarea
    this.pre.innerHTML = (text.length > HIGHLIGHT_LIMIT ? highlight(text, 'plain') : highlight(text, this.lang)) + '\n ';
    const lines = text.split('\n').length;
    if (lines !== this.lineCount) {
      this.lineCount = lines;
      let s = '';
      for (let i = 1; i <= lines; i++) s += i + '\n';
      this.gutter.textContent = s;
    }
    this.syncScroll();
    this.updateStatus();
  }

  syncScroll() {
    this.pre.scrollTop = this.ta.scrollTop;
    this.pre.scrollLeft = this.ta.scrollLeft;
    this.gutter.scrollTop = this.ta.scrollTop;
  }

  updateStatus() {
    const s = countStats(this.ta.value, this.ta.selectionStart);
    this.posEl.textContent = `Line ${s.line}, Col ${s.col}`;
    const sel = this.ta.selectionEnd - this.ta.selectionStart;
    this.countEl.textContent = `${s.chars} chars · ${s.words} words · ${s.lines} lines${sel ? ` · ${sel} selected` : ''}`;
    this.pathEl.textContent = this.path ?? '(not saved yet)';
    this.warnEl.textContent = this.changedOnDisk ? 'Changed on disk' : '';
  }

  renderTitle() {
    this.titleEl.replaceChildren(this.dirty ? el('span', { className: 'dot', textContent: '● ' }) : '', this.displayName);
    this.root.title = this.path ?? this.displayName;
    renderTabs();
    renderWindowMenu();
  }

  setDirty(v) {
    if (this.dirty === v) return;
    this.dirty = v;
    this.renderTitle();
  }

  focus(focusText = true) {
    if (active && active !== this) active.root.classList.remove('active');
    active = this;
    this.root.classList.add('active');
    this.root.style.zIndex = ++zTop;
    if (focusText) this.ta.focus();
    renderTabs();
  }

  setText(text) {
    // replace the whole text but keep undo where the browser allows it
    this.ta.focus();
    this.ta.select();
    if (!document.execCommand('insertText', false, text)) this.ta.value = text;
    this.refresh();
  }

  select(index, length) {
    this.focus();
    this.ta.setSelectionRange(index, index + length);
    const line = this.ta.value.slice(0, index).split('\n').length;
    const lineH = parseFloat(getComputedStyle(this.ta).lineHeight);
    const target = (line - 1) * lineH - this.ta.clientHeight / 3;
    this.ta.scrollTop = Math.max(0, target);
    this.syncScroll();
    this.updateStatus();
  }

  goToLine(n) {
    const lines = this.ta.value.split('\n');
    n = Math.max(1, Math.min(n, lines.length));
    let index = 0;
    for (let i = 0; i < n - 1; i++) index += lines[i].length + 1;
    this.select(index, 0);
  }

  async save({ as = false, force = false } = {}) {
    let path = this.path;
    if (as || !path) {
      path = await openDialog({ mode: 'save', folder: path ? dirOf(path) : recentFolders[0] ?? '', name: path ? nameOf(path) : `${this.untitled}.txt` });
      if (!path) return false;
    }
    try {
      const info = await api.files.write(path, this.ta.value, path === this.path && !force ? { baseMtime: this.mtimeMs } : { force: true });
      const moved = path !== this.path;
      if (moved && this.path) unwatchFolder(dirOf(this.path));
      if (moved) watchFolder(dirOf(path));
      this.path = info.path;
      this.mtimeMs = info.mtimeMs;
      this.lang = languageFor(this.path);
      this.changedOnDisk = false;
      this.setDirty(false);
      this.refresh();
      this.renderTitle();
      rememberFolder(dirOf(this.path));
      saveSession();
      notice(`Saved ${this.path}`, 'ok');
      return true;
    } catch (err) {
      if (err.status === 409) {
        if (confirm(`${nameOf(path)} changed on disk since you opened it. Overwrite it with your version?`)) return this.save({ force: true });
        return false;
      }
      notice(`Could not save: ${err.message}`, 'error');
      return false;
    }
  }

  async reloadFromDisk() {
    if (!this.path) return;
    const f = await api.files.read(this.path);
    if (f.mtimeMs === this.mtimeMs) return;
    if (this.dirty) {
      this.changedOnDisk = true;
      this.updateStatus();
      return;
    }
    const cursor = this.ta.selectionStart;
    const scroll = this.ta.scrollTop;
    this.ta.value = f.content;
    this.mtimeMs = f.mtimeMs;
    this.refresh();
    this.ta.setSelectionRange(Math.min(cursor, f.content.length), Math.min(cursor, f.content.length));
    this.ta.scrollTop = scroll;
    this.syncScroll();
    notice(`${nameOf(this.path)} was updated from disk`);
  }

  async close({ ask = true } = {}) {
    if (ask && this.dirty) {
      const answer = confirm(`Save changes to ${this.displayName} before closing?\n\nOK = Save, Cancel = choose again`);
      if (answer) {
        if (!(await this.save())) return false;
      } else if (!confirm(`Close ${this.displayName} without saving? Your changes will be lost.`)) {
        return false;
      }
    }
    if (this.path) unwatchFolder(dirOf(this.path));
    this.root.remove();
    windows = windows.filter((w) => w !== this);
    if (active === this) {
      active = null;
      windows.at(-1)?.focus();
    }
    renderTabs();
    renderWindowMenu();
    $('empty').classList.toggle('hidden', windows.length > 0);
    saveSession();
    return true;
  }

  snapshot() {
    return {
      path: this.path,
      untitled: this.untitled,
      mtimeMs: this.mtimeMs,
      dirty: this.dirty,
      text: this.dirty || !this.path ? this.ta.value : undefined, // unsaved work survives closing the page
      cursor: this.ta.selectionStart,
      geometry: this.geometry()
    };
  }
}

function insertText(ta, text) {
  if (!document.execCommand('insertText', false, text)) ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end');
}

function addWindow(opts) {
  const w = new EditorWindow(opts);
  windows.push(w);
  w.focus();
  $('empty').classList.add('hidden');
  renderWindowMenu();
  return w;
}

async function openPath(path, { line } = {}) {
  const existing = windows.find((w) => w.path === path);
  if (existing) {
    existing.focus();
    if (line) existing.goToLine(line);
    return existing;
  }
  try {
    const f = await api.files.read(path);
    const w = addWindow({ path: f.path, text: f.content, mtimeMs: f.mtimeMs });
    rememberFolder(dirOf(f.path));
    if (line) w.goToLine(line);
    saveSession();
    return w;
  } catch (err) {
    notice(`Could not open ${path}: ${err.message}`, 'error');
    return null;
  }
}

// ======================= watching for changes on disk =======================
function watchFolder(folder) {
  const entry = watchers.get(folder);
  if (entry) {
    entry.count++;
    return;
  }
  const close = api.files.watch(folder, ({ path }) => {
    for (const w of windows) if (w.path === path) w.reloadFromDisk().catch(() => {});
  });
  watchers.set(folder, { close, count: 1 });
}

function unwatchFolder(folder) {
  const entry = watchers.get(folder);
  if (!entry) return;
  if (--entry.count <= 0) {
    entry.close();
    watchers.delete(folder);
  }
}

// ======================= session (windows saved from last time) =======================
let sessionTimer;
function saveSession() {
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(() => {
    api.state.set('iedit', {
      fontSize,
      recentFolders,
      activePath: active?.path ?? null,
      windows: windows.map((w) => w.snapshot())
    }).catch(() => {});
  }, 600);
}

function rememberFolder(folder) {
  recentFolders = [folder, ...recentFolders.filter((f) => f !== folder)].slice(0, 12);
}

async function restoreSession() {
  const s = (await api.state.get('iedit').catch(() => null)) ?? {};
  fontSize = s.fontSize ?? 13;
  recentFolders = s.recentFolders ?? [];
  applyFontSize();
  for (const snap of s.windows ?? []) {
    if (snap.path && !snap.dirty) {
      const w = await openPath(snap.path);
      if (w) {
        w.place(snap.geometry);
        w.ta.setSelectionRange(snap.cursor ?? 0, snap.cursor ?? 0);
      }
    } else {
      // unsaved work: restore the text, check whether the file moved on since
      let mtimeMs = snap.mtimeMs;
      let changed = false;
      if (snap.path) {
        try {
          const f = await api.files.read(snap.path);
          changed = f.mtimeMs !== snap.mtimeMs;
        } catch {}
      }
      const w = addWindow({ path: snap.path, text: snap.text ?? '', mtimeMs, dirty: !!snap.dirty, geometry: snap.geometry, cursor: snap.cursor, title: snap.untitled });
      w.changedOnDisk = changed;
      w.updateStatus();
    }
  }
  const act = windows.find((w) => w.path && w.path === s.activePath);
  act?.focus();
  if (windows.some((w) => w.dirty)) notice('Restored your unsaved changes from last time');
}

// ======================= file dialog =======================
let fdState = null;
function openDialog({ mode, folder = '', name = '' }) {
  return new Promise((resolve) => {
    fdState = { mode, folder, resolve, selected: null };
    $('fdTitle').textContent = mode === 'open' ? 'Open' : 'Save as';
    $('fdOk').textContent = mode === 'open' ? 'Open' : 'Save';
    $('fdName').value = name;
    $('fdName').classList.toggle('hidden', mode === 'open');
    $('fdError').textContent = '';
    $('fdRecent').replaceChildren(el('option', { value: '', textContent: 'Recent folders…' }),
      ...recentFolders.map((f) => el('option', { value: `f:${f}`, textContent: f || 'Home' })));
    fdShow(folder).catch(() => fdShow(''));
    $('fileDialog').showModal();
    if (mode === 'save') $('fdName').select();
  });
}

async function fdShow(folder) {
  const { path, entries } = await api.files.list(folder);
  fdState.folder = path;
  fdState.selected = null;
  const crumbs = $('fdCrumbs');
  crumbs.replaceChildren(el('button', { type: 'button', textContent: 'Home', onclick: () => fdShow('') }));
  const parts = path ? path.split('/') : [];
  parts.forEach((p, i) => crumbs.append(el('button', { type: 'button', textContent: p, onclick: () => fdShow(parts.slice(0, i + 1).join('/')) })));
  const list = $('fdList');
  list.replaceChildren();
  for (const e of entries) {
    const li = el('li', {}, el('span', { className: 'icon', textContent: e.type === 'dir' ? '📁' : '📄' }), el('span', { className: 'name', textContent: e.name }));
    li.addEventListener('click', () => {
      list.querySelectorAll('.selected').forEach((n) => n.classList.remove('selected'));
      li.classList.add('selected');
      fdState.selected = e;
      if (e.type === 'file') $('fdName').value = e.name;
    });
    li.addEventListener('dblclick', () => {
      if (e.type === 'dir') fdShow(e.path);
      else fdFinish(e.path);
    });
    list.append(li);
  }
}

function fdFinish(path) {
  const { resolve } = fdState;
  fdState.resolve = null;
  $('fileDialog').close();
  resolve(path);
}

$('fileDialog').addEventListener('close', () => {
  if (!fdState?.resolve) return;
  if ($('fileDialog').returnValue !== 'ok') {
    fdState.resolve(null);
    fdState.resolve = null;
  }
});
$('fdOk').addEventListener('click', (e) => {
  e.preventDefault();
  const { mode, folder, selected } = fdState;
  if (mode === 'open') {
    if (!selected) return ($('fdError').textContent = 'Choose a file');
    if (selected.type === 'dir') return fdShow(selected.path);
    return fdFinish(selected.path);
  }
  const name = $('fdName').value.trim();
  if (!name || name.includes('/')) return ($('fdError').textContent = 'Type a file name (no slashes)');
  if (selected?.type === 'dir' && selected.name === name) return fdShow(selected.path);
  const path = folder ? `${folder}/${name}` : name;
  const exists = [...$('fdList').querySelectorAll('.name')].some((n) => n.textContent === name);
  if (exists && !confirm(`${name} already exists. Replace it?`)) return;
  fdFinish(path);
});
$('fdRecent').addEventListener('change', () => {
  const v = $('fdRecent').value;
  if (v.startsWith('f:')) fdShow(v.slice(2));
  $('fdRecent').value = '';
});
$('fdNewFolder').addEventListener('click', async () => {
  const name = prompt('New folder name');
  if (!name) return;
  try {
    const p = fdState.folder ? `${fdState.folder}/${name}` : name;
    await api.files.mkdir(p);
    await fdShow(p);
  } catch (err) {
    $('fdError').textContent = err.message;
  }
});

// ======================= find and replace =======================
let lastMatch = null;
function findOptions() {
  return { caseSensitive: $('optCase').checked, wholeWord: $('optWord').checked, regex: $('optRegex').checked };
}

function currentRegex() {
  try {
    return buildRegex($('findText').value, findOptions());
  } catch (err) {
    $('findStatus').textContent = err.message;
    $('findStatus').className = 'status error';
    return null;
  }
}

function findStatus(text, kind = 'quiet') {
  $('findStatus').textContent = text;
  $('findStatus').className = `status ${kind}`;
}

function showFind() {
  $('findbar').classList.remove('hidden');
  const sel = active ? active.ta.value.slice(active.ta.selectionStart, active.ta.selectionEnd) : '';
  if (sel && !sel.includes('\n')) $('findText').value = sel;
  $('findText').focus();
  $('findText').select();
}

function findStep(dir) {
  const w = active;
  if (!w) return findStatus('Open a file first');
  const re = currentRegex();
  if (!re) return;
  const hits = findAll(w.ta.value, re);
  if (!hits.length) {
    lastMatch = null;
    return findStatus('No matches');
  }
  const pos = dir > 0 ? w.ta.selectionEnd : w.ta.selectionStart;
  let i = dir > 0 ? hits.findIndex((h) => h.index >= pos) : hits.findLastIndex((h) => h.index + h.length <= pos && h.index < pos);
  if (i === -1) i = dir > 0 ? 0 : hits.length - 1;
  const h = hits[i];
  w.select(h.index, h.length);
  lastMatch = { w, index: h.index };
  findStatus(`${i + 1} of ${hits.length}`);
  $('findText').focus();
}

function replaceOne() {
  const w = active;
  const re = currentRegex();
  if (!w || !re) return;
  const start = w.ta.selectionStart;
  const r = replaceAt(w.ta.value, re, start, $('replaceText').value, findOptions());
  if (!r || w.ta.selectionEnd === start) return findStep(1);
  w.ta.focus();
  w.ta.setSelectionRange(start, w.ta.selectionEnd);
  insertText(w.ta, r.text.slice(start, start + r.length));
  findStep(1);
}

async function filesInScope() {
  const scope = $('scope').value;
  if (scope === 'file') return active ? [{ win: active, path: active.path, text: active.ta.value }] : [];
  if (scope === 'open') return windows.map((w) => ({ win: w, path: w.path, text: w.ta.value }));
  // folder: walk it (up to 500 files), using open windows' text where a file is open
  const match = fileMatcher($('scopePattern').value);
  const out = [];
  const stack = [$('scopeFolder').value.trim()];
  while (stack.length && out.length < 500) {
    const { entries } = await api.files.list(stack.pop());
    for (const e of entries) {
      if (e.type === 'dir') stack.push(e.path);
      else if (match(e.name) && e.size < 2_000_000) out.push({ path: e.path });
    }
  }
  for (const f of out) {
    const w = windows.find((x) => x.path === f.path);
    if (w) {
      f.win = w;
      f.text = w.ta.value;
    } else {
      try {
        const r = await api.files.read(f.path);
        f.text = r.content;
        f.mtimeMs = r.mtimeMs;
      } catch {
        f.text = null;
      }
    }
  }
  return out.filter((f) => typeof f.text === 'string' && !f.text.includes('\u0000'));
}

async function findEverywhere() {
  const re = currentRegex();
  if (!re) return;
  findStatus('Searching…');
  const files = await filesInScope();
  const list = $('findResults');
  list.replaceChildren();
  let total = 0;
  for (const f of files) {
    const hits = findAll(f.text, re, 2000);
    total += hits.length;
    for (const h of hits.slice(0, 200)) {
      const li = el('li', {}, el('span', { className: 'where', textContent: `${f.path ?? f.win.displayName}:${h.line}  ` }), h.text.trim());
      li.addEventListener('click', async () => {
        const w = f.win && windows.includes(f.win) ? f.win : await openPath(f.path);
        if (!w) return;
        const fresh = findAll(w.ta.value, re).find((x) => x.line === h.line && x.col === h.col) ?? h;
        w.select(fresh.index, fresh.length);
      });
      list.append(li);
    }
  }
  list.classList.toggle('hidden', total === 0);
  findStatus(total ? `${total} matches in ${files.filter((f) => findAll(f.text, re, 1).length).length} file(s)` : 'No matches', total ? 'ok' : 'quiet');
}

async function replaceEverywhere() {
  const re = currentRegex();
  if (!re) return;
  const opts = findOptions();
  const rep = $('replaceText').value;
  const files = await filesInScope();
  const plans = files.map((f) => ({ f, ...replaceAll(f.text, re, rep, opts) })).filter((p) => p.count);
  const total = plans.reduce((n, p) => n + p.count, 0);
  if (!total) return findStatus('No matches');
  const onDisk = plans.filter((p) => !p.f.win).length;
  if (!confirm(`Replace ${total} match(es) in ${plans.length} file(s)?${onDisk ? `\n\n${onDisk} file(s) are not open and will be saved straight away.` : ''}`)) return;
  let saved = 0;
  for (const p of plans) {
    if (p.f.win) {
      p.f.win.setText(p.text);
      p.f.win.setDirty(true);
    } else {
      try {
        await api.files.write(p.f.path, p.text, { baseMtime: p.f.mtimeMs });
        saved++;
      } catch (err) {
        notice(`${p.f.path}: ${err.message}`, 'error');
      }
    }
  }
  saveSession();
  $('findResults').replaceChildren();
  $('findResults').classList.add('hidden');
  findStatus(`Replaced ${total} match(es)${saved ? `; saved ${saved} file(s)` : ''}. Open windows still need saving.`, 'ok');
}

$('scope').addEventListener('change', () => {
  const folder = $('scope').value === 'folder';
  $('scopeFolder').classList.toggle('hidden', !folder);
  $('scopePattern').classList.toggle('hidden', !folder);
  if (folder && !$('scopeFolder').value && active?.path) $('scopeFolder').value = dirOf(active.path);
});
$('optRegex').addEventListener('change', () => $('regexHelp').classList.toggle('hidden', !$('optRegex').checked));
for (const h of REGEX_HELPERS) $('regexHelp').append(el('option', { value: h.text, textContent: `${h.label}   ${h.text}` }));
$('regexHelp').addEventListener('change', () => {
  const input = $('findText');
  const v = $('regexHelp').value;
  if (v) {
    input.setRangeText(v, input.selectionStart ?? input.value.length, input.selectionEnd ?? input.value.length, 'end');
    input.focus();
  }
  $('regexHelp').value = '';
});
$('findNext').addEventListener('click', () => findStep(1));
$('findPrev').addEventListener('click', () => findStep(-1));
$('findAll').addEventListener('click', () => findEverywhere().catch((e) => findStatus(e.message, 'error')));
$('replaceOne').addEventListener('click', replaceOne);
$('replaceAll').addEventListener('click', () => replaceEverywhere().catch((e) => findStatus(e.message, 'error')));
$('findClose').addEventListener('click', () => { $('findbar').classList.add('hidden'); $('findResults').classList.add('hidden'); active?.ta.focus(); });
$('findText').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); $('scope').value === 'file' ? findStep(e.shiftKey ? -1 : 1) : findEverywhere(); }
  if (e.key === 'Escape') $('findClose').click();
});

// ======================= menus =======================
const MENUS = {
  file: [
    { label: 'New', action: () => addWindow({}) },
    { label: 'Open…', key: `${MOD}O`, action: async () => { const p = await openDialog({ mode: 'open', folder: active?.path ? dirOf(active.path) : recentFolders[0] ?? '' }); if (p) openPath(p); } },
    null,
    { label: 'Save', key: `${MOD}S`, action: () => active?.save() },
    { label: 'Save as…', key: `⇧${MOD}S`, action: () => active?.save({ as: true }) },
    { label: 'Save all', action: saveAll },
    null,
    { label: 'Revert to saved', action: async () => { if (active?.path && confirm('Throw away your changes and reload the saved file?')) { active.setDirty(false); active.mtimeMs = -1; await active.reloadFromDisk(); } } },
    { label: 'Close window', action: () => active?.close() },
    { label: 'Close all', action: async () => { for (const w of [...windows]) if (!(await w.close())) break; } },
    { label: 'Quit (close all and leave)', action: quit }
  ],
  edit: [
    { label: 'Undo', key: `${MOD}Z`, action: () => { active?.ta.focus(); document.execCommand('undo'); } },
    { label: 'Redo', key: `⇧${MOD}Z`, action: () => { active?.ta.focus(); document.execCommand('redo'); } },
    null,
    { label: 'Select all', key: `${MOD}A`, action: () => { active?.ta.focus(); active?.ta.select(); active?.updateStatus(); } },
    { label: 'Find and replace…', key: `${MOD}F`, action: showFind },
    { label: 'Find next', key: `${MOD}G`, action: () => findStep(1) },
    { label: 'Go to line…', action: () => { const n = parseInt(prompt('Go to line'), 10); if (n) active?.goToLine(n); } }
  ],
  view: [
    { label: 'Bigger text', key: `${MOD}+`, action: () => { fontSize = Math.min(28, fontSize + 1); applyFontSize(); } },
    { label: 'Smaller text', key: `${MOD}−`, action: () => { fontSize = Math.max(9, fontSize - 1); applyFontSize(); } },
    { label: 'Normal size', action: () => { fontSize = 13; applyFontSize(); } },
    null,
    { label: 'Tile windows', action: tile }
  ]
};

function buildMenu(name, items) {
  const box = document.querySelector(`.menu[data-menu="${name}"] .items`);
  box.replaceChildren(...items.map((it) => it === null ? el('hr') :
    el('button', { onclick: () => { closeMenus(); it.action(); } }, el('span', { textContent: it.label }), el('span', { className: 'key', textContent: it.key ?? '' }))));
}

function renderWindowMenu() {
  const items = windows.map((w) => ({ label: `${w.dirty ? '● ' : ''}${w.displayName}`, action: () => w.focus() }));
  buildMenu('window', items.length ? items : [{ label: 'No windows open', action: () => {} }]);
}

function renderTabs() {
  $('tabs').replaceChildren(...windows.map((w) => el('button', { className: w === active ? 'active' : '', textContent: `${w.dirty ? '● ' : ''}${w.displayName}`, onclick: () => w.focus() })));
}

function closeMenus() {
  document.querySelectorAll('.menu.open').forEach((m) => m.classList.remove('open'));
}

for (const m of document.querySelectorAll('.menu')) {
  m.querySelector(':scope > button').addEventListener('click', (e) => {
    e.stopPropagation();
    const open = m.classList.contains('open');
    closeMenus();
    if (!open) m.classList.add('open');
  });
}
document.addEventListener('click', closeMenus);

function applyFontSize() {
  document.documentElement.style.setProperty('--code-size', `${fontSize}px`);
  windows.forEach((w) => w.syncScroll());
  saveSession();
}

function tile() {
  const d = $('desktop').getBoundingClientRect();
  const n = windows.length;
  if (!n) return;
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  windows.forEach((w, i) => w.place({ x: (i % cols) * (d.width / cols), y: Math.floor(i / cols) * (d.height / rows), w: d.width / cols - 4, h: d.height / rows - 4 }));
  saveSession();
}

async function saveAll() {
  let count = 0;
  for (const w of windows) if (w.dirty && (await w.save())) count++;
  notice(count ? `Saved ${count} file(s)` : 'Nothing to save', 'ok');
}

async function quit() {
  for (const w of [...windows]) if (!(await w.close())) return;
  await api.state.set('iedit', { fontSize, recentFolders, windows: [] });
  location.href = '/';
}

// ======================= keyboard shortcuts =======================
document.addEventListener('keydown', (e) => {
  const mod = MAC ? e.metaKey : e.ctrlKey;
  if (!mod) return;
  const k = e.key.toLowerCase();
  const actions = {
    s: () => (e.shiftKey ? active?.save({ as: true }) : active?.save()),
    o: () => MENUS.file[1].action(),
    f: showFind,
    g: () => findStep(e.shiftKey ? -1 : 1),
    '=': () => MENUS.view[0].action(),
    '+': () => MENUS.view[0].action(),
    '-': () => MENUS.view[1].action()
  };
  if (actions[k]) {
    e.preventDefault();
    actions[k]();
  }
});
window.addEventListener('beforeunload', () => {
  clearTimeout(sessionTimer);
  // best effort: keep unsaved work even if the page closes before the timer fires
  const body = JSON.stringify({ value: { fontSize, recentFolders, activePath: active?.path ?? null, windows: windows.map((w) => w.snapshot()) } });
  fetch('/api/state/iedit', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-LucianOS': '1' }, body, keepalive: true });
});

// LucianOS desktop (same origin) asks iEdit to open files: { type: 'iedit.open', path, line }
window.addEventListener('message', (e) => {
  if (e.origin !== location.origin || e.data?.type !== 'iedit.open' || typeof e.data.path !== 'string') return;
  openPath(e.data.path, { line: parseInt(e.data.line, 10) || undefined });
});

// ======================= files dragged in from LucianOS =======================
// The desktop sends iedit.dragOver {x, y} while files are dragged over iEdit, then
// iedit.insertFiles {paths, x, y} on the drop. The contents go in where they're dropped.
function windowAt(x, y) {
  const node = document.elementFromPoint(x, y)?.closest('.win');
  return windows.find((w) => w.root === node) ?? null;
}

function offsetFor(w, x, y) {
  const ta = w.ta;
  const cs = getComputedStyle(ta);
  const r = ta.getBoundingClientRect();
  const ctx = (offsetFor.canvas ??= document.createElement('canvas')).getContext('2d');
  ctx.font = `${cs.fontSize} ${cs.fontFamily}`;
  return offsetAtPoint(ta.value, {
    x: x - r.left,
    y: y - r.top,
    lineHeight: parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5,
    charWidth: ctx.measureText('0'.repeat(50)).width / 50,
    tabSize: parseInt(cs.tabSize, 10) || 4,
    padLeft: parseFloat(cs.paddingLeft),
    padTop: parseFloat(cs.paddingTop),
    scrollLeft: ta.scrollLeft,
    scrollTop: ta.scrollTop
  });
}

let dropTarget = null;
function markDropTarget(w) {
  if (dropTarget && dropTarget !== w) dropTarget.root.classList.remove('drop-target');
  dropTarget = w;
  w?.root.classList.add('drop-target');
}

async function insertFiles(paths, x, y, from) {
  // tell the desktop the files arrived (it warns when an older iEdit stays silent)
  from?.postMessage({ type: 'iedit.inserted', count: paths.length }, location.origin);
  const w = windowAt(x, y);
  markDropTarget(null);
  if (!w) {
    // not over a window: open each file in its own
    for (const p of paths) await openPath(p);
    return;
  }
  const files = [];
  for (const p of paths) {
    try {
      const f = await api.files.read(p);
      const why = unsuitable(f);
      if (why) notice(`Left out ${p.split('/').pop()}: ${why}`, 'error');
      else files.push(f);
    } catch (err) {
      notice(`Could not read ${p}: ${err.message}`, 'error');
    }
  }
  if (!files.length) return;
  const { at, prefix } = dropPosition(w.ta.value, offsetFor(w, x, y));
  w.focus();
  w.ta.setSelectionRange(at, at);
  insertText(w.ta, prefix + dropText(files));
  w.ta.dispatchEvent(new Event('input'));
  notice(files.length === 1 ? `Put ${files[0].path.split('/').pop()} in` : `Put ${files.length} files in`);
}

window.addEventListener('message', (e) => {
  if (e.origin !== location.origin) return;
  const d = e.data ?? {};
  if (d.type === 'iedit.dragOver' && Number.isFinite(d.x) && Number.isFinite(d.y)) {
    const w = windowAt(d.x, d.y);
    markDropTarget(w);
    if (w) {
      // show where the text will go
      const { at } = dropPosition(w.ta.value, offsetFor(w, d.x, d.y));
      w.ta.focus({ preventScroll: true });
      w.ta.setSelectionRange(at, at);
    }
  } else if (d.type === 'iedit.dragLeave') {
    markDropTarget(null);
  } else if (d.type === 'iedit.insertFiles' && Array.isArray(d.paths) && d.paths.every((p) => typeof p === 'string')) {
    insertFiles(d.paths.slice(0, 50), d.x, d.y, e.source);
  }
});

// ======================= start =======================
async function init() {
  buildMenu('file', MENUS.file);
  buildMenu('edit', MENUS.edit);
  buildMenu('view', MENUS.view);
  renderWindowMenu();
  await restoreSession();
  // ?open=path (repeatable) and &line=n, used by LucianOS and links from other apps
  const params = new URLSearchParams(location.search);
  const line = parseInt(params.get('line'), 10) || undefined;
  for (const p of params.getAll('open')) await openPath(p, { line });
  $('empty').classList.toggle('hidden', windows.length > 0);
}

init().catch((err) => notice(err.message, 'error'));
