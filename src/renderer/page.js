/* Page geometry shared by the on-screen preview and the exporters. All units are millimetres. */
(function () {
  'use strict';

  const SIZES = {
    a4: { w: 297, h: 210, label: 'A4' },
    a3: { w: 420, h: 297, label: 'A3' },
    slide: { w: 338.667, h: 190.5, label: '16:9' }, // 13.33 × 7.5 in, same as PowerPoint widescreen
    square: { w: 250, h: 250, label: 'Square' },
  };

  function pageSize(s) {
    if (s.size === 'custom') {
      const w = Math.min(2000, Math.max(50, Number(s.customW) || 297));
      const h = Math.min(2000, Math.max(50, Number(s.customH) || 210));
      return { w, h };
    }
    const base = SIZES[s.size] || SIZES.a4;
    if (s.size === 'square') return { w: base.w, h: base.h };
    return s.orientation === 'portrait' ? { w: base.h, h: base.w } : { w: base.w, h: base.h };
  }

  function luminance(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return 1;
    const n = parseInt(m[1], 16);
    const ch = [n >> 16, (n >> 8) & 255, n & 255].map(v => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }

  function inkColours(bg) {
    const dark = luminance(bg) < 0.35;
    return dark ? { ink: '#f4f2ee', soft: 'rgba(244,242,238,0.62)', softHex: '#b4b3b0' } : { ink: '#161616', soft: 'rgba(22,22,22,0.55)', softHex: '#6b6b6b' };
  }

  /**
   * Full description of every page: size, header text placement and image tiles.
   * @param {object} s       settings
   * @param {number[]} aspects
   */
  function describe(s, aspects) {
    const { w, h } = pageSize(s);
    const short = Math.min(w, h);
    const m = Math.max(0, Number(s.margin) || 0);
    const inset = Math.max(m, short * 0.03); // header text never sits on the page edge
    const title = (s.title || '').trim();
    const subtitle = (s.subtitle || '').trim();
    const titleSize = short * 0.034;
    const subSize = short * 0.019;
    const hasHeader = !!(title || subtitle);

    let headerH = 0;
    const text = [];
    if (hasHeader) {
      let y = inset;
      if (title) { text.push({ kind: 'title', text: title, x: inset, y, size: titleSize, weight: 700 }); y += titleSize * 1.3; }
      if (subtitle) { text.push({ kind: 'subtitle', text: subtitle, x: inset, y, size: subSize, weight: 400 }); y += subSize * 1.5; }
      headerH = y - m + short * 0.025;
    }

    const box = { x: m, y: m + headerH, w: w - 2 * m, h: h - 2 * m - headerH };
    const pages = MoodLayout.computeLayout(aspects, box, {
      mode: s.mode,
      gap: Number(s.gap) || 0,
      fit: !!s.fit,
      columns: Number(s.columns) || 4,
      rowHeight: Number(s.rowHeight) || 40,
      cellAspect: Number(s.cellAspect) || 1,
    });

    const colours = inkColours(s.bg);
    const result = pages.map((tiles, i) => {
      const items = text.map(t => ({ ...t, maxW: w - inset * 2 }));
      if (s.pageNumbers && pages.length > 1) {
        const size = short * 0.016;
        items.push({
          kind: 'page',
          text: `${i + 1} / ${pages.length}`,
          x: w - inset,
          y: hasHeader ? inset + (title ? (titleSize - size) / 2 : 0) : h - Math.max(m, size * 2) / 2 - size / 2,
          size,
          weight: 400,
          align: 'right',
          maxW: w / 4,
        });
        // keep the title clear of the page number
        for (const t of items) if (t.kind !== 'page' && Math.abs(t.y - items[items.length - 1].y) < titleSize) t.maxW = w - inset * 2 - w / 8;
      }
      return { w, h, tiles, text: items };
    });

    return { w, h, box, pages: result, colours, radius: Math.max(0, Number(s.radius) || 0), bg: s.bg || '#ffffff' };
  }

  window.MoodPage = { describe, pageSize, inkColours, SIZES };
})();
