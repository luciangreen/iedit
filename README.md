# iEdit

A web text editor with multiple windows, for desktop and iPhone. It's part of the [LucianOS suite](https://github.com/luciangreen/lucianos).

## Install

iEdit runs inside the LucianOS platform:

```sh
cd lucianos/apps
git clone https://github.com/luciangreen/iedit
```

Start the platform (`npm start` in `lucianos`) and open http://localhost:4170/apps/iedit/

To open files straight away: `/apps/iedit/?open=path/to/file.pl&open=other.md&line=12`. The LucianOS desktop opens text files in iEdit, and further files go to the same iEdit window.

## What it does

- **Windows:** several files open at once, each in a window you can drag and resize. **Window** lists them, and **View ▸ Tile windows** arranges them. On an iPhone or a narrow window, one file shows at a time with tabs to switch.
- **Open and save dialogs** work like the desktop ones: folders, recent folders, new folder, and a check before replacing a file. The menus also have Save all, Revert, Close all and Quit.
- **Nothing is lost:**
  - Open windows, their positions and any unsaved text are kept. If the page closes, everything comes back next time.
  - If a file changed on disk since you opened it, saving asks before overwriting.
  - A window with no unsaved changes refreshes when its file changes on disk.
- **Find and replace** in this file, in all open files, or in every matching file of a folder (for example `*.pl, *.txt`).
  - Options: same case, words only, and regular expressions.
  - A helper menu inserts common patterns, such as or, not followed by, and groups, which you use as `$1` in Replace.
  - **Find all** lists matches by file and line.
- **Files dragged in from LucianOS:** drop file icons from the desktop or a folder window on an iEdit window to put their contents into it.
  - **Where it goes:** the window you're over is outlined while you drag, and the cursor moves to show where the text will go. It goes in as whole lines, at the line you drop on. A drop mid-line goes in at the next line, so no line is split.
  - **Several files** go in one after another, in the order you selected them.
  - **Undo:** ⌘Z takes it all out again.
  - **Elsewhere in iEdit:** dropped outside a window, the files open in windows of their own.
  - **Left out:** binary files and files over 2 MB, with a message saying so.
- **Coding view:** line numbers, colours for Prolog, Markdown, HTML and JavaScript, Tab, keeping indentation on Enter, and Go to line.
  - The status bar shows the line and column, and counts characters, words, lines and the selection.
  - Click the file path in the status bar to browse its folder.
- **Shortcuts:** ⌘S save, ⇧⌘S save as, ⌘O open, ⌘F find, ⌘G find next, ⌘+ / ⌘− text size.

## Coming next

From the plan:

- Diff of two files.
- Dictionary underlines and autocomplete.
- ⌘-click the title to jump to a folder in LucianOS.
- Larger touch selection controls.
- Font preferences.

## Tests

```sh
npm test
```

The 9 tests cover find and replace (case, whole words, regex, groups, literal `$`), the file name filter, the highlighters (the text stays exact and HTML is escaped) and the status counts.
