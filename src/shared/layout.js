/*
 * Layout engine for Mood Board Builder.
 * Pure functions: given image aspect ratios and a content box, return tiles per page.
 * Works in the browser (window.MoodLayout) and in Node (module.exports) for tests.
 *
 * Units are whatever the caller uses (the app uses millimetres).
 * Each tile: { index, x, y, w, h }  (index = position in the input list).
 * Grid tiles are cropped to fill (cover). Masonry and justified tiles keep the image's shape.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MoodLayout = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const EPS = 1e-6;

  function clampAspect(a) {
    if (!isFinite(a) || a <= 0) return 1;
    return Math.min(Math.max(a, 0.05), 20);
  }

  function offset(tiles, dx, dy) {
    for (const t of tiles) { t.x += dx; t.y += dy; }
    return tiles;
  }

  /* ---------- Uniform grid (cropped cells) ---------- */

  function gridFit(aspects, box, gap, cellAspect) {
    const n = aspects.length;
    let best = null;
    for (let c = 1; c <= n; c++) {
      const rows = Math.ceil(n / c);
      const wByWidth = (box.w - (c - 1) * gap) / c;
      const hByHeight = (box.h - (rows - 1) * gap) / rows;
      if (wByWidth <= 0 || hByHeight <= 0) continue;
      const cellW = Math.min(wByWidth, hByHeight * cellAspect);
      if (!best || cellW > best.cellW + EPS) best = { c, rows, cellW };
    }
    if (!best) return [[]];
    const { c, rows, cellW } = best;
    const cellH = cellW / cellAspect;
    const blockW = c * cellW + (c - 1) * gap;
    const blockH = rows * cellH + (rows - 1) * gap;
    const ox = box.x + (box.w - blockW) / 2;
    const oy = box.y + (box.h - blockH) / 2;
    const tiles = [];
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / c);
      const col = i % c;
      // centre an incomplete last row
      const inRow = r === rows - 1 ? n - r * c : c;
      const rowShift = ((c - inRow) * (cellW + gap)) / 2;
      tiles.push({ index: i, x: ox + rowShift + col * (cellW + gap), y: oy + r * (cellH + gap), w: cellW, h: cellH });
    }
    return [tiles];
  }

  function gridPaged(aspects, box, gap, cellAspect, columns) {
    const n = aspects.length;
    const c = Math.max(1, Math.round(columns));
    const cellW = (box.w - (c - 1) * gap) / c;
    let cellH = cellW / cellAspect;
    let w = cellW;
    let rowsPerPage = Math.floor((box.h + gap + EPS) / (cellH + gap));
    if (rowsPerPage < 1) { // cell taller than the page: shrink to fit one row
      rowsPerPage = 1;
      cellH = box.h;
      w = cellH * cellAspect;
    }
    const perPage = rowsPerPage * c;
    const pages = [];
    for (let start = 0; start < n; start += perPage) {
      const tiles = [];
      for (let i = start; i < Math.min(n, start + perPage); i++) {
        const k = i - start;
        const r = Math.floor(k / c);
        const col = k % c;
        tiles.push({ index: i, x: box.x + col * (cellW + gap) + (cellW - w) / 2, y: box.y + r * (cellH + gap), w, h: cellH });
      }
      pages.push(tiles);
    }
    return pages.length ? pages : [[]];
  }

  /* ---------- Masonry (columns, original shape) ---------- */

  // Assign items to the shortest column. Heights are proportional to column width,
  // so the assignment is the same for any width: track sum(1/aspect) per column.
  function masonryAssign(aspects, c, gapOverWidth) {
    const cols = Array.from({ length: c }, () => ({ items: [], units: 0 }));
    aspects.forEach((a, i) => {
      let target = cols[0];
      for (const col of cols) if (col.units < target.units - EPS) target = col;
      target.items.push(i);
      target.units += 1 / a + (target.items.length > 1 ? gapOverWidth : 0);
    });
    return cols;
  }

  function masonryFit(aspects, box, gap, maxColumns) {
    const n = aspects.length;
    let best = null;
    const limit = Math.max(1, Math.min(n, maxColumns || 12));
    for (let c = 1; c <= limit; c++) {
      let cw = (box.w - (c - 1) * gap) / c;
      if (cw <= 0) continue;
      // iterate a couple of times because gap contribution depends on cw
      let cols = masonryAssign(aspects, c, gap / cw);
      for (let iter = 0; iter < 3; iter++) {
        let maxCw = (box.w - (c - 1) * gap) / c;
        for (const col of cols) {
          const s = col.items.reduce((sum, i) => sum + 1 / aspects[i], 0);
          const gaps = (col.items.length - 1) * gap;
          if (s > 0) maxCw = Math.min(maxCw, (box.h - gaps) / s);
        }
        cw = maxCw;
        if (cw <= 0) break;
        cols = masonryAssign(aspects, c, gap / cw);
      }
      if (cw > 0 && (!best || cw > best.cw + EPS)) best = { c, cw, cols };
    }
    if (!best) return [[]];
    const { c, cw, cols } = best;
    const heights = cols.map(col => col.items.reduce((sum, i) => sum + cw / aspects[i], 0) + Math.max(0, col.items.length - 1) * gap);
    const blockW = c * cw + (c - 1) * gap;
    const blockH = Math.max(...heights);
    const ox = box.x + (box.w - blockW) / 2;
    const oy = box.y + (box.h - blockH) / 2;
    const tiles = [];
    cols.forEach((col, ci) => {
      let y = oy;
      for (const i of col.items) {
        const h = cw / aspects[i];
        tiles.push({ index: i, x: ox + ci * (cw + gap), y, w: cw, h });
        y += h + gap;
      }
    });
    tiles.sort((a, b) => a.index - b.index);
    return [tiles];
  }

  function masonryPaged(aspects, box, gap, columns) {
    const c = Math.max(1, Math.round(columns));
    const cw = (box.w - (c - 1) * gap) / c;
    const pages = [];
    let tiles = [];
    let ys = new Array(c).fill(0);
    let used = new Array(c).fill(false);
    aspects.forEach((a, i) => {
      let w = cw;
      let h = cw / a;
      if (h > box.h) { h = box.h; w = h * a; } // very tall image: shrink to page height
      let ci = 0;
      for (let k = 1; k < c; k++) if (ys[k] < ys[ci] - EPS) ci = k;
      let y = ys[ci] + (used[ci] ? gap : 0);
      if (y + h > box.h + EPS && tiles.length) {
        pages.push(tiles);
        tiles = [];
        ys = new Array(c).fill(0);
        used = new Array(c).fill(false);
        ci = 0;
        y = 0;
      }
      tiles.push({ index: i, x: box.x + ci * (cw + gap) + (cw - w) / 2, y: box.y + y, w, h });
      ys[ci] = y + h;
      used[ci] = true;
    });
    if (tiles.length || !pages.length) pages.push(tiles);
    return pages;
  }

  /* ---------- Justified rows (equal-height rows, original shape) ---------- */

  function buildRows(aspects, width, gap, target) {
    const rows = [];
    let row = [];
    let sum = 0;
    aspects.forEach((a, i) => {
      row.push(i);
      sum += a;
      const natural = sum * target + (row.length - 1) * gap;
      if (natural >= width - EPS) {
        rows.push({ items: row, sum, full: true });
        row = [];
        sum = 0;
      }
    });
    if (row.length) rows.push({ items: row, sum, full: false });
    return rows.map(r => {
      const gaps = (r.items.length - 1) * gap;
      let h = r.full ? (width - gaps) / r.sum : target;
      const naturalW = r.sum * target + gaps;
      // a short last row that is nearly full gets stretched too, for a neat edge
      if (!r.full && naturalW > width * 0.75) h = (width - gaps) / r.sum;
      return { items: r.items, h, w: r.sum * h + gaps };
    });
  }

  function placeRows(rows, aspects, box, gap, pageH) {
    const pages = [];
    let tiles = [];
    let y = 0;
    for (const row of rows) {
      let h = row.h;
      let w = row.w;
      if (h > pageH) { // single row taller than the page
        const gaps = (row.items.length - 1) * gap;
        h = pageH;
        w = row.items.reduce((s, i) => s + aspects[i], 0) * h + gaps;
      }
      const yy = tiles.length ? y + gap : 0;
      if (yy + h > pageH + EPS && tiles.length) {
        pages.push(tiles);
        tiles = [];
        y = 0;
      } else {
        y = yy;
      }
      let x = box.x + (box.w - w) / 2;
      for (const i of row.items) {
        const tw = aspects[i] * h;
        tiles.push({ index: i, x, y: box.y + y, w: tw, h });
        x += tw + gap;
      }
      y += h;
    }
    if (tiles.length || !pages.length) pages.push(tiles);
    return { pages, height: y };
  }

  function justifiedPaged(aspects, box, gap, rowHeight) {
    const rows = buildRows(aspects, box.w, gap, rowHeight);
    return placeRows(rows, aspects, box, gap, box.h).pages;
  }

  function justifiedFit(aspects, box, gap) {
    const totalHeight = t => {
      const rows = buildRows(aspects, box.w, gap, t);
      return rows.reduce((s, r) => s + Math.min(r.h, box.h), 0) + (rows.length - 1) * gap;
    };
    // Height is not strictly monotonic in t, so scan coarsely then refine.
    let bestT = null;
    const steps = 200;
    for (let k = 1; k <= steps; k++) {
      const t = (box.h * k) / steps;
      if (totalHeight(t) <= box.h + EPS) bestT = t;
    }
    if (bestT === null) bestT = box.h / Math.max(1, aspects.length);
    let lo = bestT, hi = Math.min(box.h, bestT + box.h / steps);
    for (let k = 0; k < 30; k++) {
      const mid = (lo + hi) / 2;
      if (totalHeight(mid) <= box.h + EPS) lo = mid; else hi = mid;
    }
    const rows = buildRows(aspects, box.w, gap, lo);
    const { pages, height } = placeRows(rows, aspects, box, gap, Infinity);
    const tiles = pages[0];
    if (height > box.h + EPS) {
      // fallback: uniformly scale down to fit (keeps proportions)
      const s = box.h / height;
      for (const t of tiles) {
        t.x = box.x + (t.x - box.x) * s + (box.w * (1 - s)) / 2;
        t.y = box.y + (t.y - box.y) * s;
        t.w *= s; t.h *= s;
      }
      return [tiles];
    }
    return [offset(tiles, 0, (box.h - height) / 2)];
  }

  /* ---------- Public API ---------- */

  /**
   * @param {number[]} aspects  width/height of each image, in order
   * @param {object} box        content box {x, y, w, h}
   * @param {object} opts       {mode: 'masonry'|'grid'|'justified', gap, fit, columns, rowHeight, cellAspect}
   * @returns {Array<Array<{index,x,y,w,h}>>} tiles for each page
   */
  function computeLayout(aspects, box, opts) {
    const o = Object.assign({ mode: 'masonry', gap: 4, fit: true, columns: 4, rowHeight: 40, cellAspect: 1 }, opts || {});
    const a = aspects.map(clampAspect);
    if (!a.length || box.w <= 0 || box.h <= 0) return [[]];
    const gap = Math.max(0, o.gap);
    switch (o.mode) {
      case 'grid':
        return o.fit ? gridFit(a, box, gap, clampAspect(o.cellAspect)) : gridPaged(a, box, gap, clampAspect(o.cellAspect), o.columns);
      case 'justified':
        return o.fit ? justifiedFit(a, box, gap) : justifiedPaged(a, box, gap, Math.max(1, o.rowHeight));
      case 'masonry':
      default:
        return o.fit ? masonryFit(a, box, gap, o.maxColumns) : masonryPaged(a, box, gap, o.columns);
    }
  }

  return { computeLayout };
});
