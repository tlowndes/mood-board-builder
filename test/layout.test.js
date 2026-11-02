const test = require('node:test');
const assert = require('node:assert');
const { computeLayout } = require('../src/shared/layout.js');

const box = { x: 10, y: 20, w: 277, h: 170 };
const rand = (seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647)(42);
const aspects = Array.from({ length: 23 }, () => 0.5 + rand() * 1.5);
const E = 1e-3;

function checkTiles(pages, n, label) {
  const seen = new Set();
  for (const tiles of pages) {
    for (const t of tiles) {
      assert.ok(t.w > 0 && t.h > 0, `${label}: positive size`);
      assert.ok(t.x >= box.x - E && t.y >= box.y - E, `${label}: inside top-left`);
      assert.ok(t.x + t.w <= box.x + box.w + E, `${label}: inside right (${t.x + t.w})`);
      assert.ok(t.y + t.h <= box.y + box.h + E, `${label}: inside bottom (${t.y + t.h})`);
      seen.add(t.index);
    }
    // no overlaps within a page
    for (let i = 0; i < tiles.length; i++) for (let j = i + 1; j < tiles.length; j++) {
      const a = tiles[i], b = tiles[j];
      const overlap = a.x < b.x + b.w - E && b.x < a.x + a.w - E && a.y < b.y + b.h - E && b.y < a.y + a.h - E;
      assert.ok(!overlap, `${label}: tiles ${a.index} and ${b.index} overlap`);
    }
  }
  assert.strictEqual(seen.size, n, `${label}: every image placed once`);
}

for (const mode of ['masonry', 'grid', 'justified']) {
  test(`${mode} fit puts everything on one page`, () => {
    const pages = computeLayout(aspects, box, { mode, gap: 4, fit: true });
    assert.strictEqual(pages.length, 1);
    checkTiles(pages, aspects.length, mode + ' fit');
  });
  test(`${mode} paged spreads across pages`, () => {
    const pages = computeLayout(aspects, box, { mode, gap: 4, fit: false, columns: 3, rowHeight: 80 });
    assert.ok(pages.length > 1, 'more than one page');
    checkTiles(pages, aspects.length, mode + ' paged');
  });
  test(`${mode} handles one image and empty input`, () => {
    checkTiles(computeLayout([1.5], box, { mode, fit: true }), 1, mode + ' single');
    assert.deepStrictEqual(computeLayout([], box, { mode }), [[]]);
  });
}

test('masonry and justified keep image proportions', () => {
  for (const mode of ['masonry', 'justified']) {
    const [tiles] = computeLayout(aspects, box, { mode, gap: 4, fit: true });
    for (const t of tiles) assert.ok(Math.abs(t.w / t.h - aspects[t.index]) < 1e-6, mode);
  }
});

test('justified rows share a height and fill the width', () => {
  const [tiles] = computeLayout(aspects, box, { mode: 'justified', gap: 4, fit: false, rowHeight: 30 });
  const rows = new Map();
  for (const t of tiles) { const k = t.y.toFixed(4); (rows.get(k) || rows.set(k, []).get(k)).push(t); }
  const list = [...rows.values()];
  for (const row of list.slice(0, -1)) {
    const right = Math.max(...row.map(t => t.x + t.w));
    const left = Math.min(...row.map(t => t.x));
    assert.ok(Math.abs(right - left - box.w) < 1e-6, 'full width row');
  }
});

test('grid cells match the chosen cell shape', () => {
  const [tiles] = computeLayout(aspects, box, { mode: 'grid', gap: 4, fit: true, cellAspect: 4 / 3 });
  for (const t of tiles) assert.ok(Math.abs(t.w / t.h - 4 / 3) < 1e-6);
});

test('extreme shapes stay inside the page', () => {
  const odd = [0.05, 20, 1, 0.1, 10, 1, 1];
  for (const mode of ['masonry', 'grid', 'justified']) for (const fit of [true, false]) {
    checkTiles(computeLayout(odd, box, { mode, fit, columns: 2, rowHeight: 300 }), odd.length, `${mode} odd fit=${fit}`);
  }
});
