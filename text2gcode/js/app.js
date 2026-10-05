/**
 * app.js — UI wiring for Text2GCode.
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // ------------------------------------------------------------------
  // Font registry
  // ------------------------------------------------------------------
  // TTF fonts load LAZILY — only fetched/parsed when first selected, then
  // cached. Roboto is embedded (base64) so the default experience works
  // instantly, even offline via file://.
  const BUILTIN_TTF = [
    { id: 'roboto', name: 'Roboto (sans-serif)', file: 'fonts/Roboto-Regular.ttf' },
    { id: 'montserrat', name: 'Montserrat (sans-serif)', file: 'fonts/Montserrat-Regular.ttf' },
    { id: 'oswald', name: 'Oswald (condensed)', file: 'fonts/Oswald-Regular.ttf' },
    { id: 'bebasneue', name: 'Bebas Neue (display)', file: 'fonts/BebasNeue-Regular.ttf' },
    { id: 'anton', name: 'Anton (display)', file: 'fonts/Anton-Regular.ttf' },
    { id: 'orbitron', name: 'Orbitron (techno)', file: 'fonts/Orbitron-Regular.ttf' },
    { id: 'orbitron-black', name: 'Orbitron Black (techno)', file: 'fonts/Orbitron-Black.ttf' },
    { id: 'righteous', name: 'Righteous (display)', file: 'fonts/Righteous-Regular.ttf' },
    { id: 'lora', name: 'Lora (serif)', file: 'fonts/Lora-Regular.ttf' },
    { id: 'playfair', name: 'Playfair Display (serif)', file: 'fonts/PlayfairDisplay-Regular.ttf' },
    { id: 'merriweather', name: 'Merriweather (serif)', file: 'fonts/Merriweather-Regular.ttf' },
    { id: 'courierprime', name: 'Courier Prime (mono)', file: 'fonts/CourierPrime-Regular.ttf' },
    { id: 'pacifico', name: 'Pacifico (script)', file: 'fonts/Pacifico-Regular.ttf' },
    { id: 'dancingscript', name: 'Dancing Script (script)', file: 'fonts/DancingScript-Regular.ttf' },
    { id: 'caveat', name: 'Caveat (handwriting)', file: 'fonts/Caveat-Regular.ttf' },
    { id: 'lobster', name: 'Lobster (script)', file: 'fonts/Lobster-Regular.ttf' },
  ];

  const fonts = new Map(); // id -> {kind:'ttf'|'hershey', font?, data?, label, loaded, loading?}
  let selectedFontId = null;
  let customFontCount = 0;

  // ------------------------------------------------------------------
  // Element refs
  // ------------------------------------------------------------------
  const els = {
    text: $('text'),
    height: $('height'),
    lineSpacing: $('lineSpacing'),
    letterSpacing: $('letterSpacing'),
    align: $('align'),
    font: $('font'),
    fontFile: $('fontFile'),
    fontHint: $('fontHint'),
    modeHint: $('modeHint'),
    toolDiameter: $('toolDiameter'),
    toolType: $('toolType'),
    pocketOptions: $('pocketOptions'),
    stepover: $('stepover'),
    contourPass: $('contourPass'),
    safeZ: $('safeZ'),
    cutDepth: $('cutDepth'),
    passDepth: $('passDepth'),
    spindleRPM: $('spindleRPM'),
    feedXY: $('feedXY'),
    feedPlunge: $('feedPlunge'),
    rapidFeed: $('rapidFeed'),
    returnHome: $('returnHome'),
    preview: $('preview'),
    previewEmpty: $('previewEmpty'),
    simStatus: $('simStatus'),
    simSpeed: $('simSpeed'),
    btnSim: $('btnSim'),
    btnSimReset: $('btnSimReset'),
    btnDownload: $('btnDownload'),
    btnCopy: $('btnCopy'),
    btnToggleGcode: $('btnToggleGcode'),
    gcodePanel: $('gcodePanel'),
    gcodePreview: $('gcodePreview'),
    stats: $('stats'),
    topStats: $('topStats'),
  };

  const MODE_HINTS = {
    single: 'Engraves fast single-stroke strokes along the middle of every letter — ideal for V-bits and engraving cutters.',
    boss: 'Leaves the letters as a raised boss: traces around the UNION of all letters, offset outward by the tool radius. Overlapping letters merge into one boundary — no cut lines between them.',
    pocket: 'Carves concentric rings that follow the letter shapes: the first pass hugs the boundary (tool edge exactly on it, offset by the tool radius), then rings step inward by the stepover until the pocket is cleared.',
  };

  // ------------------------------------------------------------------
  // State
  // ------------------------------------------------------------------
  let lastResult = null;    // { moves, passes, stats, gcode, gcodeLineMap, settings, meta }
  let currentMode = 'pocket'; // pocket unless the active font is a single-stroke line font
  let sim = { active: false, playing: false, moveIdx: 0, tInto: 0, elapsed: 0, done: false };
  let gcodeHighlight = null; // { line, move, pt } — gcode line clicked in preview

  // ------------------------------------------------------------------
  // Font loading
  // ------------------------------------------------------------------
  function initFontSelect() {
    const sel = els.font;
    sel.innerHTML = '';

    const g1 = document.createElement('optgroup');
    g1.label = 'Outline fonts (TTF) — ready';
    sel.appendChild(g1);

    const g2 = document.createElement('optgroup');
    g2.label = 'Outline fonts — load on first use';
    sel.appendChild(g2);

    const g3 = document.createElement('optgroup');
    g3.label = 'Single-stroke engraving fonts';
    sel.appendChild(g3);

    for (const [id, f] of fonts) {
      const opt = document.createElement('option');
      opt.value = id;
      let txt = f.label;
      if (f.loaded === false) txt += f.loading ? ' — loading…' : ' — click to load';
      opt.textContent = txt;
      const group = f.kind === 'ttf' ? (f.loaded ? g1 : g2) : g3;
      group.appendChild(opt);
    }
    if (selectedFontId) sel.value = selectedFontId;
  }

  async function loadTtfFont(id, label, source) {
    // source: {b64:'data:font...'} | url string | File
    try {
      let buf;
      if (source && (source.b64 || source.data)) {
        buf = base64ToArrayBuffer(source.b64 || source.data);
      } else if (typeof source === 'string') {
        const res = await fetch(source);
        if (!res.ok) throw new Error('fetch failed');
        buf = await res.arrayBuffer();
      } else {
        buf = await source.arrayBuffer();
      }
      const ot = opentype.parse(buf);
      fonts.set(id, { kind: 'ttf', font: ot, label, loaded: true });
      return true;
    } catch (e) {
      console.error('Font load failed:', id, e);
      fonts.delete(id);
      return false;
    }
  }

  function base64ToArrayBuffer(dataUrl) {
    const b64 = dataUrl.split(',')[1];
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  async function initFonts() {
    try {
      await initFontsInner();
    } catch (e) {
      if (window.__t2g_report) window.__t2g_report('initFonts()', e); else throw e;
    }
  }

  async function initFontsInner() {
    // Hershey single-stroke fonts are embedded
    for (const [key, data] of Object.entries(window.HERSHEY_FONTS)) {
      fonts.set('hershey:' + key, { kind: 'hershey', data, label: data.name + ' (single-stroke)', loaded: true });
    }
    // TTF fonts: lazy. Only the embedded default (Roboto) is parsed at boot.
    for (const f of BUILTIN_TTF) {
      const emb = window.EMBEDDED_TTF && window.EMBEDDED_TTF[f.id];
      fonts.set('ttf:' + f.id, { kind: 'ttf', label: f.name, loaded: false, emb, file: f.file });
    }
    selectedFontId = 'ttf:roboto';
    initFontSelect();

    // decode the embedded default font (no network needed)
    const ok = await loadTtfFont('ttf:roboto', 'Roboto (sans-serif)', fonts.get('ttf:roboto').emb);
    if (!ok) {
      fonts.delete('ttf:roboto');
      selectedFontId = 'hershey:futural';
    }
    initFontSelect();
    els.previewEmpty.textContent = 'Enter some text to preview the toolpath ✦';
    regenerate();
  }

  /** Load a TTF on first use; cached afterwards. */
  async function ensureFontLoaded(id) {
    const f = fonts.get(id);
    if (!f || f.loaded) return f.loaded !== false;
    f.loading = true;
    initFontSelect();
    els.previewEmpty.textContent = 'Loading font… ✦';
    els.previewEmpty.style.display = 'grid';
    const ok = await loadTtfFont(id, f.label, f.emb ? f.emb : f.file);
    f.loading = false;
    if (!ok && selectedFontId === id) {
      alert('Could not load "' + f.label + '". If you opened this page as a local file (file://), browsers block font downloads — serve the folder over http (e.g. python3 -m http.server) or upload the font file manually.');
      selectedFontId = 'ttf:roboto';
    }
    initFontSelect();
    return ok;
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------
  const num = (el, fallback) => {
    const v = parseFloat(el.value);
    return isFinite(v) ? v : fallback;
  };

  function selectedFont() {
    return fonts.get(selectedFontId) || fonts.get('hershey:futural');
  }

  function fmtLen(mm) {
    if (mm >= 1000) return (mm / 1000).toFixed(2) + ' m';
    return mm.toFixed(0) + ' mm';
  }

  function fmtTime(min) {
    if (!isFinite(min)) return '—';
    if (min < 1) return Math.round(min * 60) + ' s';
    if (min < 90) return min.toFixed(1) + ' min';
    return (min / 60).toFixed(1) + ' h';
  }

  function setSliderFill(el) {
    const min = parseFloat(el.min), max = parseFloat(el.max);
    const pct = ((parseFloat(el.value) - min) / (max - min)) * 100;
    el.style.setProperty('--fill', pct + '%');
  }

  // ------------------------------------------------------------------
  // Core: regenerate toolpath + gcode
  // ------------------------------------------------------------------
  function collectTool() {
    return {
      diameter: num(els.toolDiameter, 3),
      stepoverPct: num(els.stepover, 45),
      contourPass: els.contourPass.checked,
    };
  }

  function collectSettings() {
    return {
      safeZ: Math.max(0.5, num(els.safeZ, 5)),
      cutDepth: Math.max(0.05, num(els.cutDepth, 1)),
      passDepth: Math.max(0.05, num(els.passDepth, 0.5)),
      feedXY: Math.max(10, num(els.feedXY, 800)),
      feedPlunge: Math.max(5, num(els.feedPlunge, 200)),
      spindleRPM: Math.max(0, num(els.spindleRPM, 12000)),
      rapidFeed: Math.max(10, num(els.rapidFeed, 3200)),
      returnHome: els.returnHome.checked,
    };
  }

  function regenerate() {
    try {
      regenerateInner();
    } catch (e) {
      if (window.__t2g_report) window.__t2g_report('regenerate()', e); else throw e;
    }
  }

  function regenerateInner() {
    const text = els.text.value;
    const font = selectedFont();
    resetSim();

    if (!text.trim() || !font || font.loaded === false) {
      lastResult = null;
      render();
      return;
    }

    // Hershey (line) fonts can only do single-line; outline fonts pocket/boss
    if (font.kind === 'hershey' && currentMode !== 'single') setMode('single', true);
    if (font.kind === 'ttf' && currentMode === 'single') setMode('pocket', true);

    const opts = {
      size: num(els.height, 30),
      lineHeightMult: num(els.lineSpacing, 1),
      letterSpacingMM: num(els.letterSpacing, 0),
      align: els.align.value,
    };

    let contours;
    if (font.kind === 'ttf') {
      contours = Toolpath.buildOpenTypeContours(font.font, text, opts);
      // boss/pocket consider all letters together: union overlapping glyphs so
      // shared boundaries are not cut and fills don't cancel over overlaps
      if (currentMode === 'boss' || currentMode === 'pocket') {
        contours = Toolpath.unionContours(contours, { tol: 0.04 });
      }
    } else {
      contours = Toolpath.buildHersheyContours(font.data, text, opts);
    }
    contours = Toolpath.normalize(contours, opts.align);

    const tool = collectTool();
    const cutPaths = Toolpath.buildCutPaths(contours, currentMode, tool);

    const settings = collectSettings();
    const built = GCodeGen.buildMoves(cutPaths, settings);
    const meta = {
      text,
      font: font.label,
      mode: currentMode,
      toolDiameter: tool.diameter,
      toolType: els.toolType.value,
    };
    const gen = GCodeGen.generate({ moves: built.moves, passes: built.passes, stats: built.stats, settings, meta });

    lastResult = { moves: built.moves, passes: built.passes, stats: built.stats, gcode: gen.text, gcodeLineMap: gen.lineMap, settings, meta, tool };
    gcodeHighlight = null;
    render();
  }

  // ------------------------------------------------------------------
  // Preview rendering
  // ------------------------------------------------------------------
  const canvas = els.preview;
  const ctx = canvas.getContext('2d');

  let view = { scale: 1, ox: 0, oy: 0 }; // mm -> px transform (y flipped)

  function computeView() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h || !lastResult || !lastResult.stats.bounds) {
      view = { scale: 0, ox: 0, oy: 0 };
      return;
    }
    const b = lastResult.stats.bounds;
    const pad = 30;
    const scaleX = (w - pad * 2) / Math.max(1e-6, b.width + lastResult.tool.diameter);
    const scaleY = (h - pad * 2) / Math.max(1e-6, b.height + lastResult.tool.diameter);
    let scale = Math.min(scaleX, scaleY, 30);
    if (!isFinite(scale) || scale <= 0) { view = { scale: 0, ox: 0, oy: 0 }; return; }
    const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
    view = { scale, ox: w / 2 - cx * scale, oy: h / 2 + cy * scale };
  }

  const toX = (x) => x * view.scale + view.ox;
  const toY = (y) => -y * view.scale + view.oy;

  function drawGrid(w, h) {
    const mm = view.scale;
    if (!mm || mm <= 0 || !isFinite(mm) || !w || !h) return;
    let step = 10;
    if (mm < 1.2) step = 100;
    else if (mm < 4) step = 50;
    else if (mm < 12) step = 10;
    const sub = step / 5;
    ctx.lineWidth = 1;
    // minor
    ctx.strokeStyle = 'rgba(139,92,246,.05)';
    ctx.beginPath();
    for (let x = Math.floor(-view.ox / mm / sub) * sub, guard = 0; guard++ < 4000; x += sub) {
      const px = toX(x);
      if (px > w) break;
      if (px >= 0) { ctx.moveTo(px, 0); ctx.lineTo(px, h); }
    }
    for (let y = Math.floor(view.oy / mm / sub) * sub, guard = 0; guard++ < 4000; y += sub) {
      const py = toY(y);
      if (py > h) break;
      if (py >= 0) { ctx.moveTo(0, py); ctx.lineTo(w, py); }
    }
    ctx.stroke();
    // major + labels
    ctx.strokeStyle = 'rgba(139,92,246,.12)';
    ctx.fillStyle = 'rgba(169,156,201,.55)';
    ctx.font = '10px sans-serif';
    ctx.beginPath();
    for (let x = Math.floor(-view.ox / mm / step) * step, guard = 0; guard++ < 4000; x += step) {
      const px = toX(x);
      if (px > w) break;
      if (px >= 0) {
        ctx.moveTo(px, 0); ctx.lineTo(px, h);
        if (x !== 0) ctx.fillText(x + '', px + 3, h - 5);
      }
    }
    for (let y = Math.floor(view.oy / mm / step) * step, guard = 0; guard++ < 4000; y += step) {
      const py = toY(y);
      if (py > h) break;
      if (py >= 0) {
        ctx.moveTo(0, py); ctx.lineTo(w, py);
        if (y !== 0) ctx.fillText(y + '', 4, py - 3);
      }
    }
    ctx.stroke();
    // origin marker
    ctx.strokeStyle = 'rgba(240,171,252,.8)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(toX(0) - 7, toY(0)); ctx.lineTo(toX(0) + 7, toY(0));
    ctx.moveTo(toX(0), toY(0) - 7); ctx.lineTo(toX(0), toY(0) + 7);
    ctx.stroke();
  }

  function strokePolyline(pts, partialLen) {
    // partialLen: if set, only draw this many mm from the start
    ctx.beginPath();
    ctx.moveTo(toX(pts[0][0]), toY(pts[0][1]));
    let drawn = 0;
    let stopped = false;
    for (let i = 1; i < pts.length; i++) {
      const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (partialLen != null && drawn + seg >= partialLen) {
        const t = (partialLen - drawn) / seg;
        const x = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t;
        const y = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t;
        ctx.lineTo(toX(x), toY(y));
        stopped = true;
        break;
      }
      ctx.lineTo(toX(pts[i][0]), toY(pts[i][1]));
      drawn += seg;
    }
    ctx.stroke();
    return stopped ? null : true;
  }

  function drawMovePath(mv, partialLen) {
    const widthMM = lastResult ? lastResult.tool.diameter : 2;
    if (mv.type === 'cut') {
      // swath (material removed look)
      ctx.strokeStyle = 'rgba(183,148,246,.30)';
      ctx.lineWidth = Math.max(1, widthMM * view.scale);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      strokePolyline(mv.pts, partialLen);
      // centerline
      ctx.strokeStyle = '#b794f6';
      ctx.lineWidth = 1.2;
      strokePolyline(mv.pts, partialLen);
    } else if (mv.type === 'rapid') {
      ctx.strokeStyle = 'rgba(230,222,250,.28)';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      strokePolyline(mv.pts, partialLen);
      ctx.setLineDash([]);
    } else if (mv.type === 'plunge') {
      ctx.fillStyle = 'rgba(240,171,252,.9)';
      ctx.beginPath();
      ctx.arc(toX(mv.pts[0][0]), toY(mv.pts[0][1]), 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    // 'retract' moves are Z-only lifts — nothing to draw in XY
  }

  function renderPreview() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return; // not laid out yet — skip drawing entirely
    updateHighlightStatus();
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== w * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    computeView();
    drawGrid(w, h);

    if (!lastResult || !lastResult.moves.length) {
      els.previewEmpty.style.display = 'grid';
      return;
    }
    els.previewEmpty.style.display = 'none';

    if (sim.active) {
      drawSimulation();
    } else if (gcodeHighlight) {
      drawHighlight();
    } else {
      for (const mv of lastResult.moves) drawMovePath(mv, null);
    }
  }

  /** Draw the toolpath created by the gcode line clicked in the preview. */
  function drawHighlight() {
    const moves = lastResult.moves;
    // everything else faint
    ctx.globalAlpha = 0.12;
    for (let i = 0; i < moves.length; i++) drawMovePath(moves[i], null);
    ctx.globalAlpha = 1;

    const mv = moves[gcodeHighlight.move];
    if (!mv) return;

    if (mv.type === 'cut') {
      // containing toolpath in bright highlight
      ctx.strokeStyle = '#f0abfc';
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      strokePolyline(mv.pts, null);
    } else if (mv.type === 'rapid') {
      ctx.strokeStyle = 'rgba(240,171,252,.9)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 5]);
      strokePolyline(mv.pts, null);
      ctx.setLineDash([]);
    }

    // the exact segment this line cuts (from previous point to this point)
    if (mv.type === 'cut' && gcodeHighlight.pt > 0) {
      const a = mv.pts[gcodeHighlight.pt - 1];
      const b = mv.pts[gcodeHighlight.pt];
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(toX(a[0]), toY(a[1]));
      ctx.lineTo(toX(b[0]), toY(b[1]));
      ctx.stroke();
    }

    // tool position marker
    const pos = mv.type === 'cut' ? mv.pts[gcodeHighlight.pt] : mv.pts[0];
    if (pos) {
      const rmm = lastResult.tool.diameter / 2;
      ctx.strokeStyle = '#f0abfc';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(toX(pos[0]), toY(pos[1]), Math.max(3, rmm * view.scale), 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(toX(pos[0]), toY(pos[1]), 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function updateHighlightStatus() {
    if (gcodeHighlight && lastResult && !sim.active) {
      const mv = lastResult.moves[gcodeHighlight.move];
      if (mv) {
        els.simStatus.textContent = 'Line ' + (gcodeHighlight.line + 1) + ' — ' +
          (mv.type === 'rapid' ? 'rapid move' : mv.type === 'plunge' ? 'plunge' : mv.type === 'retract' ? 'retract (rapid)' : 'cut') +
          ' · Z ' + mv.z.toFixed(3) + 'mm · pass ' + ((mv.pass || 0) + 1) + '/' + lastResult.passes;
        els.simStatus.classList.remove('hidden');
        return;
      }
    }
    if (!sim.active) els.simStatus.classList.add('hidden');
  }

  // ------------------------------------------------------------------
  // Simulation ("demo the path taken")
  // ------------------------------------------------------------------
  function resetSim() {
    // canonical sim state — startSim() builds on this, so the shape only
    // exists here (a missing field here was the source of a NaN display bug)
    sim = { active: false, playing: false, moveIdx: 0, tInto: 0, elapsed: 0, done: false };
    els.simStatus.classList.add('hidden');
    els.btnSim.textContent = '▶ Simulate';
  }

  function startSim() {
    if (!lastResult || !lastResult.moves.length) return;
    resetSim();
    sim.active = true;
    sim.playing = true;
    els.btnSim.textContent = '⏸ Pause';
    els.simStatus.classList.remove('hidden');
    sim.lastT = performance.now();
    requestAnimationFrame(simFrame);
  }

  function simFrame(now) {
    try {
      simFrameInner(now);
    } catch (e) {
      if (window.__t2g_report) { window.__t2g_report('simulation', e); sim.active = false; } else throw e;
    }
  }

  function simFrameInner(now) {
    if (!sim.active) return;
    const dt = Math.min(0.1, (now - (sim.lastT || now)) / 1000);
    sim.lastT = now;

    if (sim.playing && !sim.done) {
      // advance in REAL seconds × multiplier; each move consumes exactly its
      // machine time m.t (seconds, from the same model as the time estimate)
      // so ×1 simulation stays in lockstep with the estimated job time
      const speedMult = num(els.simSpeed, 1);
      let budget = speedMult * dt;
      while (budget > 0) {
        const m = lastResult.moves[sim.moveIdx];
        if (!m) { sim.done = true; sim.playing = false; els.btnSim.textContent = '▶ Simulate'; break; }
        const remaining = (m.t || 0) - sim.tInto;
        if (budget >= remaining) {
          budget -= remaining;
          sim.elapsed += remaining;
          sim.tInto = 0;
          sim.moveIdx++;
        } else {
          sim.tInto += budget;
          sim.elapsed += budget;
          budget = 0;
        }
      }
    }

    renderPreview();

    const total = lastResult.moves.length;
    const mv = lastResult.moves[sim.moveIdx]; // refreshed after advancing
    const elapsed = lastResult.stats ? lastResult.stats.machTimeSec : 0;
    const label = mv ? (mv.type === 'rapid' ? 'rapid' : mv.type === 'plunge' ? 'plunge' : mv.type === 'retract' ? 'retract' : 'cut') : '';
    els.simStatus.textContent = sim.done
      ? '✓ Simulation complete'
      : `Simulating — move ${Math.min(sim.moveIdx + 1, total)}/${total}` +
        ` · ${fmtTime(sim.elapsed / 60)} / ${fmtTime(elapsed / 60)}` +
        (mv ? ` · ${label} Z=${mv.z.toFixed(1)}mm · pass ${(mv.pass || 0) + 1}/${lastResult.passes}` : '');

    if (sim.active && !sim.done) requestAnimationFrame(simFrame);
    else if (sim.active && sim.done) {
      // keep final frame, wait for user
    }
  }

  function drawSimulation() {
    // draw all moves before current fully, current partially, rest faint
    const moves = lastResult.moves;
    for (let i = 0; i < sim.moveIdx && i < moves.length; i++) {
      drawMovePath(moves[i], null);
    }
    const mv = moves[sim.moveIdx];
    if (mv && !sim.done) {
      // remaining plan, faint
      ctx.globalAlpha = 0.15;
      for (let i = sim.moveIdx; i < moves.length; i++) drawMovePath(moves[i], null);
      ctx.globalAlpha = 1;
      // current partial: progress fraction from consumed time
      const frac = mv.t > 0 ? sim.tInto / mv.t : 0;
      const partial = (mv.len || 0) * frac;
      if (mv.type === 'cut' || mv.type === 'rapid') drawMovePath(mv, partial);
      // tool head
      const pos = headPosition(mv, partial);
      if (pos) {
        const rmm = lastResult.tool.diameter / 2;
        ctx.strokeStyle = 'rgba(240,171,252,.65)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(toX(pos[0]), toY(pos[1]), Math.max(3, rmm * view.scale), 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#f0abfc';
        ctx.beginPath();
        ctx.arc(toX(pos[0]), toY(pos[1]), 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function headPosition(mv, dist) {
    if (!mv) return null;
    if (mv.type === 'plunge' || mv.type === 'retract' || mv.pts.length < 2) return mv.pts[0];
    let drawn = 0;
    for (let i = 1; i < mv.pts.length; i++) {
      const seg = Math.hypot(mv.pts[i][0] - mv.pts[i - 1][0], mv.pts[i][1] - mv.pts[i - 1][1]);
      if (drawn + seg >= dist) {
        const t = (dist - drawn) / (seg || 1);
        return [
          mv.pts[i - 1][0] + (mv.pts[i][0] - mv.pts[i - 1][0]) * t,
          mv.pts[i - 1][1] + (mv.pts[i][1] - mv.pts[i - 1][1]) * t,
        ];
      }
      drawn += seg;
    }
    return mv.pts[mv.pts.length - 1];
  }

  // ------------------------------------------------------------------
  // UI render (stats, gcode preview, buttons)
  // ------------------------------------------------------------------
  function render() {
    renderPreview();

    const has = lastResult && lastResult.stats.bounds;
    els.btnDownload.disabled = !has;
    els.btnCopy.disabled = !has;

    if (has) {
      const st = lastResult.stats;
      els.stats.innerHTML = `
        <div class="stat">Size <b>${st.bounds.width.toFixed(1)} × ${st.bounds.height.toFixed(1)} mm</b></div>
        <div class="stat">Toolpaths <b>${st.paths}</b></div>
        <div class="stat">Depth passes <b>${st.passes}</b></div>
        <div class="stat">Cut length <b>${fmtLen(st.cutLengthTotal)}</b></div>
        <div class="stat">Est. time <b>≈ ${fmtTime(st.estTimeMin)}</b></div>
      `;
      els.topStats.innerHTML = `
        <span class="stat-chip">${lastResult.meta.font}</span>
        <span class="stat-chip">Mode: <b>${lastResult.meta.mode}</b></span>
        <span class="stat-chip">Tool: <b>${lastResult.tool.diameter}mm</b></span>
        <span class="stat-chip">GCode lines: <b>${lastResult.gcode.split('\n').length}</b></span>
      `;
      updateGcodePreview();
    } else {
      els.stats.innerHTML = '';
      els.topStats.innerHTML = '';
      els.gcodePreview.textContent = '';
    }
  }

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function updateGcodePreview() {
    if (!lastResult) { els.gcodePreview.innerHTML = ''; return; }
    const lines = lastResult.gcode.split('\n');
    const map = lastResult.gcodeLineMap || [];
    const shown = Math.min(lines.length, 400);
    let html = '';
    for (let i = 0; i < shown; i++) {
      const clickable = !!map[i];
      html += '<div class="gline' + (clickable ? ' gline-move' : '') +
        (gcodeHighlight && gcodeHighlight.line === i ? ' selected' : '') +
        '" data-line="' + i + '">' + escapeHtml(lines[i]) + '</div>';
    }
    if (lines.length > shown) {
      html += '<div class="gline">… (' + (lines.length - shown) + ' more lines)</div>';
    }
    els.gcodePreview.innerHTML = html;
    // keep the selected line visible
    const sel = els.gcodePreview.querySelector('.gline.selected');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }

  // ------------------------------------------------------------------
  // Mode & font UI sync
  // ------------------------------------------------------------------
  function setMode(mode, silent) {
    currentMode = mode;
    document.querySelectorAll('.mode-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
    els.pocketOptions.classList.toggle('hidden', mode !== 'pocket');
    if (!silent) els.modeHint.textContent = MODE_HINTS[mode];
  }

  function syncModeAvailability() {
    const font = selectedFont();
    const ttf = font && font.kind === 'ttf';
    // guard: never hard-crash the app over a missing mode button
    [['single', ttf], ['boss', !ttf], ['pocket', !ttf]].forEach(([m, dis]) => {
      const btn = document.querySelector('[data-mode="' + m + '"]');
      if (btn) btn.disabled = dis;
    });
    if (ttf) {
      els.fontHint.innerHTML = 'Outline (TTF) font — supports <b>boss</b> &amp; <b>pocket</b> modes. Load any .ttf/.otf you own.';
    } else {
      els.fontHint.innerHTML = 'Single-stroke engraving font (Hershey) — one pass per stroke, no fill needed. Fastest option for V-bits.';
    }
  }

  // ------------------------------------------------------------------
  // Events
  // ------------------------------------------------------------------
  let regenTimer = null;
  function scheduleRegen() {
    clearTimeout(regenTimer);
    regenTimer = setTimeout(regenerate, 120);
  }

  els.text.addEventListener('input', scheduleRegen);
  [els.height, els.lineSpacing, els.letterSpacing, els.toolDiameter, els.stepover].forEach((el) => {
    el.addEventListener('input', () => { setSliderFill(el); scheduleRegen(); });
  });
  [els.align, els.toolType, els.contourPass, els.returnHome,
   els.safeZ, els.cutDepth, els.passDepth, els.spindleRPM, els.feedXY, els.feedPlunge, els.rapidFeed].forEach((el) => {
    el.addEventListener('change', scheduleRegen);
  });

  // update value labels live (sliders + number inputs)
  const labelBind = [
    [els.height, 'heightVal', (v) => v + ' mm'],
    [els.lineSpacing, 'lineSpacingVal', (v) => parseFloat(v).toFixed(2) + '×'],
    [els.letterSpacing, 'letterSpacingVal', (v) => parseFloat(v).toFixed(1) + ' mm'],
    [els.toolDiameter, 'toolDiameterVal', (v) => parseFloat(v).toFixed(1) + ' mm'],
    [els.stepover, 'stepoverVal', (v) => v + '%'],
    [els.safeZ, 'safeZVal', (v) => v + ' mm'],
    [els.cutDepth, 'cutDepthVal', (v) => v + ' mm'],
    [els.passDepth, 'passDepthVal', (v) => v + ' mm'],
    [els.feedXY, 'feedXYVal', (v) => v],
    [els.feedPlunge, 'feedPlungeVal', (v) => v],
    [els.rapidFeed, 'rapidFeedVal', (v) => v],
    [els.simSpeed, 'simSpeedVal', (v) => {
      const x = parseFloat(v);
      return Math.abs(x - 1) < 1e-9 ? '×1.0 · real time' : '×' + x.toFixed(2).replace(/\.?0+$/, '');
    }],
  ];
  labelBind.forEach(([el, id, f]) => {
    const update = () => { $(id).textContent = f(el.value); if (el.type === 'range') setSliderFill(el); };
    el.addEventListener('input', update);
    update();
  });

  els.font.addEventListener('change', async () => {
    const newId = els.font.value;
    if (!newId) return;
    const prevId = selectedFontId;
    selectedFontId = newId;
    syncModeAvailability();
    const f = fonts.get(newId);
    if (f && f.loaded === false) {
      const ok = await ensureFontLoaded(newId);
      if (!ok) { selectedFontId = prevId; initFontSelect(); }
      // fix mode if now invalid
      const font = selectedFont();
      if (font.kind === 'hershey' && currentMode !== 'single') setMode('single');
      if (font.kind === 'ttf' && currentMode === 'single') setMode('pocket');
    }
    scheduleRegen();
  });

  els.fontFile.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    customFontCount++;
    const id = 'ttf:custom' + customFontCount;
    const label = file.name.replace(/\.(ttf|otf|woff)$/i, '') + ' (custom)';
    const ok = await loadTtfFont(id, label, file);
    if (ok) {
      selectedFontId = id;
      initFontSelect();
      syncModeAvailability();
      if (currentMode === 'single') setMode('pocket');
      regenerate();
    } else {
      alert('Could not parse that font file. Please use a .ttf or .otf file.');
    }
    e.target.value = '';
  });

  document.querySelectorAll('.mode-btn').forEach((b) => {
    b.addEventListener('click', () => {
      if (b.disabled) return;
      setMode(b.dataset.mode);
      scheduleRegen();
    });
  });

  els.btnSim.addEventListener('click', () => {
    if (!lastResult) return;
    if (!sim.active) { startSim(); return; }
    if (sim.done) { startSim(); return; }
    sim.playing = !sim.playing;
    els.btnSim.textContent = sim.playing ? '⏸ Pause' : '▶ Resume';
    if (sim.playing) { sim.lastT = performance.now(); requestAnimationFrame(simFrame); }
  });

  els.btnSimReset.addEventListener('click', () => {
    resetSim();
    renderPreview();
  });

  // detent: snapping to 1× (real time) when the slider is released near it
  els.simSpeed.addEventListener('change', () => {
    const v = parseFloat(els.simSpeed.value);
    if (isFinite(v) && Math.abs(v - 1) <= 0.075) {
      els.simSpeed.value = '1';
      els.simSpeed.dispatchEvent(new Event('input', { bubbles: false }));
    }
  });

  els.btnDownload.addEventListener('click', () => {
    if (!lastResult) return;
    const slug = (lastResult.meta.text.split('\n')[0] || 'text')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'text';
    const blob = new Blob([lastResult.gcode], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = slug + '.nc';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  els.btnCopy.addEventListener('click', async () => {
    if (!lastResult) return;
    try {
      await navigator.clipboard.writeText(lastResult.gcode);
      els.btnCopy.textContent = '✓ Copied';
      setTimeout(() => { els.btnCopy.textContent = '⧉ Copy'; }, 1500);
    } catch (e) {
      alert('Copy failed — use Download instead.');
    }
  });

  els.btnToggleGcode.addEventListener('click', () => {
    els.gcodePanel.classList.toggle('hidden');
  });

  // Click a gcode line → show the toolpath it creates in the preview
  els.gcodePreview.addEventListener('click', (e) => {
    const div = e.target.closest('.gline');
    if (!div || !lastResult || !lastResult.gcodeLineMap) return;
    const idx = parseInt(div.dataset.line, 10);
    if (!isFinite(idx)) return;
    const ref = lastResult.gcodeLineMap[idx];
    if (gcodeHighlight && gcodeHighlight.line === idx) {
      // clicked again → deselect
      gcodeHighlight = null;
      updateGcodePreview();
      renderPreview();
      return;
    }
    if (!ref) { gcodeHighlight = null; updateGcodePreview(); renderPreview(); return; }
    if (sim.active) resetSim();
    gcodeHighlight = { line: idx, move: ref.move, pt: ref.pt };
    updateGcodePreview();
    renderPreview();
    // scroll preview... nothing to do — the highlight is drawn in view
  });

  window.addEventListener('resize', () => {
    canvas.width = 0; // force re-scale on next render
    renderPreview();
  });

  // ------------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------------
  // surface any unexpected error visibly instead of a silent blank preview
  window.addEventListener('error', (e) => {
    console.error('Text2GCode error:', e.error || e.message);
  });

  try {
    console.log('Text2GCode ready — build 2026-10-05.3 (boss/pocket, lazy fonts)');
  } catch (e) { /* noop */ }

  els.previewEmpty.textContent = 'Loading fonts… ✦';
  setMode('pocket'); // default font (Roboto) is an outline font, not a line font
  syncModeAvailability();
  initFonts();
  // first paint (fonts may still be loading)
  render();
})();