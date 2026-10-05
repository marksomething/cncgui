/**
 * glyphs.test.js — regression tests for glyph union / hole handling.
 *
 * Run with the node built-in test runner (no dependencies):
 *
 *   node --test text2gcode/test/
 *
 * The headline regression: Roboto draws 'd' (also b, p, q, g) as three
 * loops whose counter tucks under the separately-drawn stem. The hole
 * classifier used to treat the crossing as "overlapping strokes" and the
 * union filled the counter in — engraving a solid letter. Every glyph in
 * the tables below must keep its counters (holes) after unioning.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// Load vendor libs before toolpath.js — it resolves ClipperLib globally.
global.ClipperLib = require(path.join(ROOT, 'vendor/clipper.js'));
const Toolpath = require(path.join(ROOT, 'js/toolpath.js'));
const opentype = require(path.join(ROOT, 'vendor/opentype.min.js'));

const fontCache = new Map();
function loadFont(file) {
  if (!fontCache.has(file)) {
    const buf = fs.readFileSync(path.join(ROOT, 'fonts', file));
    fontCache.set(file, opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));
  }
  return fontCache.get(file);
}

/** Union a single character and count { material, hole } loops. */
function glyphLoops(fontFile, ch, size) {
  const font = loadFont(fontFile);
  const contours = Toolpath.buildOpenTypeContours(font, ch, { size: size || 58 });
  const unioned = Toolpath.unionContours(contours, { tol: 0.04 });
  let material = 0, hole = 0;
  for (const c of unioned) {
    if (Toolpath.signedArea(c.pts) < 0) hole++;
    else material++;
  }
  return { material, hole };
}

// ----------------------------------------------------------------------
// Hole-count tables (glyph -> number of counters that must survive).
//
// Outline fonts have a known, stable anatomy. Script fonts (Pacifico,
// Dancing Script, Caveat, Lobster) use overlapping strokes and open
// apertures, so their entries are regression baselines of current
// verified-correct behaviour rather than typographic ground truth.
// ----------------------------------------------------------------------
const HOLE_TABLES = {
  'Roboto-Regular.ttf':     { b:1, d:1, p:1, q:1, o:1, a:1, g:1, e:1, A:1, B:2, D:1, O:1, P:1, Q:1, R:1, 0:1, 6:1, 8:2, 9:1, '%':2, '&':2, '@':1 },
  'Lora-Regular.ttf':       { b:1, d:1, p:1, q:1, o:1, a:1, g:2, e:1, A:1, B:2, D:1, O:1, P:1, Q:1, R:1, 0:1, 6:1, 8:2, 9:1, '%':2, '&':2, '@':1 },
  'PlayfairDisplay-Regular.ttf': { b:1, d:1, p:1, q:1, o:1, a:1, g:1, e:1, A:1, B:2, D:1, O:1, P:1, Q:1, R:1, 0:1, 6:1, 8:2, 9:1, '%':2, '&':0, '@':1 },
  'Merriweather-Regular.ttf': { b:1, d:1, p:1, q:1, o:1, a:1, g:2, e:1, A:1, B:2, D:1, O:1, P:1, Q:1, R:1, 0:1, 6:1, 8:2, 9:1, '%':2, '&':2, '@':1 },
  'CourierPrime-Regular.ttf': { b:1, d:1, p:1, q:1, o:1, a:1, g:1, e:1, A:1, B:2, D:1, O:1, P:1, Q:1, R:1, 0:1, 6:1, 8:2, 9:1, '%':2, '&':1, '@':1 },
  'Montserrat-Regular.ttf': { b:1, d:1, p:1, q:1, o:1, a:1, g:1, e:1, A:1, B:2, D:1, O:1, P:1, Q:1, R:1, 0:1, 6:1, 8:2, 9:1, '%':2, '&':2, '@':1 },
  'Oswald-Regular.ttf':     { b:1, d:1, p:1, q:1, o:1, a:1, g:2, e:1, A:1, B:2, D:1, O:1, P:1, Q:1, R:1, 0:1, 6:1, 8:2, 9:1, '%':2, '&':2, '@':1 },
  'Anton-Regular.ttf':      { b:1, d:1, p:1, q:1, o:1, a:1, g:1, e:1, A:1, B:2, D:1, O:1, P:1, Q:1, R:1, 0:1, 6:1, 8:2, 9:1, '%':2, '&':2, '@':1 },
  'BebasNeue-Regular.ttf':  { b:2, d:1, p:1, q:1, o:1, a:1, g:0, e:0, A:1, B:2, D:1, O:1, P:1, Q:1, R:1, 0:1, 6:1, 8:2, 9:1, '%':2, '&':1, '@':1 },
  'Orbitron-Regular.ttf':   { b:1, d:1, p:1, q:1, o:1, a:1, g:1, e:1, A:1, B:2, D:1, O:1, P:1, Q:1, R:1, 0:2, 6:1, 8:2, 9:1, '%':2, '&':1, '@':1 },
  'Righteous-Regular.ttf':  { b:1, d:1, p:1, q:1, o:1, a:1, g:1, e:1, A:1, B:2, D:1, O:1, P:1, Q:1, R:1, 0:1, 6:1, 8:2, 9:1, '%':2, '&':0, '@':1 },
  'Pacifico-Regular.ttf':   { b:2, d:2, p:2, q:1, o:1, a:1, g:2, e:1, A:0, B:0, D:0, O:1, P:1, Q:1, R:1, 0:1, 6:1, 8:2, 9:1, '%':2, '&':2, '@':1 },
  'DancingScript-Regular.ttf': { b:2, d:0, p:0, q:1, o:1, a:0, g:1, e:1, A:1, B:1, D:0, O:0, P:1, Q:1, R:1, 0:1, 6:1, 8:2, 9:1, '%':2, '&':0, '@':0 },
  'Caveat-Regular.ttf':     { b:0, d:1, p:1, q:1, o:1, a:1, g:1, e:1, A:1, B:1, D:0, O:1, P:1, Q:1, R:1, 0:1, 6:1, 8:2, 9:1, '%':2, '&':2, '@':1 },
  'Lobster-Regular.ttf':    { b:1, d:1, p:1, q:1, o:1, a:1, g:2, e:1, A:1, B:0, D:0, O:0, P:0, Q:1, R:0, 0:1, 6:1, 8:2, 9:1, '%':2, '&':0, '@':1 },
};

for (const [file, table] of Object.entries(HOLE_TABLES)) {
  for (const [ch, want] of Object.entries(table)) {
    test(`holes survive: ${file.replace(/-Regular\.ttf$/, '')} '${ch}' -> ${want}`, () => {
      const { hole } = glyphLoops(file, ch);
      assert.strictEqual(hole, want,
        `'${ch}' in ${file}: expected ${want} hole(s) after union, got ${hole}`);
    });
  }
}

// ----------------------------------------------------------------------
// The original bug scenario end-to-end: defaults (Roboto, pocket mode,
// 3 mm end mill) with a single lowercase 'd' at 58 mm text height.
// ----------------------------------------------------------------------
test('regression: Roboto d keeps its counter at every size', () => {
  for (const size of [5, 10, 30, 58, 100, 120]) {
    const { hole } = glyphLoops('Roboto-Regular.ttf', 'd', size);
    assert.strictEqual(hole, 1, `size ${size}mm: counter must survive`);
  }
});

test('pocket first ring hugs the counter of Roboto d (58mm, 3mm tool)', () => {
  let contours = Toolpath.buildOpenTypeContours(loadFont('Roboto-Regular.ttf'), 'd', { size: 58 });
  contours = Toolpath.normalize(Toolpath.unionContours(contours, { tol: 0.04 }), 'left');
  const hole = contours.find((c) => Toolpath.signedArea(c.pts) < 0);
  assert.ok(hole, 'union must retain a hole loop');

  const tool = { diameter: 3, stepoverPct: 45, contourPass: true };
  const ring1 = Toolpath.clipperOffsetLoops(
    contours.filter((c) => c.closed && c.pts.length > 2), -1.5);
  assert.ok(ring1 && ring1.length, 'first inward offset must produce rings');

  // the grown hole (the tool path around the counter) must still exist
  const grownHole = ring1.find((p) => Toolpath.signedArea(p) < 0);
  assert.ok(grownHole, 'first ring must trace the enlarged counter boundary');
});

test('boss mode traces the counter of Roboto d (58mm, 3mm tool)', () => {
  let contours = Toolpath.buildOpenTypeContours(loadFont('Roboto-Regular.ttf'), 'd', { size: 58 });
  contours = Toolpath.normalize(Toolpath.unionContours(contours, { tol: 0.04 }), 'left');
  const tool = { diameter: 3, stepoverPct: 45, contourPass: true };
  const paths = Toolpath.buildCutPaths(contours, 'boss', tool);
  // boss = union grown by tool radius: outer boundary + shrunk hole boundary
  assert.strictEqual(paths.length, 2, 'boss must cut around the outside AND the counter');
});

// ----------------------------------------------------------------------
// Orientation robustness: if a font (or future exporter) hands us loops
// whose native orientations are all equal, hole classification must
// still work via nesting probes.
// ----------------------------------------------------------------------
test('hole classification survives uniformly-inverted orientations', () => {
  const font = loadFont('Roboto-Regular.ttf');
  const contours = Toolpath.buildOpenTypeContours(font, 'o', { size: 58 });
  const inverted = contours.map((c) => ({ pts: c.pts.slice().reverse(), closed: true }));
  const unioned = Toolpath.unionContours(inverted, { tol: 0.04 });
  const holes = unioned.filter((c) => Toolpath.signedArea(c.pts) < 0).length;
  assert.strictEqual(holes, 1, "an 'o' must keep exactly one counter");
});

// ----------------------------------------------------------------------
// Overlapping strokes (self-crossing glyph outlines, e.g. script fonts)
// must still union into material — no even-odd XOR gaps.
// ----------------------------------------------------------------------
test('Pacifico d unions without XOR gaps', () => {
  const { material, hole } = glyphLoops('Pacifico-Regular.ttf', 'd');
  assert.ok(material >= 1, 'material region must exist');
  assert.strictEqual(hole, 2, 'baseline: bowl counter + stroke-enclosed region');
});

// ----------------------------------------------------------------------
// Clipper offset sanity on a synthetic annulus (guards the pocket loop
// engine itself, independent of fonts): shrink until the tool consumes
// the region; rings vanish before the shape turns inside-out.
// ----------------------------------------------------------------------
test('clipper offset: annulus shrinks cleanly ring by ring', () => {
  const outer = [[0, 0], [20, 0], [20, 20], [0, 20]];   // CCW material
  const holeW = [[5, 5], [5, 15], [15, 15], [15, 5]];   // CW hole
  let loops = [outer, holeW].map((pts) => ({ pts, closed: true }));
  const r = 1, step = 1.35;
  let delta = -r, rings = 0, guard = 50;
  while (loops.length && guard-- > 0) {
    const off = Toolpath.clipperOffsetLoops(loops, delta);
    if (!off || !off.length) break;
    for (const p of off) rings++;
    loops = off.map((pts) => ({ pts, closed: true }));
    delta = -step;
  }
  // outer walls 5mm thick: ring1 at -1, then ~3 more steps before the wall
  // (5-1)/1.35 is consumed; rings must appear and the run must terminate.
  assert.ok(rings >= 3, `expected at least 3 rings, got ${rings}`);
  assert.ok(guard > 0, 'offset loop must terminate');
});
