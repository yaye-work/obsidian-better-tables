"use strict";

const { Plugin, Notice, setIcon } = require("obsidian");

const TABLE_CELL_W = 140;
const TABLE_CELL_H = 48;
const MIN_W = 50;
const MIN_H = 28;

const SIZE_RE = /^\s*<!--\s*tk:cols=([\d.,\s]*);rows=([\d.,\s]*)\s*-->\s*$/;

function sumArr(a) {
  return a.reduce((s, n) => s + n, 0);
}

/** Parse a GitHub-style markdown table into a 2-D array of cell strings.
 *  Ignores the |---| separator line and any non-pipe lines (e.g. our size comment). */
function parseMdTable(text) {
  const lines = text.split("\n").filter((l) => l.trim().startsWith("|"));
  const rows = [];
  for (const line of lines) {
    if (/^\s*\|[\s:|-]+\|\s*$/.test(line) && line.includes("-")) continue;
    const inner = line.trim().replace(/^\|/, "").replace(/\|$/, "");
    rows.push(
      inner
        .split(/(?<!\\)\|/)
        // Decode escaped pipes and our <br> line-break encoding back into the
        // raw multi-line text the cell edits as.
        .map((c) => c.trim().replace(/\\\|/g, "|").replace(/<br\s*\/?>/gi, "\n"))
    );
  }
  if (!rows.length) return null;
  const width = Math.max(...rows.map((r) => r.length));
  for (const r of rows) while (r.length < width) r.push("");
  return rows;
}

function mdFromCells(cells) {
  // Pipe tables can't contain a literal pipe or newline, so escape pipes and
  // encode in-cell line breaks (Cmd+Enter) as <br>, which is valid table markup.
  const esc = (s) => s.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
  const row = (r) => "| " + r.map((c) => esc(c) || "   ").join(" | ") + " |";
  return [
    row(cells[0]),
    "|" + cells[0].map(() => " --- ").join("|") + "|",
    ...cells.slice(1).map(row)
  ].join("\n");
}

/** Pull stored column/row sizes out of the trailing size comment, if present. */
function parseSizes(text) {
  for (const line of text.split("\n")) {
    const m = line.match(SIZE_RE);
    if (m) {
      const nums = (s) =>
        s.split(",").map((n) => Number(n.trim())).filter((n) => Number.isFinite(n) && n > 0);
      return { cols: nums(m[1]), rows: nums(m[2]) };
    }
  }
  return null;
}

class TableWidget {
  constructor(plugin, source, el, ctx) {
    this.plugin = plugin;
    this.source = source;
    this.el = el;
    this.ctx = ctx;
    this.cells = [["", ""], ["", ""]];
    this.colW = [];
    this.rowH = [];
    this.editingCell = null;
    this.editingPos = null;
    this.dirty = false;
    this.rootEl = null;
    this.tableEl = null;
    this.addColEl = null;
    this.addRowEl = null;
    this.colHandles = [];
    this.rowHandles = [];
    this.colDividers = [];
    this.rowDividers = [];
    this.insertColDots = [];
    this.insertRowDots = [];
    this.insertLineEl = null;
    this.resizeObs = null;
    this.selected = null;
    this.deleteBtnEl = null;
    this.deleteTableEl = null;
    this.lineSelOutside = null;
    this.lineSelKey = null;
  }

  get doc() {
    return this.el.ownerDocument;
  }
  isEditing() {
    return this.editingCell !== null;
  }

  loadSizes() {
    const cols = this.cells[0].length;
    const rows = this.cells.length;
    const stored = parseSizes(this.source);
    const pc = stored && stored.cols;
    const pr = stored && stored.rows;
    this.colW = Array.isArray(pc) && pc.length === cols ? pc.map((n) => Math.max(MIN_W, n)) : [];
    this.rowH = Array.isArray(pr) && pr.length === rows ? pr.map((n) => Math.max(MIN_H, n)) : [];
    if (this.colW.length !== cols) this.colW = Array(cols).fill(TABLE_CELL_W);
    if (this.rowH.length !== rows) this.rowH = Array(rows).fill(TABLE_CELL_H);
  }

  render() {
    const parsed = parseMdTable(this.source);
    if (parsed) this.cells = parsed;
    this.editingCell = null;
    this.loadSizes();
    this.clearLineSelection();
    this.el.empty();
    this.el.addClass("tk-block");

    const scroll = this.el.createDiv({ cls: "cp-table-scroll" });
    const root = (this.rootEl = scroll.createDiv({ cls: "cp-table-root" }));
    const table = (this.tableEl = root.createEl("table", { cls: "cp-table" }));
    const colgroup = table.createEl("colgroup");
    for (let c = 0; c < this.cells[0].length; c++) colgroup.createEl("col");

    this.cells.forEach((row, r) => {
      const tr = table.createEl("tr");
      row.forEach((cellText, c) => {
        const td = tr.createEl("td");
        this.bindCell(td, r, c, cellText);
      });
    });
    this.applySizes();

    this.addColEl = root.createDiv({ cls: "cp-table-add cp-table-add-col", attr: { "aria-label": "Add column" } });
    setIcon(this.addColEl, "plus");
    this.addColEl.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.flushEdit();
      this.cells.forEach((row) => row.push(""));
      this.colW.push(TABLE_CELL_W);
      this.save();
    });

    this.addRowEl = root.createDiv({ cls: "cp-table-add cp-table-add-row", attr: { "aria-label": "Add row" } });
    setIcon(this.addRowEl, "plus");
    this.addRowEl.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.flushEdit();
      this.cells.push(this.cells[0].map(() => ""));
      this.rowH.push(TABLE_CELL_H);
      this.save();
    });

    const cols = this.cells[0].length;
    const rows = this.cells.length;
    this.colHandles = [];
    this.rowHandles = [];
    this.colDividers = [];
    this.rowDividers = [];
    // A divider sits on every column's right edge and every row's bottom edge —
    // including the last column and last row, so the rightmost/bottommost borders
    // are resizable too (previously impossible).
    for (let c = 0; c < cols; c++) {
      const h = root.createDiv({ cls: "cp-table-handle cp-table-handle-col", attr: { "aria-label": "Drag to reorder column" } });
      this.bindReorder(h, "col", c);
      this.colHandles.push(h);
      const d = root.createDiv({ cls: "cp-table-divider cp-table-divider-col" });
      this.bindResize(d, "col", c);
      this.colDividers.push(d);
    }
    for (let r = 0; r < rows; r++) {
      const h = root.createDiv({ cls: "cp-table-handle cp-table-handle-row", attr: { "aria-label": "Drag to reorder row" } });
      this.bindReorder(h, "row", r);
      this.rowHandles.push(h);
      const d = root.createDiv({ cls: "cp-table-divider cp-table-divider-row" });
      this.bindResize(d, "row", r);
      this.rowDividers.push(d);
    }

    this.insertColDots = [];
    this.insertRowDots = [];
    this.insertLineEl = root.createDiv({ cls: "cp-insert-line" });
    this.insertLineEl.hide();
    for (let c = 0; c < cols - 1; c++) {
      const dot = root.createDiv({ cls: "cp-insert cp-insert-col", attr: { "aria-label": "Insert column here" } });
      setIcon(dot, "plus");
      this.bindInsert(dot, "col", c);
      this.insertColDots.push(dot);
    }
    for (let r = 0; r < rows - 1; r++) {
      const dot = root.createDiv({ cls: "cp-insert cp-insert-row", attr: { "aria-label": "Insert row here" } });
      setIcon(dot, "plus");
      this.bindInsert(dot, "row", r);
      this.insertRowDots.push(dot);
    }

    // Delete-whole-table button: a trash pill at the table's top-left corner,
    // revealed with the rest of the hover chrome.
    this.deleteTableEl = root.createDiv({
      cls: "cp-table-delete cp-table-delete-table",
      attr: { "aria-label": "Delete table" }
    });
    setIcon(this.deleteTableEl, "trash-2");
    this.deleteTableEl.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      this.deleteTable();
    });

    this.bindChromeTracker();
    this.hideChrome();
    // Reposition the chrome whenever the table's geometry changes — e.g. when
    // the user switches themes (different cell padding/fonts reflow the table),
    // web fonts finish loading, or the container resizes. Without this the
    // handles/dividers stay pinned to the old layout and drift out of line.
    if (this.resizeObs) this.resizeObs.disconnect();
    this.resizeObs = new ResizeObserver(() => this.layout());
    this.resizeObs.observe(this.tableEl);
    window.requestAnimationFrame(() => this.layout());
  }

  // --- proximity-based chrome visibility ---
  bindChromeTracker() {
    const root = this.rootEl;
    if (!root) return;
    root.addEventListener("pointermove", (e) => this.updateChrome(e));
    root.addEventListener("pointerleave", () => {
      if (!this.isEditing()) this.hideChrome();
    });
  }

  updateChrome(e) {
    const t = this.tableEl;
    if (!t || !t.isConnected) return;
    const rect = t.getBoundingClientRect();
    const M = 48;
    if (e.clientX < rect.left - M || e.clientX > rect.right + M || e.clientY < rect.top - M || e.clientY > rect.bottom + M) {
      this.hideChrome();
      return;
    }
    const x = Math.min(Math.max(e.clientX, rect.left + 1), rect.right - 1);
    const y = Math.min(Math.max(e.clientY, rect.top + 1), rect.bottom - 1);
    let c = 0;
    let r = 0;
    const first = t.rows[0];
    for (let i = 0; i < ((first && first.cells.length) || 0); i++) {
      const cr = first.cells[i].getBoundingClientRect();
      if (x >= cr.left && x <= cr.right) {
        c = i;
        break;
      }
    }
    for (let i = 0; i < t.rows.length; i++) {
      const rr = t.rows[i].getBoundingClientRect();
      if (y >= rr.top && y <= rr.bottom) {
        r = i;
        break;
      }
    }
    const cols = this.cells[0].length;
    const rows = this.cells.length;
    this.colHandles.forEach((h, i) => h.toggleClass("is-visible", i === c));
    this.rowHandles.forEach((h, i) => h.toggleClass("is-visible", i === r));
    this.addColEl && this.addColEl.toggleClass("is-visible", c === cols - 1);
    this.addRowEl && this.addRowEl.toggleClass("is-visible", r === rows - 1);
    this.insertColDots.forEach((d, i) => d.toggleClass("is-visible", i === c - 1 || i === c));
    this.insertRowDots.forEach((d, i) => d.toggleClass("is-visible", i === r - 1 || i === r));
    this.deleteTableEl && this.deleteTableEl.addClass("is-visible");
  }

  hideChrome() {
    const all = [...this.colHandles, ...this.rowHandles, ...this.insertColDots, ...this.insertRowDots];
    if (this.addColEl) all.push(this.addColEl);
    if (this.addRowEl) all.push(this.addRowEl);
    if (this.deleteTableEl) all.push(this.deleteTableEl);
    for (const el of all) el.removeClass("is-visible");
    this.insertLineEl && this.insertLineEl.hide();
  }

  // --- insert between rows/columns ---
  bindInsert(dot, axis, boundary) {
    dot.addEventListener("pointerenter", () => this.showInsertLine(axis, boundary));
    dot.addEventListener("pointerleave", () => this.insertLineEl && this.insertLineEl.hide());
    dot.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      this.flushEdit();
      this.insertLineEl && this.insertLineEl.hide();
      if (axis === "col") {
        this.cells.forEach((row) => row.splice(boundary + 1, 0, ""));
        this.colW.splice(boundary + 1, 0, TABLE_CELL_W);
      } else {
        this.cells.splice(boundary + 1, 0, this.cells[0].map(() => ""));
        this.rowH.splice(boundary + 1, 0, TABLE_CELL_H);
      }
      this.save();
    });
  }

  showInsertLine(axis, boundary) {
    const t = this.tableEl;
    const line = this.insertLineEl;
    if (!t || !line) return;
    if (axis === "col") {
      const cell = t.rows[0] && t.rows[0].cells[boundary];
      if (!cell) return;
      line.style.left = `${cell.offsetLeft + cell.offsetWidth - 1.5}px`;
      line.style.top = "0px";
      line.style.width = "3px";
      line.style.height = `${t.offsetHeight}px`;
    } else {
      const tr = t.rows[boundary];
      if (!tr) return;
      line.style.top = `${tr.offsetTop + tr.offsetHeight - 1.5}px`;
      line.style.left = "0px";
      line.style.height = "3px";
      line.style.width = `${t.offsetWidth}px`;
    }
    line.show();
  }

  // --- sizing ---
  applySizes() {
    const t = this.tableEl;
    if (!t) return;
    t.querySelectorAll("col").forEach((c, i) => {
      c.style.width = `${this.colW[i] || TABLE_CELL_W}px`;
    });
    t.style.width = `${sumArr(this.colW)}px`;
    Array.from(t.rows).forEach((tr, r) => {
      tr.style.height = `${this.rowH[r] || TABLE_CELL_H}px`;
    });
  }

  /** Position the +/reorder/divider chrome from measured cell geometry. */
  layout() {
    const t = this.tableEl;
    if (!t || !t.isConnected) return;
    const tw = t.offsetWidth;
    const th = t.offsetHeight;
    if (this.addColEl) {
      this.addColEl.style.left = `${tw + 6}px`;
      this.addColEl.style.top = "0px";
      this.addColEl.style.height = `${th}px`;
    }
    if (this.addRowEl) {
      this.addRowEl.style.top = `${th + 6}px`;
      this.addRowEl.style.left = "0px";
      this.addRowEl.style.width = `${tw}px`;
    }
    const first = t.rows[0];
    this.colHandles.forEach((h, i) => {
      const cell = first && first.cells[i];
      if (cell) h.style.left = `${cell.offsetLeft + cell.offsetWidth / 2}px`;
    });
    this.colDividers.forEach((d, i) => {
      const cell = first && first.cells[i];
      if (cell) {
        d.style.left = `${cell.offsetLeft + cell.offsetWidth - 3}px`;
        d.style.top = "0px";
        d.style.height = `${th}px`;
      }
    });
    this.rowHandles.forEach((h, r) => {
      const tr = t.rows[r];
      if (tr) h.style.top = `${tr.offsetTop + tr.offsetHeight / 2}px`;
    });
    this.rowDividers.forEach((d, r) => {
      const tr = t.rows[r];
      if (tr) {
        d.style.top = `${tr.offsetTop + tr.offsetHeight - 3}px`;
        d.style.left = "0px";
        d.style.width = `${tw}px`;
      }
    });
    this.insertColDots.forEach((d, i) => {
      const cell = first && first.cells[i];
      if (cell) {
        d.style.left = `${cell.offsetLeft + cell.offsetWidth}px`;
        d.style.top = "-12px";
      }
    });
    this.insertRowDots.forEach((d, r) => {
      const tr = t.rows[r];
      if (tr) {
        d.style.top = `${tr.offsetTop + tr.offsetHeight}px`;
        d.style.left = "-12px";
      }
    });
    if (this.deleteTableEl) {
      this.deleteTableEl.style.left = "-18px";
      this.deleteTableEl.style.top = "-18px";
    }
    this.positionDeleteBtn();
  }

  /** Drag a divider to resize the column left of / row above it. */
  bindResize(div, axis, index) {
    div.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      div.setPointerCapture(e.pointerId);
      div.addClass("is-resizing");
      const startX = e.clientX;
      const startY = e.clientY;
      const startSize = axis === "col" ? this.colW[index] : this.rowH[index];
      const onMove = (ev) => {
        if (axis === "col") {
          this.colW[index] = Math.max(MIN_W, Math.round(startSize + (ev.clientX - startX)));
        } else {
          this.rowH[index] = Math.max(MIN_H, Math.round(startSize + (ev.clientY - startY)));
        }
        this.applySizes();
        this.layout();
      };
      const onUp = () => {
        div.removeEventListener("pointermove", onMove);
        div.removeClass("is-resizing");
        this.save();
      };
      div.addEventListener("pointermove", onMove);
      div.addEventListener("pointerup", onUp, { once: true });
    });
  }

  // --- cell editing ---
  /** Wire up a freshly created <td>: its text, header style, and the
   *  click-to-edit / re-layout-on-input listeners. Shared by render() and
   *  appendRowAndEdit() so both build identical cells. */
  bindCell(td, r, c, text) {
    td.setText(text);
    if (r === 0) td.addClass("cp-table-header");
    // Use mousedown (not pointerdown): CodeMirror manages focus on mousedown,
    // so this is the event we must intercept to stop the editor from yanking
    // focus back out of the cell — which was eating the first Tab/Enter.
    td.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      // Already editing this cell: leave the event alone so native caret
      // placement and drag-to-select work.
      if (this.editingCell === td) return;
      e.preventDefault();
      e.stopPropagation();
      this.editCell(td, r, c, false);
      // We suppressed the default caret placement above, so set the caret at the
      // clicked point ourselves.
      const range = this.doc.caretRangeFromPoint && this.doc.caretRangeFromPoint(e.clientX, e.clientY);
      if (range) {
        const sel = window.getSelection();
        sel && sel.removeAllRanges();
        sel && sel.addRange(range);
      }
    });
    td.addEventListener("input", () => window.requestAnimationFrame(() => this.layout()));
  }

  editCell(td, r, c, fromKeyboard) {
    if (this.editingCell === td) return;
    this.finishEditing();
    this.editingCell = td;
    this.editingPos = { r, c };
    td.contentEditable = "true";
    td.addClass("is-editing-cell");
    // Always take keyboard focus so the cell captures the very first Tab/Enter.
    // Only for keyboard navigation do we drop the caret at the end; for a click
    // the caller (mousedown) places the caret at the clicked point.
    td.focus();
    if (fromKeyboard) {
      const range = this.doc.createRange();
      range.selectNodeContents(td);
      range.collapse(false);
      const sel = window.getSelection();
      sel && sel.removeAllRanges();
      sel && sel.addRange(range);
    }
    // Blur commits and saves — unless the edit was already committed (e.g. by a
    // structural action or keyboard navigation), in which case editingCell has
    // been cleared and this is a no-op so we never issue a racing save.
    td.addEventListener(
      "blur",
      () => {
        if (this.editingCell === td) this.commitCell(td, r, c, true);
      },
      { once: true }
    );
    // Bind navigation keys once per cell so repeated edits don't stack handlers
    // (which would double-fire Tab/Enter navigation).
    if (!td._btKeyBound) {
      td._btKeyBound = true;
      td.addEventListener("keydown", (e) => {
        if (this.editingCell !== td) return;
        const mod = e.metaKey || e.ctrlKey;
        // Cmd/Ctrl+A — select all text in THIS cell (not the whole note).
        if (mod && (e.key === "a" || e.key === "A")) {
          e.preventDefault();
          e.stopPropagation();
          const range = this.doc.createRange();
          range.selectNodeContents(td);
          const sel = window.getSelection();
          sel && sel.removeAllRanges();
          sel && sel.addRange(range);
          return;
        }
        // Cmd/Ctrl+Enter or Shift+Enter — insert a line break inside the cell.
        if ((mod || e.shiftKey) && e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          this.insertLineBreak(td);
          return;
        }
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          td.blur();
        } else if (e.key === "Tab") {
          e.preventDefault();
          this.editNeighbor(r, c, 0, e.shiftKey ? -1 : 1, true);
        } else if (e.key === "Enter") {
          e.preventDefault();
          // Enter on the last row grows the table and keeps editing in the new
          // row, so you can keep typing down the column.
          if (r === this.cells.length - 1) this.appendRowAndEdit(c);
          else this.editNeighbor(r, c, 1, 0);
        } else if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown") {
          // Arrows move the caret within the cell until it hits an edge, then
          // step to the adjacent cell.
          const edge = this.getCaretEdges(td);
          if (e.key === "ArrowLeft" && edge.atStart) {
            e.preventDefault();
            this.editNeighbor(r, c, 0, -1);
          } else if (e.key === "ArrowRight" && edge.atEnd) {
            e.preventDefault();
            this.editNeighbor(r, c, 0, 1);
          } else if (e.key === "ArrowUp" && edge.atTop) {
            e.preventDefault();
            this.editNeighbor(r, c, -1, 0);
          } else if (e.key === "ArrowDown" && edge.atBottom) {
            e.preventDefault();
            this.editNeighbor(r, c, 1, 0);
          }
        }
      });
    }
  }

  /** Move to an adjacent cell. Commits the current cell into the model WITHOUT
   *  saving (so no file write / re-render happens mid-navigation, which would
   *  tear down the DOM). When `eject` is set, navigating past the table edge
   *  commits + persists and exits; otherwise it's a no-op (stay in the cell). */
  editNeighbor(r, c, dr, dc, eject = false) {
    let nr = r + dr;
    let nc = c + dc;
    if (nc >= this.cells[0].length) {
      nc = 0;
      nr++;
    }
    if (nc < 0) {
      nc = this.cells[0].length - 1;
      nr--;
    }
    const table = this.el.querySelector(".cp-table");
    const td = nr >= 0 && nr < this.cells.length && table && table.rows[nr] && table.rows[nr].cells[nc];
    if (td) {
      this.editCell(td, nr, nc, true);
    } else if (eject) {
      // Navigated past the edge: commit and persist now.
      this.finishEditing();
      if (this.dirty) this.save();
    }
  }

  /** Append a new row to the model and DOM (no file write yet) and start editing
   *  it in the given column, so Enter on the bottom row flows into a fresh row.
   *  The save happens later when editing leaves the table, avoiding a mid-edit
   *  re-render that would drop focus. */
  appendRowAndEdit(col) {
    this.finishEditing();
    const nr = this.cells.length;
    this.cells.push(this.cells[0].map(() => ""));
    this.rowH.push(TABLE_CELL_H);
    this.dirty = true;
    const tr = this.tableEl.createEl("tr");
    this.cells[nr].forEach((text, c) => {
      const td = tr.createEl("td");
      this.bindCell(td, nr, c, text);
    });
    this.applySizes();
    const td = tr.cells[col];
    if (td) this.editCell(td, nr, col, true);
    this.layout();
  }

  /** Whether the caret sits at the start/end of the text and on the first/last
   *  visual line — used to decide when an arrow key should leave the cell. */
  getCaretEdges(td) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return { atStart: true, atEnd: true, atTop: true, atBottom: true };
    const range = sel.getRangeAt(0);
    const pre = range.cloneRange();
    pre.selectNodeContents(td);
    pre.setEnd(range.startContainer, range.startOffset);
    const atStart = range.collapsed && pre.toString().length === 0;
    const post = range.cloneRange();
    post.selectNodeContents(td);
    post.setStart(range.endContainer, range.endOffset);
    const atEnd = range.collapsed && post.toString().length === 0;
    let atTop = atStart;
    let atBottom = atEnd;
    const caretRect = range.getBoundingClientRect();
    if (caretRect && caretRect.height) {
      const cellRect = td.getBoundingClientRect();
      const lh = parseFloat(getComputedStyle(td).lineHeight) || 18;
      atTop = caretRect.top - cellRect.top < lh * 0.75;
      atBottom = cellRect.bottom - caretRect.bottom < lh * 0.75;
    }
    return { atStart, atEnd, atTop, atBottom };
  }

  /** Insert a hard line break at the caret. Uses a real <br> (a raw "\n" text
   *  node won't render a trailing newline in contentEditable); execCommand
   *  handles the trailing-<br> sentinel so the new line is visible. */
  insertLineBreak(td) {
    const ok = this.doc.execCommand && this.doc.execCommand("insertLineBreak");
    if (!ok) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        const br = this.doc.createElement("br");
        range.insertNode(br);
        // Sentinel <br> so the line renders when the break is at the very end.
        const tail = this.doc.createElement("br");
        br.after(tail);
        range.setStartBefore(tail);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
    window.requestAnimationFrame(() => this.layout());
  }

  /** Read an edit-mode cell's DOM back to raw text, turning <br> and block
   *  boundaries into newlines (so Cmd/Shift+Enter line breaks round-trip). */
  cellText(td) {
    const parts = [];
    const walk = (node) => {
      node.childNodes.forEach((n) => {
        if (n.nodeType === 3) {
          parts.push(n.nodeValue);
        } else if (n.nodeName === "BR") {
          parts.push("\n");
        } else if (n.nodeName === "DIV" || n.nodeName === "P") {
          if (parts.length && !parts[parts.length - 1].endsWith("\n")) parts.push("\n");
          walk(n);
        } else {
          walk(n);
        }
      });
    };
    walk(td);
    return parts.join("");
  }

  /** Pull the edited text into the model and end edit mode. Does NOT save
   *  unless doSave is set — structural actions flush then issue a single save. */
  commitCell(td, r, c, doSave) {
    // Clear editing state BEFORE disabling contentEditable. Setting
    // contentEditable=false on the focused cell fires a synchronous blur; if
    // editingCell still pointed here, the once-blur handler would re-enter
    // commitCell with doSave=true and trigger a save+re-render mid-navigation
    // (which cancelled the first Tab/Enter).
    if (this.editingCell === td) this.editingCell = null;
    this.editingPos = null;
    td.contentEditable = "false";
    td.removeClass("is-editing-cell");
    const v = this.cellText(td).trim();
    if (v !== this.cells[r][c]) {
      this.cells[r][c] = v;
      this.dirty = true;
    }
    if (doSave) {
      if (this.dirty) this.save();
      else this.layout();
    } else {
      this.layout();
    }
  }

  /** Commit any in-progress cell edit into the model without saving, so a
   *  following structural change can persist everything in one write. */
  flushEdit() {
    const td = this.editingCell;
    const pos = this.editingPos;
    if (!td || !pos) return;
    this.commitCell(td, pos.r, pos.c, false);
  }

  finishEditing() {
    const td = this.editingCell;
    const pos = this.editingPos;
    if (td && pos) this.commitCell(td, pos.r, pos.c, false);
    this.editingCell = null;
    this.editingPos = null;
  }

  // --- reorder + selection ---
  bindReorder(handle, axis, index) {
    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      const table = this.tableEl;
      if (!table) return;
      const count = axis === "row" ? this.cells.length : this.cells[0].length;
      const startX = e.clientX;
      const startY = e.clientY;
      let dragging = false;
      let ghost = null;
      let target = index;
      const setSrc = (on) => {
        if (axis === "row") {
          table.rows[index] && table.rows[index].toggleClass("cp-drag-src", on);
        } else {
          for (const row of Array.from(table.rows)) row.cells[index] && row.cells[index].toggleClass("cp-drag-src", on);
        }
      };
      const moveGhost = (ev) => {
        if (!ghost) return;
        const rr = this.rootEl.getBoundingClientRect();
        if (axis === "row") {
          ghost.style.left = "0px";
          ghost.style.top = `${ev.clientY - rr.top - ghost.offsetHeight / 2}px`;
        } else {
          ghost.style.top = "0px";
          ghost.style.left = `${ev.clientX - rr.left - ghost.offsetWidth / 2}px`;
        }
      };
      const beginDrag = (ev) => {
        dragging = true;
        this.clearLineSelection();
        handle.addClass("is-dragging");
        ghost = this.makeGhost(axis, index);
        setSrc(true);
        moveGhost(ev);
      };
      const onMove = (ev) => {
        if (!dragging) {
          if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return;
          beginDrag(ev);
        } else {
          moveGhost(ev);
        }
        const rect = table.getBoundingClientRect();
        const tt = axis === "row" ? (ev.clientY - rect.top) / rect.height : (ev.clientX - rect.left) / rect.width;
        target = Math.max(0, Math.min(count - 1, Math.floor(tt * count)));
        table.querySelectorAll("tr, td").forEach((el) => el.removeClass("cp-drop-target"));
        if (target === index) return;
        if (axis === "row") {
          table.rows[target] && table.rows[target].addClass("cp-drop-target");
        } else {
          for (const row of Array.from(table.rows)) row.cells[target] && row.cells[target].addClass("cp-drop-target");
        }
      };
      const onUp = () => {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        if (!dragging) {
          if (this.selected && this.selected.axis === axis && this.selected.index === index) {
            this.clearLineSelection();
          } else {
            this.selectLine(axis, index);
          }
          return;
        }
        handle.removeClass("is-dragging");
        ghost && ghost.remove();
        setSrc(false);
        if (target !== index) {
          if (axis === "row") {
            const [row] = this.cells.splice(index, 1);
            this.cells.splice(target, 0, row);
            const [h] = this.rowH.splice(index, 1);
            this.rowH.splice(target, 0, h);
          } else {
            for (const row of this.cells) {
              const [cell] = row.splice(index, 1);
              row.splice(target, 0, cell);
            }
            const [w] = this.colW.splice(index, 1);
            this.colW.splice(target, 0, w);
          }
          this.save();
        } else {
          this.render();
        }
      };
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
    });
  }

  selectLine(axis, index) {
    this.clearLineSelection();
    const table = this.tableEl;
    const root = this.rootEl;
    if (!table || !root) return;
    this.selected = { axis, index };
    const handles = axis === "row" ? this.rowHandles : this.colHandles;
    handles[index] && handles[index].addClass("is-selected");
    this.lineCells(axis, index).forEach((td) => td.addClass("cp-line-selected"));
    const btn = (this.deleteBtnEl = root.createDiv({
      cls: "cp-table-delete",
      attr: { "aria-label": axis === "row" ? "Delete row" : "Delete column" }
    }));
    setIcon(btn, "trash-2");
    btn.addEventListener("pointerdown", (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      this.deleteLine(axis, index);
    });
    this.positionDeleteBtn();
    this.lineSelOutside = (ev) => {
      if (!root.contains(ev.target)) this.clearLineSelection();
    };
    this.doc.addEventListener("pointerdown", this.lineSelOutside, true);
    this.lineSelKey = (ev) => {
      if ((ev.key === "Delete" || ev.key === "Backspace") && !this.isEditing()) {
        ev.preventDefault();
        ev.stopPropagation();
        this.deleteLine(axis, index);
      } else if (ev.key === "Escape") {
        this.clearLineSelection();
      }
    };
    this.doc.addEventListener("keydown", this.lineSelKey, true);
  }

  lineCells(axis, index) {
    const table = this.tableEl;
    if (!table) return [];
    if (axis === "row") return Array.from((table.rows[index] && table.rows[index].cells) || []);
    return Array.from(table.rows).map((r) => r.cells[index]).filter(Boolean);
  }

  positionDeleteBtn() {
    const btn = this.deleteBtnEl;
    const sel = this.selected;
    if (!btn || !sel) return;
    const handle = (sel.axis === "row" ? this.rowHandles : this.colHandles)[sel.index];
    if (!handle) return;
    if (sel.axis === "row") {
      btn.style.top = handle.style.top;
      btn.style.left = "-34px";
    } else {
      btn.style.left = handle.style.left;
      btn.style.top = "-34px";
    }
  }

  clearLineSelection() {
    if (this.selected) {
      const { axis, index } = this.selected;
      const h = (axis === "row" ? this.rowHandles : this.colHandles)[index];
      h && h.removeClass("is-selected");
      this.lineCells(axis, index).forEach((td) => td.removeClass("cp-line-selected"));
    }
    this.selected = null;
    this.deleteBtnEl && this.deleteBtnEl.remove();
    this.deleteBtnEl = null;
    if (this.lineSelOutside) {
      this.doc.removeEventListener("pointerdown", this.lineSelOutside, true);
      this.lineSelOutside = null;
    }
    if (this.lineSelKey) {
      this.doc.removeEventListener("keydown", this.lineSelKey, true);
      this.lineSelKey = null;
    }
  }

  deleteLine(axis, index) {
    const rows = this.cells.length;
    const cols = (this.cells[0] && this.cells[0].length) || 0;
    if ((axis === "row" && rows <= 1) || (axis === "col" && cols <= 1)) {
      new Notice("Better Tables: a table needs at least one row and column.");
      return;
    }
    if (axis === "row") {
      this.cells.splice(index, 1);
      this.rowH.splice(index, 1);
    } else {
      for (const row of this.cells) row.splice(index, 1);
      this.colW.splice(index, 1);
    }
    this.clearLineSelection();
    this.save();
  }

  /** Remove the entire ```table block (fences included) from the note. */
  deleteTable() {
    const el = this.el;
    const ctx = this.ctx;
    const plugin = this.plugin;
    const oldBody = this.source;
    const info = ctx.getSectionInfo(el);
    plugin.queueWrite(async () => {
      const file = plugin.app.vault.getAbstractFileByPath(ctx.sourcePath);
      if (!file) return;
      const sec = info || ctx.getSectionInfo(el);
      try {
        await plugin.app.vault.process(file, (data) => {
          // 1) Precise path: drop the validated fenced line range, plus one
          //    trailing blank line if present, so we don't leave a gap.
          if (sec) {
            const lines = data.split("\n");
            const open = lines[sec.lineStart];
            const close = lines[sec.lineEnd];
            const fenceOpen = /^\s*(`{3,}|~{3,})\s*table\b/.test(open || "");
            const fenceClose = /^\s*(`{3,}|~{3,})\s*$/.test(close || "");
            if (fenceOpen && fenceClose) {
              let end = sec.lineEnd;
              if ((lines[end + 1] || "").trim() === "") end++;
              lines.splice(sec.lineStart, end - sec.lineStart + 1);
              return lines.join("\n");
            }
          }
          // 2) Fallback: find the body, expand to the surrounding fences, and cut
          //    the whole block — only if the body occurs exactly once.
          if (oldBody && oldBody.trim()) {
            const idx = data.indexOf(oldBody);
            if (idx !== -1 && data.indexOf(oldBody, idx + 1) === -1) {
              const before = data.slice(0, idx);
              const after = data.slice(idx + oldBody.length);
              const openMatch = before.match(/(?:^|\n)([ \t]*(?:`{3,}|~{3,})[ \t]*table\b[^\n]*\n)$/);
              const closeMatch = after.match(/^(\s*\n?[ \t]*(?:`{3,}|~{3,})[ \t]*)/);
              if (openMatch && closeMatch) {
                const start = idx - openMatch[1].length;
                let stop = idx + oldBody.length + closeMatch[1].length;
                if (data[stop] === "\n") stop++;
                return data.slice(0, start) + data.slice(stop);
              }
            }
          }
          return data; // couldn't locate the block safely — leave file untouched
        });
        new Notice("Better Tables: table deleted.");
      } catch (err) {
        console.error("Better Tables: delete failed", err);
        new Notice("Better Tables: failed to delete table.");
      }
    });
  }

  makeGhost(axis, index) {
    const t = this.tableEl;
    const g = this.rootEl.createDiv({ cls: "cp-table-ghost" });
    const gt = g.createEl("table", { cls: "cp-table" });
    if (axis === "row") {
      const src = t.rows[index];
      const tr = gt.createEl("tr");
      Array.from((src && src.cells) || []).forEach((cell) => {
        const td = tr.createEl("td");
        td.setText(cell.textContent || "");
        td.style.width = `${cell.offsetWidth}px`;
      });
      tr.style.height = `${(src && src.offsetHeight) || TABLE_CELL_H}px`;
      g.style.width = `${t.offsetWidth}px`;
    } else {
      Array.from(t.rows).forEach((row) => {
        const cell = row.cells[index];
        const tr = gt.createEl("tr");
        const td = tr.createEl("td");
        td.setText((cell && cell.textContent) || "");
        td.style.width = `${(cell && cell.offsetWidth) || TABLE_CELL_W}px`;
        tr.style.height = `${row.offsetHeight}px`;
      });
      g.style.width = `${(t.rows[0] && t.rows[0].cells[index] && t.rows[0].cells[index].offsetWidth) || TABLE_CELL_W}px`;
    }
    gt.style.width = "100%";
    return g;
  }

  // --- persistence: write the block back into the note file ---
  serialize() {
    const md = mdFromCells(this.cells);
    const sizeLine = `<!-- tk:cols=${this.colW.join(",")};rows=${this.rowH.join(",")} -->`;
    return `${md}\n${sizeLine}`;
  }

  save() {
    this.dirty = false;
    const oldBody = this.source;
    const body = this.serialize();
    this.source = body;
    const el = this.el;
    const ctx = this.ctx;
    const plugin = this.plugin;
    // Capture the block's line range NOW, while the element is still attached.
    // It can be null right after a block is created (Obsidian hasn't indexed it
    // yet) — in that case we fall back to locating the block by its content.
    const info = ctx.getSectionInfo(el);
    // Persist through a single serialized queue so writes can't interleave and
    // clobber each other's line ranges. Obsidian re-renders the block when the
    // file changes, so we don't render optimistically (which caused a flash).
    plugin.queueWrite(async () => {
      const file = plugin.app.vault.getAbstractFileByPath(ctx.sourcePath);
      if (!file) return;
      const sec = info || ctx.getSectionInfo(el);
      try {
        await plugin.app.vault.process(file, (data) => {
          // 1) Precise path: replace a validated fenced line range.
          if (sec) {
            const lines = data.split("\n");
            const open = lines[sec.lineStart];
            const close = lines[sec.lineEnd];
            const fenceOpen = /^\s*(`{3,}|~{3,})\s*table\b/.test(open || "");
            const fenceClose = /^\s*(`{3,}|~{3,})\s*$/.test(close || "");
            if (fenceOpen && fenceClose) {
              const newLines = [open, ...body.split("\n"), close];
              lines.splice(sec.lineStart, sec.lineEnd - sec.lineStart + 1, ...newLines);
              return lines.join("\n");
            }
          }
          // 2) Fallback: replace the previous block body by content, but only
          //    if it occurs exactly once (otherwise we can't be sure which).
          if (oldBody && oldBody.trim()) {
            const idx = data.indexOf(oldBody);
            if (idx !== -1 && data.indexOf(oldBody, idx + 1) === -1) {
              return data.slice(0, idx) + body + data.slice(idx + oldBody.length);
            }
          }
          return data; // couldn't locate the block safely — leave file untouched
        });
      } catch (err) {
        console.error("Better Tables: save failed", err);
        new Notice("Better Tables: failed to save table.");
      }
    });
  }
}

module.exports = class BetterTablesPlugin extends Plugin {
  async onload() {
    // Serializes all table writes so concurrent saves can never interleave.
    this._writeChain = Promise.resolve();

    this.registerMarkdownCodeBlockProcessor("table", (source, el, ctx) => {
      new TableWidget(this, source, el, ctx).render();
    });

    this.addCommand({
      id: "insert-table",
      name: "Insert table",
      editorCallback: (editor) => {
        const block = ["```table", "|     |     |", "| --- | --- |", "|     |     |", "```", ""].join("\n");
        editor.replaceSelection(block);
      }
    });
  }

  /** Run write tasks one at a time, in order. */
  queueWrite(task) {
    this._writeChain = this._writeChain.then(task, task);
    return this._writeChain;
  }
};

/* nosourcemap */