// Project page. Static only: no inference runs in the browser.
(function () {
  'use strict';

  // ---- Mode selector
  const MODE_TEXT = {
    none: '',
    Eff: 'Eff: the base path. Nuclei are detected, typed and segmented from the shared representation at the lowest compute.',
    Cls: 'Cls: Eff plus added semantic capacity, to refine what type each nucleus is. Boundaries are left as in Eff.',
    Seg: 'Seg: Eff plus added spatial capacity, to refine each nucleus boundary. Types are left as in Eff.',
    Full: 'Full: both additions together, semantic and spatial.'
  };
  const buttons = document.querySelectorAll('.segmented button');
  const desc = document.getElementById('mode-desc');
  function setMode(mode) {
    buttons.forEach(b => b.setAttribute('aria-checked', String(b.dataset.mode === mode)));
    if (desc) desc.textContent = MODE_TEXT[mode] || '';
  }
  buttons.forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
  setMode('none');

  // ---- Whole-slide viewer
  const CLASSES = ['Neoplastic', 'Epithelial', 'Inflammatory', 'Connective', 'Dead'];
  const COLORS = ['#e53935', '#fb8c00', '#43a047', '#1e88e5', '#fdd835'];
  // nuclei-chunks/v1 stores the release type_id: 0 Neoplastic, 1 Inflammatory, 2 Connective, 3 Dead, 4 Epithelial.
  const TYPE_NAMES = ['Neoplastic', 'Inflammatory', 'Connective', 'Dead', 'Epithelial'];
  const TYPE_COLORS = TYPE_NAMES.map(n => COLORS[CLASSES.indexOf(n)]);
  const OSD_IMAGES = 'https://cdn.jsdelivr.net/npm/openseadragon@4.1.1/build/openseadragon/images/';
  const FALLBACK = { id: 'placeholder', title: 'Synthetic placeholder', mpp: null,
    attribution: 'Synthetic CC0 drawing (not a real slide).',
    dzi: { type: 'image', url: 'assets/img/placeholder_tissue.svg' }, overlays: {} };

  const el = id => document.getElementById(id);
  const select = el('slide-select'), info = el('info'), attribution = el('attribution');
  if (!window.OpenSeadragon || !el('osd')) return;

  const viewer = window.OpenSeadragon({
    id: 'osd', prefixUrl: OSD_IMAGES, crossOriginPolicy: 'Anonymous',
    showNavigator: true, navigatorPosition: 'BOTTOM_RIGHT',
    maxZoomPixelRatio: 2, visibilityRatio: 0.5, constrainDuringPan: true,
    gestureSettingsTouch: { pinchRotate: false }
  });

  // ---- Tile-failure notice (OpenSeadragon 4.1.1 viewer events 'tile-load-failed' / 'tile-loaded').
  // Shown only after repeated failures within a short window with no tile loaded in between, or when a
  // tile failed and still no tile at all has loaded 3 s later (small viewports may request a single
  // overview tile). A failed tile next to tiles that did load never triggers it.
  const FAIL_WINDOW_MS = 8000, FAIL_THRESHOLD = 6, NONE_LOADED_WAIT_MS = 3000;
  const notice = document.createElement('div');
  notice.className = 'osd-notice'; notice.setAttribute('role', 'status'); notice.hidden = true;
  notice.textContent = 'WSI preview could not be loaded. Please try again later.';
  el('osd').appendChild(notice);
  let failTimes = [], loadedSinceOpen = 0, noneLoadedTimer = null;
  function clearTileFailure() { failTimes = []; notice.hidden = true; clearTimeout(noneLoadedTimer); }
  viewer.addHandler('tile-load-failed', () => {
    const now = Date.now();
    failTimes = failTimes.filter(t => now - t < FAIL_WINDOW_MS);
    failTimes.push(now);
    if (failTimes.length >= FAIL_THRESHOLD) notice.hidden = false;
    if (loadedSinceOpen === 0) {
      clearTimeout(noneLoadedTimer);
      noneLoadedTimer = setTimeout(() => { if (loadedSinceOpen === 0) notice.hidden = false; }, NONE_LOADED_WAIT_MS);
    }
  });
  viewer.addHandler('tile-loaded', () => { loadedSinceOpen++; clearTileFailure(); });

  // ---- Slides, reference (GT) layer and chunked nucleus overlays
  const CONFIG = 'data/slides.json';   // PAIP2020 demo slides
  const MODES = ['Eff', 'Cls', 'Seg', 'Full'];
  let slides = [], current = null, mode = 'none', budget = 0;   // budget: share of patches routed to Cls (Eff view)
  const cache = new Map();       // url -> parsed chunk | Promise
  const indexes = {};            // slide.id + mode -> index.json
  const gts = {};                // slide.id -> GT JSON
  const canvas = document.createElement('canvas');
  canvas.className = 'nuclei-layer';
  viewer.canvas.appendChild(canvas);
  const gtBox = el('layer-gt'), predBox = el('layer-pred'), rtInput = el('route-input'), rtOut = el('route-out'), rtCount = el('route-count');
  const preds = {};              // slide.id + mode -> predicted tumour area JSON
  const modeInputs = Array.from(document.querySelectorAll('input[name="model-mode"]'));

  function overlayBase(slide, m) { return slide.overlays && slide.overlays[m]; }

  function openSlide(slide) {
    current = slide;
    loadedSinceOpen = 0; clearTileFailure();
    modeInputs.forEach(r => {
      const ok = r.value === 'none' || !!overlayBase(slide, r.value);
      r.disabled = !ok; r.parentElement.classList.toggle('off', !ok);
      r.parentElement.title = ok ? '' : 'Not available for this slide';
    });
    if (mode !== 'none' && !overlayBase(slide, mode)) setModelMode('none');
    if (predBox) { const ok = !!slide.pred_area; predBox.disabled = !ok; predBox.parentElement.classList.toggle('off', !ok); }
    loadPred();
    if (gtBox) {
      gtBox.disabled = !slide.gt; gtBox.parentElement.classList.toggle('off', !slide.gt);
      if (slide.gt) loadGT(slide).then(draw, () => { info.textContent = 'Tumor annotation could not be loaded.'; });
    }
    attribution.textContent = (slide.attribution ? 'Image: ' + slide.attribution : '') + (slide.note ? ' ' + slide.note : '');
    info.textContent = 'Click the slide to inspect a location.';
    viewer.open(slide.dzi);
    if (mode !== 'none') loadIndex(slide, mode).then(updateCount);
    if (overlayBase(slide, 'Eff')) loadIndex(slide, 'Eff').then(updateCount, () => {});   // routing counts
    updateCount();
  }

  async function getJSON(url) { const r = await fetch(url); if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); }
  // Predicted tumour area (model prediction, A-simple rule) of the selected model mode; Cls when no mode is selected.
  function predMode() { return current && current.pred_area ? (current.pred_area[mode] ? mode : 'Cls') : null; }
  function loadPred() {
    const m = predMode(); if (!m || !predBox || !predBox.checked) return;
    const k = current.id + '/' + m, sl = current;
    if (!preds[k]) getJSON(sl.pred_area[m]).then(d => { preds[k] = d; draw(); }, () => { info.textContent = 'Predicted tumor area could not be loaded.'; });
  }
  async function loadGT(slide) { if (!gts[slide.id]) gts[slide.id] = await getJSON(slide.gt); return gts[slide.id]; }
  async function loadIndex(slide, m) {
    const k = slide.id + '/' + m;
    if (!indexes[k]) {
      const d = await getJSON(overlayBase(slide, m) + 'index.json');
      if (d.format !== 'nuclei-chunks/v1' && d.format !== 'nuclei-chunks/v2-routing') throw new Error('overlay format');
      indexes[k] = d;
    }
    return indexes[k];
  }

  // Binary chunk parser (format nuclei-chunks/v1, see the asset repository PROVENANCE).
  // v1: [u16 x, u16 y, u8 type, u8 conf]; v2-routing: [u16 x, u16 y, u8 eff_type, u8 cls_type, u16 rank_q] (+ contour on fine)
  function parseChunk(buf, level, ix, cx, cy) {
    const dv = new DataView(buf), n = dv.getUint32(0, true), size = ix[level], K = ix.contour_points;
    const routed = ix.format === 'nuclei-chunks/v2-routing';
    const x = new Float32Array(n), y = new Float32Array(n), t = new Uint8Array(n), t2 = routed ? new Uint8Array(n) : null;
    const rk = routed ? new Uint16Array(n) : null;
    const poly = level === 'fine' ? new Int8Array(n * K * 2) : null;
    let o = 4;
    for (let i = 0; i < n; i++) {
      const a = dv.getUint16(o, true), b = dv.getUint16(o + 2, true);
      x[i] = cx * size + (level === 'coarse' ? a * 4 : a); y[i] = cy * size + (level === 'coarse' ? b * 4 : b);
      t[i] = dv.getUint8(o + 4);
      if (routed) { t2[i] = dv.getUint8(o + 5); rk[i] = dv.getUint16(o + 6, true); o += 8; } else o += 6;
      if (poly) { poly.set(new Int8Array(buf, o, K * 2), i * K * 2); o += K * 2; }
    }
    return { n, x, y, t, t2, rk, poly, K };
  }
  // class shown for nucleus i: in the routing view, Cls class if its patch is within the budget, Eff class otherwise
  function routeCut(ix) { return ix.format === 'nuclei-chunks/v2-routing' ? Math.round(Math.round(budget * ix.eligible_tiles) / ix.eligible_tiles * 65534) : 0; }
  function typeOf(ch, i, cut) { return ch.t2 && ch.rk[i] < cut ? ch.t2[i] : ch.t[i]; }
  function getChunk(slide, m, ix, level, cx, cy) {
    const url = overlayBase(slide, m) + level + '/' + cx + '_' + cy + '.bin';
    const hit = cache.get(url);
    if (hit && !(hit instanceof Promise)) return hit;
    if (!hit) {
      cache.set(url, fetch(url).then(r => { if (!r.ok) throw new Error(url + ' ' + r.status); return r.arrayBuffer(); })
        .then(b => { cache.set(url, parseChunk(b, level, ix, cx, cy)); draw(); })
        .catch(() => cache.delete(url)));
      if (cache.size > 600) { const k = cache.keys().next().value; cache.delete(k); }   // bounded memory
    }
    return null;
  }

  function updateCount() {
    if (!rtCount) return;
    const ix = current && indexes[current.id + '/Eff'];
    if (!ix) { rtCount.textContent = current && overlayBase(current, 'Eff') ? 'Loading…' : 'Routing data not available for this slide.'; return; }
    if (ix.format !== 'nuclei-chunks/v2-routing') { rtCount.textContent = 'Routing data not available for this slide.'; return; }
    const k = Math.round(budget * ix.eligible_tiles), h = ix.changed_rank_hist_permille;
    let ch = 0; for (let i = 0; i < Math.min(1000, Math.round(budget * 1000)); i++) ch += h[i];
    rtCount.textContent = 'Cls applied to ' + k.toLocaleString() + ' / ' + ix.eligible_tiles.toLocaleString() + ' patches · nuclei whose class changes vs Eff: ' + ch.toLocaleString() + ' / ' + ix.n_nuclei.toLocaleString();
  }

  // native level-0 px -> displayed-image px, from slide metadata (native_size) and the opened DZI size.
  function displayScale(item) {
    const n = current && current.native_size;
    return n && n[0] ? item.source.dimensions.x / n[0] : 1;
  }

  let drawPending = false;
  function draw() { if (!drawPending) { drawPending = true; requestAnimationFrame(() => { drawPending = false; render(); }); } }
  function render() {
    const w = viewer.canvas.clientWidth, h = viewer.canvas.clientHeight, dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    const item = viewer.world.getItemAt(0);
    if (!item || !current) return;
    // Overlays and GT are stored in native level-0 coordinates; the displayed DZI may be downsampled.
    const ds = displayScale(item);
    const o0 = item.imageToViewerElementCoordinates(new OpenSeadragon.Point(0, 0));
    const scale = (item.imageToViewerElementCoordinates(new OpenSeadragon.Point(1000, 0)).x / 1000 - o0.x / 1000) * ds;
    const V = (px, py) => [o0.x + px * scale, o0.y + py * scale];
    const tl0 = item.viewerElementToImageCoordinates(new OpenSeadragon.Point(0, 0));
    const br0 = item.viewerElementToImageCoordinates(new OpenSeadragon.Point(w, h));
    const tl = { x: tl0.x / ds, y: tl0.y / ds }, br = { x: br0.x / ds, y: br0.y / ds };
    // Reference layer: pathologist Whole Tumor Area (ground truth), drawn under the nuclei.
    const gt = gts[current.id];
    if (gt && gtBox && gtBox.checked) {
      ctx.beginPath();
      gt.regions.forEach(r => r.points.forEach((p, i) => { const v = V(p[0], p[1]); i ? ctx.lineTo(v[0], v[1]) : ctx.moveTo(v[0], v[1]); }));
      ctx.closePath();
      ctx.fillStyle = 'rgba(0, 229, 255, 0.12)'; ctx.fill('evenodd');
    }
    const pm = predMode(), pa = pm && predBox && predBox.checked ? preds[current.id + '/' + pm] : null;
    const pathOf = d => { ctx.beginPath(); d.regions.forEach(r => r.points.forEach((p, i) => { const v = V(p[0], p[1]); i ? ctx.lineTo(v[0], v[1]) : ctx.moveTo(v[0], v[1]); }) ); };
    if (pa) { pathOf(pa); ctx.fillStyle = 'rgba(255, 64, 200, 0.10)'; ctx.fill('evenodd'); }
    const strokeGT = () => {    // outlines are drawn last so nuclei never hide them
      if (pa) { pathOf(pa); ctx.setLineDash([6, 4]); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255, 64, 200, 0.95)'; ctx.stroke(); ctx.setLineDash([]); }
      if (!(gt && gtBox && gtBox.checked)) return;
      ctx.beginPath();
      gt.regions.forEach(r => r.points.forEach((p, i) => { const v = V(p[0], p[1]); i ? ctx.lineTo(v[0], v[1]) : ctx.moveTo(v[0], v[1]); }));
      ctx.closePath(); ctx.globalAlpha = 1; ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(0, 229, 255, 0.95)'; ctx.stroke();
    };
    if (mode === 'none') { strokeGT(); return; }
    const ix = indexes[current.id + '/' + mode];
    if (!ix) { strokeGT(); return; }
    const cut = routeCut(ix);
    // LOD: coarse centroid chunks when zoomed out (< 0.05 screen px per image px), fine chunks with contours otherwise.
    const level = scale < 0.05 ? 'coarse' : 'fine', size = ix[level], chunks = ix[level + '_chunks'];
    const x0 = Math.max(0, Math.floor(tl.x / size)), x1 = Math.floor(br.x / size), y0 = Math.max(0, Math.floor(tl.y / size)), y1 = Math.floor(br.y / size);
    const list = [];
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
      if (!chunks[cx + '_' + cy]) continue;
      const ch = getChunk(current, mode, ix, level, cx, cy); if (ch) list.push(ch);
    }
    const total = list.reduce((a, ch) => a + ch.n, 0);
    // Display thinning when zoomed out (at most ~1 drawn dot per 10 screen px^2); counts above stay exact.
    const stride = level === 'coarse' ? Math.max(1, Math.ceil(total / (w * h / 10))) : 1;
    const contours = level === 'fine' && scale >= 0.25;
    const r = level === 'coarse' ? 0.9 : Math.max(1, Math.min(3, 6 * scale));
    ctx.globalAlpha = contours ? 1 : 0.7;
    for (let k = 0; k < 5; k++) {
      ctx.fillStyle = TYPE_COLORS[k]; ctx.strokeStyle = TYPE_COLORS[k]; ctx.lineWidth = 1.5;
      ctx.beginPath();
      list.forEach(ch => {
        for (let i = 0; i < ch.n; i += stride) {
          if (typeOf(ch, i, cut) !== k) continue;
          const v = V(ch.x[i], ch.y[i]);
          if (v[0] < -40 || v[1] < -40 || v[0] > w + 40 || v[1] > h + 40) continue;
          if (contours) {
            const b = i * ch.K * 2;
            for (let j = 0; j < ch.K; j++) { const px = v[0] + ch.poly[b + 2 * j] * scale, py = v[1] + ch.poly[b + 2 * j + 1] * scale; j ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
            ctx.closePath();
          } else { ctx.moveTo(v[0] + r, v[1]); ctx.arc(v[0], v[1], r, 0, 2 * Math.PI); }
        }
      });
      contours ? ctx.stroke() : ctx.fill();
    }
    ctx.globalAlpha = 1;
    strokeGT();
  }
  viewer.addHandler('update-viewport', draw);
  window.addEventListener('resize', draw);

  function setModelMode(m) {
    mode = m;
    modeInputs.forEach(r => { r.checked = r.value === m; });
    if (m !== 'none' && current) loadIndex(current, m).then(() => { updateCount(); draw(); }, () => { info.textContent = m + ' overlay unavailable.'; });
    if (m in MODE_TEXT) setMode(m);
    loadPred(); updateCount(); draw();
  }
  modeInputs.forEach(r => r.addEventListener('change', () => { if (r.checked) setModelMode(r.value); }));
  if (gtBox) gtBox.addEventListener('change', draw);
  if (predBox) predBox.addEventListener('change', () => { loadPred(); draw(); });
  if (rtInput) {
    // The routing budget acts on the Eff view: moving it selects Eff; geometry stays, only classes in routed patches change.
    const onRoute = e => {
      budget = Number(rtInput.value) / 100; rtOut.textContent = rtInput.value + '%';
      if (e && mode !== 'Eff' && current && overlayBase(current, 'Eff')) setModelMode('Eff');
      if (current && overlayBase(current, 'Eff')) loadIndex(current, 'Eff').then(() => { updateCount(); draw(); }, () => {});
      updateCount(); draw();
    };
    rtInput.addEventListener('input', onRoute); onRoute();
  }

  function nearest(x, y, rad) {
    if (mode === 'none' || !current) return null;
    const ix = indexes[current.id + '/' + mode]; if (!ix) return null;
    const cut = routeCut(ix), ch = cache.get(overlayBase(current, mode) + 'fine/' + Math.floor(x / ix.fine) + '_' + Math.floor(y / ix.fine) + '.bin');
    if (!ch || ch instanceof Promise) return null;
    let best = null, bd = rad * rad;
    for (let i = 0; i < ch.n; i++) { const d = (ch.x[i] - x) ** 2 + (ch.y[i] - y) ** 2; if (d < bd) { bd = d; best = i; } }
    return best === null ? null : { t: typeOf(ch, best, cut), routed: !!(ch.t2 && ch.rk[best] < cut) };
  }

  viewer.addHandler('canvas-click', e => {
    const item = viewer.world.getItemAt(0);
    if (!e.quick || !item) return;
    const pd = item.viewerElementToImageCoordinates(e.position), ds = displayScale(item);
    const p = { x: pd.x / ds, y: pd.y / ds };
    const x = Math.round(p.x), y = Math.round(p.y);
    let text = 'x ' + x + ', y ' + y + ' px';
    if (current && current.mpp) text += ' (' + (x * current.mpp / 1000).toFixed(2) + ', ' + (y * current.mpp / 1000).toFixed(2) + ' mm)';
    if (mode === 'none') text += ' · no model layer selected';
    else { const n = nearest(p.x, p.y, 20 / (current.mpp || 0.25)); text += ' · ' + mode + ': ' + (n ? TYPE_NAMES[n.t] + (n.routed ? ' (Cls-routed patch)' : '') : 'no nucleus here (zoom in to inspect)'); }
    info.textContent = text;
  });

  el('layer-raw').addEventListener('change', e => {
    const item = viewer.world.getItemAt(0);
    if (item) item.setOpacity(e.target.checked ? 1 : 0);
  });
  viewer.addHandler('open', () => {
    const item = viewer.world.getItemAt(0);
    if (item) item.setOpacity(el('layer-raw').checked ? 1 : 0);
    draw();
  });
  viewer.addHandler('open-failed', () => {
    if (current !== FALLBACK) { openSlide(FALLBACK); info.textContent = 'Slide tiles could not be loaded; showing a placeholder.'; }
  });

  select.addEventListener('change', () => openSlide(slides[select.selectedIndex]));

  fetch(CONFIG).then(r => r.json()).then(d => {
    slides = d.slides && d.slides.length ? d.slides : [FALLBACK];
  }).catch(() => { slides = [FALLBACK]; }).then(() => {
    slides.forEach(s => select.add(new Option(s.title, s.id)));
    openSlide(slides[0]);
  });
})();
