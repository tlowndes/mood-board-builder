/* Mood Board Builder: app state, controls and live preview. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);

  const DEFAULTS = {
    mode: 'masonry', fit: true, columns: 4, rowHeight: 45, cellAspect: '1',
    gap: 3, margin: 12, radius: 0, bg: '#f4f1ec',
    title: '', subtitle: '', pageNumbers: true,
    size: 'a4', orientation: 'landscape', customW: 297, customH: 210,
    format: 'pdf', dpi: '300',
  };

  let settings = { ...DEFAULTS };
  try { Object.assign(settings, JSON.parse(localStorage.getItem('mood.settings') || '{}')); } catch { /* ignore */ }
  const saveSettings = () => { try { localStorage.setItem('mood.settings', JSON.stringify(settings)); } catch { /* ignore */ } };

  let items = []; // { id, name, path, blob, aspect, thumb }
  let sourceName = '';
  let nextId = 1;

  /* ---------- Image loading ---------- */

  const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', avif: 'image/avif' };

  async function loadItem(file) {
    const name = file.split(/[\\/]/).pop();
    const ext = name.split('.').pop().toLowerCase();
    const bytes = await mood.readFile(file);
    const blob = new Blob([bytes], { type: MIME[ext] || 'application/octet-stream' });
    const bmp = await createImageBitmap(blob);
    const aspect = bmp.width / bmp.height;
    // small preview copy keeps the UI quick; the original is used for export
    const long = 900;
    const scale = Math.min(1, long / Math.max(bmp.width, bmp.height));
    const c = new OffscreenCanvas(Math.max(1, Math.round(bmp.width * scale)), Math.max(1, Math.round(bmp.height * scale)));
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    const thumb = URL.createObjectURL(await c.convertToBlob({ type: 'image/webp', quality: 0.85 }));
    return { id: nextId++, name, path: file, blob, aspect, thumb, w: Math.round(aspect * 1000) };
  }

  async function addFiles(files, { replace = false, label } = {}) {
    if (!files || !files.length) { if (replace) toast('No images found there.'); return; }
    const existing = new Set(replace ? [] : items.map(i => i.path));
    const todo = files.filter(f => !existing.has(f));
    busy(true, `Loading ${todo.length} image${todo.length === 1 ? '' : 's'}…`, 0);
    const loaded = [];
    let failed = 0;
    let done = 0;
    let next = 0;
    async function worker() {
      while (next < todo.length) {
        const k = next++;
        try { loaded[k] = await loadItem(todo[k]); } catch { failed++; }
        busy(true, `Loading images… ${++done} / ${todo.length}`, done / todo.length);
      }
    }
    await Promise.all(Array.from({ length: 4 }, worker));
    if (replace) clearItems();
    items.push(...loaded.filter(Boolean));
    if (label) sourceName = label;
    busy(false);
    if (failed) toast(`${failed} file${failed === 1 ? '' : 's'} couldn't be read and ${failed === 1 ? 'was' : 'were'} skipped.`);
    render();
  }

  function clearItems() {
    for (const it of items) URL.revokeObjectURL(it.thumb);
    items = [];
    sourceName = '';
  }

  /* ---------- Controls ---------- */

  function bindSegmented(id, key) {
    const el = $(id);
    el.addEventListener('click', e => {
      const b = e.target.closest('button[data-value]');
      if (!b) return;
      settings[key] = b.dataset.value;
      update();
    });
  }

  function syncSegmented(id, value) {
    for (const b of $(id).querySelectorAll('button[data-value]')) {
      const on = String(b.dataset.value) === String(value);
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', on);
    }
  }

  const RANGES = ['columns', 'rowHeight', 'gap', 'margin', 'radius'];
  const TEXTS = ['title', 'subtitle', 'customW', 'customH'];
  const CHECKS = ['fit', 'pageNumbers'];

  function bindControls() {
    bindSegmented('mode', 'mode');
    bindSegmented('cellAspect', 'cellAspect');
    bindSegmented('orientation', 'orientation');
    bindSegmented('format', 'format');
    bindSegmented('dpi', 'dpi');
    for (const k of RANGES) $(k).addEventListener('input', e => { settings[k] = Number(e.target.value); update(); });
    for (const k of TEXTS) $(k).addEventListener('input', e => { settings[k] = e.target.value; update(); });
    for (const k of CHECKS) $(k).addEventListener('change', e => { settings[k] = e.target.checked; update(); });
    $('size').addEventListener('change', e => { settings.size = e.target.value; update(); });
    $('bg').addEventListener('input', e => { settings.bg = e.target.value; update(); });
    $('swatches').addEventListener('click', e => {
      const b = e.target.closest('button[data-color]');
      if (b) { settings.bg = b.dataset.color; update(); }
    });

    const pickFolder = async () => {
      const r = await mood.pickFolder();
      if (r) addFiles(r.files, { replace: true, label: r.name });
    };
    const openPinterest = () => PinterestUI.open(importBoard);
    $('pickFolder').addEventListener('click', pickFolder);
    $('openPinterest').addEventListener('click', openPinterest);
    document.querySelector('[data-action="pickFolder"]').addEventListener('click', pickFolder);
    document.querySelector('[data-action="openPinterest"]').addEventListener('click', openPinterest);
    $('addFiles').addEventListener('click', async () => addFiles(await mood.pickFiles(), { label: sourceName || 'Loose images' }));
    $('shuffle').addEventListener('click', () => {
      for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; }
      render();
    });
    $('clearAll').addEventListener('click', () => { clearItems(); render(); });
    $('export').addEventListener('click', doExport);
  }

  function syncControls() {
    syncSegmented('mode', settings.mode);
    syncSegmented('cellAspect', settings.cellAspect);
    syncSegmented('orientation', settings.orientation);
    syncSegmented('format', settings.format);
    syncSegmented('dpi', settings.dpi);
    for (const k of RANGES) $(k).value = settings[k];
    for (const k of TEXTS) if (document.activeElement !== $(k)) $(k).value = settings[k];
    for (const k of CHECKS) $(k).checked = !!settings[k];
    $('size').value = settings.size;
    $('bg').value = /^#[0-9a-f]{6}$/i.test(settings.bg) ? settings.bg : '#ffffff';
    for (const b of $('swatches').querySelectorAll('button')) b.classList.toggle('on', b.dataset.color.toLowerCase() === settings.bg.toLowerCase());
    document.querySelector('.custom-colour').classList.toggle('on', ![...$('swatches').querySelectorAll('button')].some(b => b.classList.contains('on')));
    document.querySelector('.custom-colour').style.setProperty('--c', settings.bg);

    for (const o of document.querySelectorAll('output[data-for]')) {
      const v = settings[o.dataset.for];
      o.textContent = `${v}${o.dataset.unit ? ' ' + o.dataset.unit : ''}`;
    }
    const tag = `${settings.mode}-${settings.fit ? 'fit' : 'paged'}`;
    for (const el of document.querySelectorAll('[data-show]')) {
      const keys = el.dataset.show.split(' ');
      el.hidden = !keys.some(k => k === tag || k === settings.mode);
    }
    for (const el of document.querySelectorAll('[data-show-size]')) el.hidden = !el.dataset.showSize.split(' ').includes(settings.size);
    for (const el of document.querySelectorAll('[data-hide-size]')) el.hidden = el.dataset.hideSize.split(' ').includes(settings.size);
    $('export').textContent = `Export ${settings.format === 'pdf' ? 'PDF' : 'JPEG'}`;
  }

  function update() {
    saveSettings();
    render();
  }

  /* ---------- Preview ---------- */

  let lastDesc = null;

  function render() {
    syncControls();
    const has = items.length > 0;
    $('empty').hidden = has;
    $('export').disabled = !has;
    $('shuffle').disabled = items.length < 2;
    $('clearAll').disabled = !has;
    $('hint').hidden = !has;
    $('sourceLabel').textContent = has ? `${items.length} image${items.length === 1 ? '' : 's'}${sourceName ? ' · ' + sourceName : ''}` : 'No images yet';

    const desc = MoodPage.describe(settings, items.map(i => i.aspect));
    lastDesc = desc;
    const n = desc.pages.length;
    $('pageInfo').textContent = has ? `${n} page${n === 1 ? '' : 's'} · ${Math.round(desc.w)} × ${Math.round(desc.h)} mm` : '';
    const dpi = Number(settings.dpi);
    const pxW = Math.round((desc.w * dpi) / 25.4), pxH = Math.round((desc.h * dpi) / 25.4);
    $('exportInfo').textContent = settings.format === 'jpg'
      ? `${pxW} × ${pxH} px${n > 1 ? `, ${n} files` : ''}`
      : `${n} page PDF, images at up to ${dpi} dpi`;

    const host = $('pages');
    host.textContent = '';
    if (!has) return;

    const stage = $('stage');
    const availW = stage.clientWidth - 96;
    const availH = stage.clientHeight - 120;
    const scale = Math.max(0.5, n === 1 ? Math.min(availW / desc.w, availH / desc.h) : Math.min(availW / desc.w, (availH * 0.92) / desc.h));

    desc.pages.forEach((page, pi) => {
      const el = document.createElement('div');
      el.className = 'page';
      el.style.width = `${page.w * scale}px`;
      el.style.height = `${page.h * scale}px`;
      el.style.background = desc.bg;
      for (const t of page.tiles) {
        const it = items[t.index];
        const tile = document.createElement('div');
        tile.className = 'tile';
        tile.draggable = true;
        tile.dataset.index = t.index;
        Object.assign(tile.style, {
          left: `${t.x * scale}px`, top: `${t.y * scale}px`,
          width: `${t.w * scale}px`, height: `${t.h * scale}px`,
          borderRadius: `${desc.radius * scale}px`,
        });
        const img = document.createElement('img');
        img.src = it.thumb;
        img.alt = it.name;
        img.draggable = false;
        const rm = document.createElement('button');
        rm.className = 'tile-remove';
        rm.title = `Remove ${it.name}`;
        rm.textContent = '×';
        rm.addEventListener('click', e => {
          e.stopPropagation();
          const [gone] = items.splice(t.index, 1);
          URL.revokeObjectURL(gone.thumb);
          render();
        });
        tile.append(img, rm);
        el.append(tile);
      }
      for (const t of page.text) {
        const tx = document.createElement('div');
        tx.className = `page-text ${t.kind}`;
        tx.textContent = t.text;
        const size = t.size * scale;
        Object.assign(tx.style, {
          fontSize: `${size}px`,
          fontWeight: t.weight,
          top: `${(t.y + t.size * MoodExport.BASELINE) * scale - size * 0.846}px`,
          maxWidth: `${t.maxW * scale}px`,
          color: t.kind === 'title' ? desc.colours.ink : desc.colours.soft,
        });
        if (t.align === 'right') tx.style.right = `${(page.w - t.x) * scale}px`;
        else tx.style.left = `${t.x * scale}px`;
        el.append(tx);
      }
      const label = document.createElement('div');
      label.className = 'page-label';
      label.textContent = n > 1 ? `Page ${pi + 1}` : '';
      const wrap = document.createElement('div');
      wrap.className = 'page-wrap';
      wrap.append(el, label);
      host.append(wrap);
    });
  }

  /* ---------- Reorder by dragging tiles ---------- */

  let dragFrom = null;
  $('pages').addEventListener('dragstart', e => {
    const tile = e.target.closest('.tile');
    if (!tile) return;
    dragFrom = Number(tile.dataset.index);
    tile.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/x-mood-tile', String(dragFrom));
  });
  $('pages').addEventListener('dragover', e => {
    if (dragFrom === null) return;
    const tile = e.target.closest('.tile');
    if (!tile) return;
    e.preventDefault();
    for (const t of document.querySelectorAll('.tile.drop-target')) t.classList.remove('drop-target');
    if (Number(tile.dataset.index) !== dragFrom) tile.classList.add('drop-target');
  });
  $('pages').addEventListener('drop', e => {
    if (dragFrom === null) return;
    const tile = e.target.closest('.tile');
    e.preventDefault();
    e.stopPropagation();
    if (tile) {
      const to = Number(tile.dataset.index);
      if (to !== dragFrom) {
        const [moved] = items.splice(dragFrom, 1);
        items.splice(to, 0, moved);
      }
    }
    dragFrom = null;
    render();
  });
  $('pages').addEventListener('dragend', () => { dragFrom = null; for (const t of document.querySelectorAll('.tile')) t.classList.remove('dragging', 'drop-target'); });

  /* ---------- Drop files or folders from Explorer ---------- */

  let dragDepth = 0;
  const isFileDrag = e => dragFrom === null && [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', e => { if (isFileDrag(e)) { dragDepth++; $('dropOverlay').classList.add('show'); } });
  window.addEventListener('dragleave', e => { if (isFileDrag(e) && --dragDepth <= 0) { dragDepth = 0; $('dropOverlay').classList.remove('show'); } });
  window.addEventListener('dragover', e => { if (isFileDrag(e)) e.preventDefault(); });
  window.addEventListener('drop', async e => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepth = 0;
    $('dropOverlay').classList.remove('show');
    const files = await mood.expandDropped(e.dataTransfer.files);
    const single = e.dataTransfer.files.length === 1 ? e.dataTransfer.files[0].name : '';
    addFiles(files, { label: sourceName || (single && !/\.\w+$/.test(single) ? single : 'Dropped images') });
  });

  /* ---------- Pinterest ---------- */

  async function importBoard(board) {
    busy(true, `Downloading “${board.name}”…`, 0);
    const off = mood.pinterest.onProgress(p => busy(true, `Downloading “${board.name}”… ${p.done} / ${p.total}`, p.done / p.total));
    try {
      const files = await mood.pinterest.download(board.id);
      off();
      await addFiles(files, { replace: true, label: `Pinterest · ${board.name}` });
      if (!settings.title) { settings.title = board.name; update(); }
    } catch (e) {
      off();
      busy(false);
      toast(e.message === 'NOT_SIGNED_IN' ? 'Pinterest signed you out. Sign in again.' : e.message);
    }
  }

  /* ---------- Export ---------- */

  async function doExport() {
    if (!items.length) return;
    const desc = MoodPage.describe(settings, items.map(i => i.aspect));
    const dpi = Number(settings.dpi);
    const name = (settings.title || sourceName || 'mood-board').replace(/^Pinterest · /, '').replace(/[\\/:*?"<>|]+/g, '').trim() || 'mood-board';
    busy(true, 'Building your board…', 0);
    try {
      const progress = f => busy(true, `Building your board… ${Math.round(f * 100)}%`, f);
      const files = settings.format === 'pdf'
        ? await MoodExport.exportPdf(desc, items, dpi, { title: settings.title }, progress)
        : await MoodExport.exportJpeg(desc, items, dpi, progress);
      busy(true, 'Saving…', 1);
      const written = await mood.saveExport({ defaultName: name, ext: settings.format, files });
      busy(false);
      if (written && written.length) {
        toast(`Saved ${written.length > 1 ? written.length + ' files' : written[0].split(/[\\/]/).pop()}`, () => mood.reveal(written[0]), 'Show in folder');
      }
    } catch (e) {
      busy(false);
      toast(`Export failed: ${e.message}`);
    }
  }

  /* ---------- Little UI helpers ---------- */

  function busy(on, text, frac) {
    $('busy').hidden = !on;
    if (text) $('busyText').textContent = text;
    $('busyBar').style.width = `${Math.round((frac || 0) * 100)}%`;
  }

  let toastTimer;
  function toast(msg, action, actionLabel) {
    const el = $('toast');
    el.textContent = msg;
    if (action) {
      const b = document.createElement('button');
      b.textContent = actionLabel;
      b.addEventListener('click', action);
      el.append(b);
    }
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 6000);
  }

  let resizeRaf;
  window.addEventListener('resize', () => { cancelAnimationFrame(resizeRaf); resizeRaf = requestAnimationFrame(render); });

  /* ---------- Updates ---------- */

  mood.version().then(v => ($('version').textContent = `Version ${v}`));
  let manualCheck = false;
  $('checkUpdates').addEventListener('click', () => {
    if ($('checkUpdates').dataset.ready) return mood.updates.install();
    manualCheck = true;
    mood.updates.check();
  });
  mood.updates.onState(u => {
    const btn = $('checkUpdates');
    btn.disabled = false;
    switch (u.state) {
      case 'checking': btn.textContent = 'Checking…'; btn.disabled = true; break;
      case 'available': btn.textContent = `Downloading v${u.version}…`; btn.disabled = true; break;
      case 'downloading': btn.textContent = `Downloading… ${u.percent}%`; btn.disabled = true; break;
      case 'ready':
        btn.textContent = 'Restart to update';
        btn.dataset.ready = '1';
        toast(`Version ${u.version} is ready.`, () => mood.updates.install(), 'Restart now');
        break;
      case 'latest': btn.textContent = 'Check for updates'; if (manualCheck) toast("You're on the latest version."); break;
      case 'unsupported': btn.textContent = 'Check for updates'; if (manualCheck) toast('Updates work in the installed app, not the portable or dev version.'); break;
      case 'error': btn.textContent = 'Check for updates'; if (manualCheck) toast(`Couldn't check for updates: ${u.message || 'unknown error'}`); break;
    }
    if (u.state !== 'checking') manualCheck = false;
  });

  bindControls();
  render();
  window.__mood = { addFiles, get items() { return items; }, settings: () => settings, render };
})();
