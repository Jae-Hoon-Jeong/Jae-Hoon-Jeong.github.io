// Project page. Static only: no inference runs in the browser.
(function () {
  'use strict';

  // ---- Mode selector
  const MODE_TEXT = {
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
  setMode('Eff');

  // ---- Slider shell (states will be precomputed offline)
  const range = document.getElementById('slider-input');
  const out = document.getElementById('slider-out');
  function onSlide() { out.textContent = Number(range.value) + '%'; }
  if (range) { range.addEventListener('input', onSlide); onSlide(); }

  // ---- Whole-slide viewer
  const CLASSES = ['Neoplastic', 'Epithelial', 'Inflammatory', 'Connective', 'Dead'];
  const COLORS = ['#e53935', '#fb8c00', '#43a047', '#1e88e5', '#fdd835'];
  const OVERLAY_MODES = ['Eff', 'Cls'];
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
  // Shown only after repeated failures within a short window with no tile loaded in between,
  // or after >= 2 failures when no tile at all has loaded since the slide was opened (small viewports
  // request only a few tiles). A single failed tile never triggers it.
  const FAIL_WINDOW_MS = 8000, FAIL_THRESHOLD = 6, FAIL_THRESHOLD_NONE_LOADED = 2;
  const notice = document.createElement('div');
  notice.className = 'osd-notice'; notice.setAttribute('role', 'status'); notice.hidden = true;
  notice.textContent = 'WSI preview could not be loaded. Please try again later.';
  el('osd').appendChild(notice);
  let failTimes = [], loadedSinceOpen = 0;
  function clearTileFailure() { failTimes = []; notice.hidden = true; }
  viewer.addHandler('tile-load-failed', () => {
    const now = Date.now();
    failTimes = failTimes.filter(t => now - t < FAIL_WINDOW_MS);
    failTimes.push(now);
    if (failTimes.length >= FAIL_THRESHOLD ||
        (loadedSinceOpen === 0 && failTimes.length >= FAIL_THRESHOLD_NONE_LOADED)) notice.hidden = false;
  });
  viewer.addHandler('tile-loaded', () => { loadedSinceOpen++; clearTileFailure(); });

  let slides = [], current = null;
  const overlays = {};          // mode -> parsed overlay JSON (none exist yet)
  const canvas = document.createElement('canvas');
  canvas.className = 'nuclei-layer';
  viewer.canvas.appendChild(canvas);

  function openSlide(slide) {
    current = slide;
    loadedSinceOpen = 0; clearTileFailure();
    OVERLAY_MODES.forEach(m => { delete overlays[m]; setLayerAvailability(m, slide); });
    attribution.textContent = slide.attribution ? 'Image: ' + slide.attribution : '';
    info.textContent = 'Click the slide to inspect a location.';
    viewer.open(slide.dzi);
  }

  // Overlay toggles stay disabled until a slide lists a precomputed overlay URL.
  function setLayerAvailability(mode, slide) {
    const box = el('layer-' + mode);
    const url = slide.overlays && slide.overlays[mode];
    box.checked = false; box.disabled = !url;
    box.parentElement.classList.toggle('off', !url);
    box.parentElement.title = url ? '' : 'Pending model inference';
  }

  async function loadOverlay(mode) {
    const url = current.overlays[mode];
    if (!url || overlays[mode]) return;
    const res = await fetch(url);
    if (!res.ok) throw new Error('overlay ' + res.status);
    const data = await res.json();
    if (data.format !== 'nuclei-overlay/v0' || data.slide_id !== current.id) throw new Error('overlay mismatch');
    overlays[mode] = data;
  }

  function activeModes() { return OVERLAY_MODES.filter(m => el('layer-' + m).checked && overlays[m]); }

  function draw() {
    const w = viewer.canvas.clientWidth, h = viewer.canvas.clientHeight, dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    const modes = activeModes();
    const item = viewer.world.getItemAt(0);
    if (!modes.length || !item) return;
    const toView = (x, y) => item.imageToViewerElementCoordinates(new OpenSeadragon.Point(x, y));
    const scale = toView(1, 0).x - toView(0, 0).x;
    if (scale < 0.05) return;   // too zoomed out to draw individual nuclei
    modes.forEach((m, k) => {
      ctx.lineWidth = k ? 1 : 2;
      overlays[m].nuclei.forEach(n => {
        const p = toView(n.c[0], n.c[1]);
        if (p.x < -20 || p.y < -20 || p.x > w + 20 || p.y > h + 20) return;
        ctx.strokeStyle = COLORS[n.t] || '#fff';
        ctx.beginPath();
        if (n.poly && n.poly.length > 2) {
          n.poly.forEach((q, i) => { const v = toView(q[0], q[1]); i ? ctx.lineTo(v.x, v.y) : ctx.moveTo(v.x, v.y); });
          ctx.closePath();
        } else {
          ctx.arc(p.x, p.y, Math.max(2, 4 * scale), 0, 2 * Math.PI);
        }
        ctx.stroke();
      });
    });
  }
  viewer.addHandler('update-viewport', draw);
  window.addEventListener('resize', draw);

  function nearest(mode, x, y, r) {
    let best = null, bd = r * r;
    overlays[mode].nuclei.forEach(n => {
      const d = (n.c[0] - x) ** 2 + (n.c[1] - y) ** 2;
      if (d < bd) { bd = d; best = n; }
    });
    return best;
  }

  viewer.addHandler('canvas-click', e => {
    const item = viewer.world.getItemAt(0);
    if (!e.quick || !item) return;
    const p = item.viewerElementToImageCoordinates(e.position);
    const x = Math.round(p.x), y = Math.round(p.y);
    let text = 'x ' + x + ', y ' + y + ' px';
    if (current && current.mpp) text += ' (' + (x * current.mpp / 1000).toFixed(2) + ', ' + (y * current.mpp / 1000).toFixed(2) + ' mm)';
    const modes = activeModes();
    if (!modes.length) text += ' · no nucleus overlay loaded (pending model inference)';
    modes.forEach(m => {
      const n = nearest(m, p.x, p.y, 20 / (current.mpp || 1));
      text += ' · ' + m + ': ' + (n ? CLASSES[n.t] + (n.p != null ? ' (' + n.p.toFixed(2) + ')' : '') : 'no nucleus here');
    });
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
  OVERLAY_MODES.forEach(m => el('layer-' + m).addEventListener('change', async e => {
    if (e.target.checked) {
      try { await loadOverlay(m); } catch (err) { e.target.checked = false; info.textContent = m + ' overlay unavailable.'; }
    }
    draw();
  }));

  select.addEventListener('change', () => openSlide(slides[select.selectedIndex]));

  fetch('data/slides.json').then(r => r.json()).then(d => {
    slides = d.slides && d.slides.length ? d.slides : [FALLBACK];
  }).catch(() => { slides = [FALLBACK]; }).then(() => {
    slides.forEach(s => select.add(new Option(s.title, s.id)));
    openSlide(slides[0]);
  });
})();
