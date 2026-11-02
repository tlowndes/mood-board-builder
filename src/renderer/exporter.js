/* Exporters: JPEG (one image per page) and PDF (vector text, one embedded image per tile). */
(function () {
  'use strict';

  const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
  const BASELINE = 0.82; // baseline offset as a fraction of font size, shared with the preview
  const MM_TO_PT = 72 / 25.4;

  function hexToRgb(hex) {
    const n = parseInt((hex || '#ffffff').replace('#', ''), 16);
    return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (r > 0 && ctx.roundRect) ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
    else ctx.rect(x, y, w, h);
  }

  // Draw an image cropped to fill the rectangle (centre crop).
  function drawCover(ctx, img, x, y, w, h, radius) {
    const iw = img.width, ih = img.height;
    const scale = Math.max(w / iw, h / ih);
    const sw = w / scale, sh = h / scale;
    const sx = (iw - sw) / 2, sy = (ih - sh) / 2;
    ctx.save();
    roundRectPath(ctx, x, y, w, h, radius);
    ctx.clip();
    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
    ctx.restore();
  }

  function ellipsize(measure, text, maxW) {
    if (measure(text) <= maxW) return text;
    let lo = 0, hi = text.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (measure(text.slice(0, mid) + '…') <= maxW) lo = mid; else hi = mid - 1;
    }
    return text.slice(0, lo).trimEnd() + '…';
  }

  function drawText(ctx, t, px, colours) {
    ctx.save();
    ctx.font = `${t.weight >= 700 ? 700 : 400} ${t.size * px}px ${FONT}`;
    ctx.fillStyle = t.kind === 'title' ? colours.ink : colours.soft;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = t.align === 'right' ? 'right' : 'left';
    const s = ellipsize(v => ctx.measureText(v).width, t.text, t.maxW * px);
    ctx.fillText(s, t.x * px, (t.y + t.size * BASELINE) * px);
    ctx.restore();
  }

  async function bitmapFor(item) {
    return createImageBitmap(item.blob);
  }

  async function renderPageCanvas(page, desc, items, dpi, onTile) {
    const px = dpi / 25.4;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(page.w * px);
    canvas.height = Math.round(page.h * px);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = desc.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const t of page.tiles) {
      const bmp = await bitmapFor(items[t.index]);
      drawCover(ctx, bmp, t.x * px, t.y * px, t.w * px, t.h * px, desc.radius * px);
      bmp.close();
      onTile && onTile();
    }
    for (const t of page.text) drawText(ctx, t, px, desc.colours);
    return canvas;
  }

  const toBlob = (canvas, type, q) => new Promise((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error('Could not encode image'))), type, q));

  async function exportJpeg(desc, items, dpi, onProgress) {
    const total = desc.pages.reduce((n, p) => n + p.tiles.length, 0) || 1;
    let done = 0;
    const files = [];
    for (const page of desc.pages) {
      const canvas = await renderPageCanvas(page, desc, items, dpi, () => onProgress && onProgress(++done / total));
      const blob = await toBlob(canvas, 'image/jpeg', 0.92);
      files.push({ bytes: new Uint8Array(await blob.arrayBuffer()) });
      canvas.width = canvas.height = 0;
    }
    return files;
  }

  // Render one tile (already cropped, corners filled with the background) as a JPEG for the PDF.
  async function tileJpeg(item, t, desc, dpi) {
    const bmp = await bitmapFor(item);
    const px = dpi / 25.4;
    // never upscale beyond the pixels the crop actually has
    const scale = Math.max((t.w * px) / bmp.width, (t.h * px) / bmp.height);
    const cap = Math.min(1, 1 / scale);
    const w = Math.max(1, Math.round(t.w * px * cap));
    const h = Math.max(1, Math.round(t.h * px * cap));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = desc.bg;
    ctx.fillRect(0, 0, w, h);
    drawCover(ctx, bmp, 0, 0, w, h, desc.radius * (w / t.w));
    bmp.close();
    const blob = await toBlob(c, 'image/jpeg', 0.9);
    c.width = c.height = 0;
    return new Uint8Array(await blob.arrayBuffer());
  }

  async function textAsImage(pdf, t, colours) {
    // Fallback for characters the built-in PDF fonts can't encode (e.g. emoji, CJK).
    const px = 600 / 25.4;
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    ctx.font = `${t.weight >= 700 ? 700 : 400} ${t.size * px}px ${FONT}`;
    const s = ellipsize(v => ctx.measureText(v).width, t.text, t.maxW * px);
    const w = Math.min(t.maxW * px, ctx.measureText(s).width) + 4;
    c.width = Math.ceil(w); c.height = Math.ceil(t.size * px * 1.3);
    ctx.font = `${t.weight >= 700 ? 700 : 400} ${t.size * px}px ${FONT}`;
    ctx.fillStyle = t.kind === 'title' ? colours.ink : colours.soft;
    ctx.fillText(s, 0, t.size * px * BASELINE);
    const png = await pdf.embedPng(new Uint8Array(await (await toBlob(c, 'image/png')).arrayBuffer()));
    return { png, wMm: c.width / px, hMm: c.height / px };
  }

  async function exportPdf(desc, items, dpi, meta, onProgress) {
    const { PDFDocument, StandardFonts, rgb } = PDFLib;
    const pdf = await PDFDocument.create();
    pdf.setTitle(meta.title || 'Mood board');
    pdf.setCreator('Mood Board Builder');
    pdf.setProducer('Mood Board Builder');
    const regular = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const bg = hexToRgb(desc.bg);
    const total = desc.pages.reduce((n, p) => n + p.tiles.length, 0) || 1;
    let done = 0;

    for (const page of desc.pages) {
      const W = page.w * MM_TO_PT, H = page.h * MM_TO_PT;
      const p = pdf.addPage([W, H]);
      p.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(bg.r, bg.g, bg.b) });

      for (const t of page.tiles) {
        const jpg = await pdf.embedJpg(await tileJpeg(items[t.index], t, desc, dpi));
        p.drawImage(jpg, { x: t.x * MM_TO_PT, y: H - (t.y + t.h) * MM_TO_PT, width: t.w * MM_TO_PT, height: t.h * MM_TO_PT });
        onProgress && onProgress(++done / total);
      }

      for (const t of page.text) {
        const font = t.weight >= 700 ? bold : regular;
        const size = t.size * MM_TO_PT;
        const colour = hexToRgb(t.kind === 'title' ? desc.colours.ink : desc.colours.softHex);
        try {
          const s = ellipsize(v => font.widthOfTextAtSize(v, size), t.text, t.maxW * MM_TO_PT);
          const width = font.widthOfTextAtSize(s, size);
          const x = (t.align === 'right' ? t.x * MM_TO_PT - width : t.x * MM_TO_PT);
          p.drawText(s, { x, y: H - (t.y + t.size * BASELINE) * MM_TO_PT, size, font, color: rgb(colour.r, colour.g, colour.b) });
        } catch {
          const img = await textAsImage(pdf, t, desc.colours);
          const x = t.align === 'right' ? t.x - img.wMm : t.x;
          p.drawImage(img.png, { x: x * MM_TO_PT, y: H - (t.y + img.hMm) * MM_TO_PT, width: img.wMm * MM_TO_PT, height: img.hMm * MM_TO_PT });
        }
      }
    }
    return [{ bytes: await pdf.save() }];
  }

  window.MoodExport = { exportJpeg, exportPdf, FONT, BASELINE };
})();
