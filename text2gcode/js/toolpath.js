/**
 * toolpath.js — geometry helpers for text -> CNC toolpath conversion.
 * Coordinates are in millimeters, Y-up (GCode style).
 *
 * Exposes global `Toolpath` (and module.exports for node testing).
 */
(function (root) {
  'use strict';

  const EPS = 1e-7;

  // ------------------------------------------------------------------
  // OpenType (TTF/OTF) text -> contours
  // ------------------------------------------------------------------

  /**
   * Flatten an opentype.js path (commands) into polylines.
   * Returns [{ pts: [[x,y],...], closed: bool }]
   */
  function flattenPath(commands, quality) {
    quality = quality || 1;
    const contours = [];
    let cur = null;
    let cx = 0, cy = 0;
    let sx = 0, sy = 0;

    function addPoint(x, y) {
      const last = cur.pts[cur.pts.length - 1];
      if (last && Math.abs(last[0] - x) < 1e-4 && Math.abs(last[1] - y) < 1e-4) return;
      cur.pts.push([x, y]);
    }

    function curveSteps(len) {
      return Math.max(4, Math.min(48, Math.ceil(len / 0.08 / quality)));
    }

    for (let i = 0; i < commands.length; i++) {
      const c = commands[i];
      switch (c.type) {
        case 'M':
          cur = { pts: [], closed: false };
          contours.push(cur);
          cx = c.x; cy = c.y; sx = c.x; sy = c.y;
          cur.pts.push([cx, cy]);
          break;
        case 'L':
          addPoint(c.x, c.y);
          cx = c.x; cy = c.y;
          break;
        case 'C': {
          const x0 = cx, y0 = cy;
          const len = Math.hypot(c.x - x0, c.y - y0) + Math.hypot(c.x1 - x0, c.y1 - y0);
          const steps = curveSteps(len);
          for (let s = 1; s <= steps; s++) {
            const t = s / steps;
            const mt = 1 - t;
            const x = mt * mt * mt * x0 + 3 * mt * mt * t * c.x1 + 3 * mt * t * t * c.x2 + t * t * t * c.x;
            const y = mt * mt * mt * y0 + 3 * mt * mt * t * c.y1 + 3 * mt * t * t * c.y2 + t * t * t * c.y;
            addPoint(x, y);
          }
          cx = c.x; cy = c.y;
          break;
        }
        case 'Q': {
          const x0 = cx, y0 = cy;
          const len = Math.hypot(c.x - x0, c.y - y0) + Math.hypot(c.x1 - x0, c.y1 - y0);
          const steps = curveSteps(len);
          for (let s = 1; s <= steps; s++) {
            const t = s / steps;
            const mt = 1 - t;
            const x = mt * mt * x0 + 2 * mt * t * c.x1 + t * t * c.x;
            const y = mt * mt * y0 + 2 * mt * t * c.y1 + t * t * c.y;
            addPoint(x, y);
          }
          cx = c.x; cy = c.y;
          break;
        }
        case 'Z':
          if (cur) {
            cur.closed = true;
            // drop duplicated closing point
            if (cur.pts.length > 1) {
              const f = cur.pts[0], l = cur.pts[cur.pts.length - 1];
              if (Math.abs(f[0] - l[0]) < 1e-4 && Math.abs(f[1] - l[1]) < 1e-4) cur.pts.pop();
            }
            cx = sx; cy = sy;
          }
          break;
      }
    }
    return contours.filter((c) => c.pts.length > 1);
  }

  /**
   * Build contours for a multi-line block of text with an opentype.js font.
   * opts: { size, lineHeightMult, letterSpacingMM }
   * Returns [{ pts, closed }] in mm, y-up, baseline of first line at y=0.
   *
   * Note: opentype.js Path commands are in SVG coords (y grows DOWNWARD, so
   * glyphs sit at negative y above the baseline). We negate y here to get
   * proper y-up GCode geometry — this also flips multi-line order back so
   * line 0 is the top line.
   */
  function buildOpenTypeContours(font, text, opts) {
    const size = opts.size;
    const upm = font.unitsPerEm || 1000;
    const asc = (typeof font.ascender === 'number' ? font.ascender : upm * 0.8);
    const desc = (typeof font.descender === 'number' ? font.descender : -upm * 0.2);
    const lineH = ((asc - desc) / upm) * size * (opts.lineHeightMult || 1);
    const lsEm = (opts.letterSpacingMM || 0) / size;

    const lines = String(text).split('\n');
    const contours = [];
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      // opentype y-down: subsequent lines must be at LARGER y (lower on page);
      // after the y-flip below this becomes -i*lineH in y-up (lower in GCode)
      const baseline = i * lineH;
      const path = font.getPath(lines[i], 0, baseline, size, {
        kerning: true,
        letterSpacing: lsEm,
      });
      const c = flattenPath(path.commands, opts.quality || 1);
      for (const cc of c) {
        contours.push({
          pts: cc.pts.map((p) => [p[0], -p[1]]), // flip to y-up
          closed: cc.closed,
        });
      }
    }
    return contours;
  }

  // ------------------------------------------------------------------
  // Hershey single-stroke fonts -> contours
  // ------------------------------------------------------------------

  const HERSHEY_BASELINE = 22; // raw hershey y of the baseline (y grows downward)

  /** Parse a simple SVG path made of M/L commands into open polylines. */
  function parseSvgPath(d) {
    const out = [];
    const parts = d.split(/([ML])/);
    let cur = null;
    for (let i = 1; i < parts.length; i += 2) {
      const cmd = parts[i];
      const nums = (parts[i + 1] || '').match(/-?\d*\.?\d+/g) || [];
      for (let j = 0; j + 1 < nums.length; j += 2) {
        const x = parseFloat(nums[j]), y = parseFloat(nums[j + 1]);
        if (cmd === 'M' && j === 0) {
          cur = [[x, y]];
          out.push(cur);
        } else {
          if (!cur) { cur = [[x, y]]; out.push(cur); }
          else cur.push([x, y]);
        }
      }
    }
    return out;
  }

  let _hersheyAvgCache = {};

  function hersheyAvgAdvance(hfont) {
    if (_hersheyAvgCache[hfont.name]) return _hersheyAvgCache[hfont.name];
    let total = 0, n = 0;
    for (const code of [65, 66, 67, 72, 79, 83, 88, 97, 109, 112, 48, 53]) {
      const ch = hfont.chars[code - 33];
      if (!ch) continue;
      let minx = Infinity, maxx = -Infinity;
      for (const pl of parseSvgPath(ch.d)) {
        for (const p of pl) {
          if (p[0] < minx) minx = p[0];
          if (p[0] > maxx) maxx = p[0];
        }
      }
      if (maxx > minx) { total += maxx - minx; n++; }
    }
    const avg = n ? total / n : 12;
    _hersheyAvgCache[hfont.name] = avg;
    return avg;
  }

  /**
   * Build contours for a block of text with a Hershey single-stroke font.
   * opts: { size, lineHeightMult, letterSpacingMM }
   */
  function buildHersheyContours(hfont, text, opts) {
    const size = opts.size;
    // cap height in raw units = 21 (y 1..22) -> map to 0.72em, like most fonts
    const scale = (size * 0.72) / 21;
    const lineH = size * 1.2 * (opts.lineHeightMult || 1);
    const spaceAdv = 0.85 * hersheyAvgAdvance(hfont);

    const lines = String(text).split('\n');
    const contours = [];
    for (let i = 0; i < lines.length; i++) {
      const baseline = -i * lineH;
      let penX = 0;
      for (const ch of lines[i]) {
        if (ch === ' ' || ch === '\t') {
          penX += spaceAdv * scale + (opts.letterSpacingMM || 0);
          continue;
        }
        const data = hfont.chars[ch.charCodeAt(0) - 33];
        if (!data) continue;
        const pls = parseSvgPath(data.d);
        let minx = Infinity, maxx = -Infinity;
        for (const pl of pls) {
          for (const p of pl) {
            if (p[0] < minx) minx = p[0];
            if (p[0] > maxx) maxx = p[0];
          }
        }
        if (!isFinite(minx)) continue;
        const tx = penX - minx * scale;
        for (const pl of pls) {
          const pts = pl.map((p) => [tx + p[0] * scale, baseline + (HERSHEY_BASELINE - p[1]) * scale]);
          contours.push({ pts, closed: false });
        }
        penX += (maxx - minx) * scale + (opts.letterSpacingMM || 0);
      }
    }
    return contours;
  }

  // ------------------------------------------------------------------
  // Layout normalization
  // ------------------------------------------------------------------

  function bounds(contours) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of contours) {
      for (const p of c.pts) {
        if (p[0] < minX) minX = p[0];
        if (p[0] > maxX) maxX = p[0];
        if (p[1] < minY) minY = p[1];
        if (p[1] > maxY) maxY = p[1];
      }
    }
    if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
    return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
  }

  /** Shift contours so the block is aligned horizontally and bottom-left sits at origin. */
  function normalize(contours, align) {
    const b = bounds(contours);
    let dx = -b.minX;
    if (align === 'center') dx = -(b.minX + b.maxX) / 2;
    else if (align === 'right') dx = -b.maxX;
    const dy = -b.minY;
    for (const c of contours) for (const p of c.pts) { p[0] += dx; p[1] += dy; }
    return contours;
  }

  // ------------------------------------------------------------------
  // Polygon offsetting (for tool radius compensation)
  // ------------------------------------------------------------------

  function signedArea(pts) {
    let a = 0;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return a / 2;
  }

  /** Remove near-duplicate consecutive points. */
  function simplify(pts, eps) {
    eps = eps || 1e-4;
    const out = [];
    for (const p of pts) {
      const l = out[out.length - 1];
      if (!l || Math.abs(l[0] - p[0]) > eps || Math.abs(l[1] - p[1]) > eps) out.push(p);
    }
    if (out.length > 1) {
      const f = out[0], l = out[out.length - 1];
      if (Math.abs(f[0] - l[0]) < eps && Math.abs(f[1] - l[1]) < eps) out.pop();
    }
    return out;
  }

  /**
   * Offset a closed polygon sideways by dist (positive = to the left of travel).
   * Uses miter joins with a clamp to survive sharp corners.
   */
  function offsetPolygon(ptsIn, dist) {
    const pts = simplify(ptsIn.slice());
    const n = pts.length;
    if (n < 3 || Math.abs(dist) < EPS) return ptsIn.slice();

    // edge unit vectors
    const dirs = [];
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      let dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.hypot(dx, dy);
      if (len < EPS) { dirs.push(null); continue; }
      dirs.push([dx / len, dy / len]);
    }
    // left normal of each edge
    const norms = dirs.map((d) => (d ? [-d[1], d[0]] : null));

    const out = [];
    for (let i = 0; i < n; i++) {
      const n1 = norms[(i - 1 + n) % n] || norms[i];
      const n2 = norms[i] || norms[(i - 1 + n) % n];
      if (!n1 || !n2) continue;
      const p = pts[i];
      if (Math.abs(n1[0] - n2[0]) < 1e-6 && Math.abs(n1[1] - n2[1]) < 1e-6) {
        out.push([p[0] + n2[0] * dist, p[1] + n2[1] * dist]);
        continue;
      }
      // miter: intersection of the two offset edges
      const q1 = [p[0] + n1[0] * dist, p[1] + n1[1] * dist];
      const d1 = dirs[(i - 1 + n) % n] || dirs[i];
      const q2 = [p[0] + n2[0] * dist, p[1] + n2[1] * dist];
      const d2 = dirs[i];
      const den = d1[0] * d2[1] - d1[1] * d2[0];
      let ip;
      if (Math.abs(den) < 1e-9) {
        ip = [(q1[0] + q2[0]) / 2, (q1[1] + q2[1]) / 2];
      } else {
        const t = ((q2[0] - q1[0]) * d2[1] - (q2[1] - q1[1]) * d2[0]) / den;
        ip = [q1[0] + d1[0] * t, q1[1] + d1[1] * t];
      }
      // clamp runaway miters on very sharp corners
      const maxMiter = Math.abs(dist) * 4;
      if (Math.hypot(ip[0] - p[0], ip[1] - p[1]) > maxMiter) {
        ip = [p[0] + (n1[0] + n2[0]) / 2 * dist, p[1] + (n1[1] + n2[1]) / 2 * dist];
      }
      out.push(ip);
    }
    const res = simplify(out);
    // guard: collapsed polygons
    if (res.length < 3 || Math.abs(signedArea(res)) < EPS) return [];
    return res;
  }

  function polyPerimeter(pts) {
    let p = 0;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      p += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    return p;
  }

  // ------------------------------------------------------------------
  // Robust polygon offsetting via Clipper (ClipperOffset)
  //
  // The old miter-based offset self-intersected at acute corners (e.g. the
  // N of Courier Prime in boss mode). Clipper's offsetting removes those
  // self-intersections, uses round joins (matching a round tool) and drops
  // features narrower than the offset automatically.
  //
  // Empirically verified behavior of ClipperOffset 6.4.2 (etClosedPolygon):
  //  - ALL input loops must share ONE orientation (here: CCW / positive area);
  //    nested loops are then detected by containment and treated as holes.
  //  - delta > 0 grows the region (outer grows, holes shrink);
  //    delta < 0 shrinks it (holes grow); vanishing features are removed.
  // ------------------------------------------------------------------

  /**
   * Normalize a loop set via Clipper union (even-odd fill) into a PolyTree:
   * returns flat loops where depth-0 loops are outers and deeper loops are
   * holes, with orientations ClipperOffset expects (outers CCW/positive,
   * holes CW/negative — empirically verified). Also merges residual overlaps
   * and cleans degenerate edges. NOTE: with even-odd semantics, overlapping
   * input loops would XOR-cancel — callers must union first (they do).
   */
  function normalizeLoopsViaClipper(loops) {
    const CL = getClipperLib();
    if (!CL) return null;
    const SCL = 1000;
    const paths = loops
      .filter((l) => l.pts && l.pts.length > 2)
      .map((l) => l.pts.map((p) => ({ X: Math.round(p[0] * SCL), Y: Math.round(p[1] * SCL) })));
    if (!paths.length) return [];
    const c = new CL.Clipper();
    c.AddPaths(paths, CL.PolyType.ptSubject, true);
    const tree = new CL.PolyTree();
    c.Execute(CL.ClipType.ctUnion, tree,
      CL.PolyFillType.pftEvenOdd, CL.PolyFillType.pftEvenOdd);
    const out = [];
    (function walk(node, depth) {
      const childs = node.Childs();
      for (let i = 0; i < childs.length; i++) {
        const cont = childs[i].Contour();
        if (cont.length >= 3) {
          out.push({
            pts: cont.map((p) => [p.X / SCL, p.Y / SCL]),
            closed: true,
            hole: depth % 2 === 1,
          });
        }
        walk(childs[i], depth + 1);
      }
    })(tree, 0);
    return out;
  }

  /**
   * Resolve a library global robustly: bare identifier (classic scripts),
   * or attached to window/self/globalThis (works in module scope too).
   * Checks ALL candidates — some environments have window !== self.
   */
  function resolveLib(name) {
    try {
      if (typeof eval(name) !== 'undefined') return eval(name);
    } catch (e) { /* not a bare global */ }
    const cands = [];
    if (typeof window !== 'undefined') cands.push(window);
    if (typeof self !== 'undefined') cands.push(self);
    if (typeof globalThis !== 'undefined') cands.push(globalThis);
    if (typeof global !== 'undefined') cands.push(global);
    for (const g of cands) {
      if (g && g[name]) return g[name];
    }
    return null;
  }

  function getClipperLib() { return resolveLib('ClipperLib'); }
  function getPolyBool() { return resolveLib('PolyBool'); }

  /** Offset loops (any orientation) by delta mm; positive delta GROWS the region. */
  function clipperOffsetLoops(loops, delta) {
    const CL = getClipperLib();
    if (!CL) return null; // caller decides fallback
    if (Math.abs(delta) < EPS) return loops.map((l) => l.pts.slice());
    const normalized = normalizeLoopsViaClipper(loops);
    if (!normalized) return null;
    const SCL = 1000; // 0.001 mm integer precision
    const paths = normalized.map((l) =>
      l.pts.map((p) => ({ X: Math.round(p[0] * SCL), Y: Math.round(p[1] * SCL) })));
    const co = new CL.ClipperOffset(2, 0.025 * SCL); // miterLimit, 0.025mm arc tolerance
    co.AddPaths(paths, CL.JoinType.jtRound, CL.EndType.etClosedPolygon);
    const sol = [];
    co.Execute(sol, delta * SCL);
    // Resolve self-intersections introduced by the offset (fold-backs at
    // near-touching features — e.g. between close letters) and drop
    // degenerate edges. SimplifyPolygons is Clipper's dedicated cleanup op.
    const cleaned = CL.Clipper.SimplifyPolygons(sol, CL.PolyFillType.pftEvenOdd);
    return (cleaned || [])
      .map((pl) => simplify(pl.map((p) => [p.X / SCL, p.Y / SCL]), 0.002))
      .filter((pl) => pl.length >= 3);
  }

  /**
   * Offset the glyph region by dist mm (positive = GROW the letters, negative
   * = shrink). Requires unioned closed contours. Returns array of closed
   * polylines (mm). Features narrower than the offset vanish automatically.
   * Falls back to the legacy miter offsetting if Clipper is unavailable.
   */
  function offsetGlyphContours(contours, dist) {
    const closed = contours.filter((c) => c.closed && c.pts.length > 2);
    if (!closed.length) return [];
    const res = clipperOffsetLoops(closed, dist);
    if (res) return res;

    // ---- legacy fallback (miter offsetting) — only without Clipper ----
    if (Math.abs(dist) < EPS) return closed.map((c) => c.pts.slice());
    let bigIdx = 0, bigArea = 0;
    const areas = closed.map((c) => signedArea(c.pts));
    for (let i = 0; i < closed.length; i++) {
      const a = Math.abs(areas[i]);
      if (a > bigArea) { bigArea = a; bigIdx = i; }
    }
    const outerSign = Math.sign(areas[bigIdx]) || 1;
    const out = [];
    for (let i = 0; i < closed.length; i++) {
      const c = closed[i];
      const isOuter = Math.sign(areas[i]) === outerSign;
      // new convention: dist>0 grows the region
      let d = areas[i] > 0 ? -dist : dist;
      if (!isOuter) d = -d;
      const areaAbs = Math.abs(areas[i]);
      const shrinks = d * Math.sign(areas[i]) > 0;
      if (shrinks && polyPerimeter(c.pts) * Math.abs(d) >= areaAbs * 0.95) continue;
      const r = offsetPolygon(c.pts, d);
      if (r.length >= 3) out.push(r);
    }
    return out;
  }

  // ------------------------------------------------------------------
  // Polygon union (for boss/pocket across overlapping letters)
  // ------------------------------------------------------------------

  /**
   * Douglas-Peucker simplification of a closed loop (keeps shape within tol).
   */
  function simplifyClosed(pts, tol) {
    if (pts.length < 8) return pts.slice();
    tol = tol || 0.05;
    // anchor: first point + farthest point from it, run DP on each half
    const a = pts[0];
    let far = 1, fd = -1;
    for (let i = 1; i < pts.length; i++) {
      const d = Math.hypot(pts[i][0] - a[0], pts[i][1] - a[1]);
      if (d > fd) { fd = d; far = i; }
    }
    function dp(sub) {
      if (sub.length < 3) return sub;
      const p1 = sub[0], p2 = sub[sub.length - 1];
      const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
      const len = Math.hypot(dx, dy) || 1e-12;
      let maxd = -1, mi = -1;
      for (let i = 1; i < sub.length - 1; i++) {
        const d = Math.abs(dy * (sub[i][0] - p1[0]) - dx * (sub[i][1] - p1[1])) / len;
        if (d > maxd) { maxd = d; mi = i; }
      }
      if (maxd < tol) return [p1, p2];
      return dp(sub.slice(0, mi + 1)).slice(0, -1).concat(dp(sub.slice(mi)));
    }
    const out = dp(pts.slice(0, far + 1)).slice(0, -1).concat(dp(pts.slice(far)));
    return simplify(out, 1e-4);
  }

  function loopBounds(pts) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
    return { minX, minY, maxX, maxY };
  }

  function bboxesOverlap(a, b, pad) {
    return a.minX - pad <= b.maxX && b.minX - pad <= a.maxX &&
           a.minY - pad <= b.maxY && b.minY - pad <= a.maxY;
  }

  /**
   * Do two loops' BOUNDARIES cross (strokes overlap), as opposed to one
   * merely nesting inside the other? Computed via Clipper intersection of
   * the even-odd regions: nested-disjoint loops intersect in zero area
   * (the inner region is a hole of the outer), while crossing strokes
   * share a partial area (strictly between 0 and the smaller loop's area).
   */
  function loopsCross(CL, toClip, aPts, bPts) {
    const areaA = Math.abs(signedArea(aPts));
    const areaB = Math.abs(signedArea(bPts));
    const c = new CL.Clipper();
    c.AddPath(toClip(aPts), CL.PolyType.ptSubject, true);
    c.AddPath(toClip(bPts), CL.PolyType.ptClip, true);
    const sol = new CL.Paths();
    c.Execute(CL.ClipType.ctIntersection, sol, CL.PolyFillType.pftEvenOdd, CL.PolyFillType.pftEvenOdd);
    let area = 0;
    for (const pl of sol) area += signedArea(pl.map((p) => [p.X / 1000, p.Y / 1000]));
    area = Math.abs(area);
    return area > 0.001 && area < Math.min(areaA, areaB) * 0.999;
  }

  /**
   * Repair glyph outlines and union them with MATERIAL = UNION semantics.
   *
   * Why: glyph outlines frequently self-intersect (a diagonal stroke
   * overshoots a bar and crosses it — Montserrat's Z, many script fonts).
   * Even-odd semantics XOR the doubly-covered triangles into holes, causing
   * triangular gaps in pocket rings and spurious cutouts in boss mode.
   * NonZero union reads any covered area as material — but only works if
   * hole loops (glyph counters like the inside of O) are oriented opposite.
   *
   * Hole classification (per loop):
   *   hole  = every ε-inward probe lies inside an ODD number of other loops
   *           (true nesting: O's counter inside its outer, island-in-lake)
   *           AND the loop crosses no other loop (zero intersection area —
   *           a genuinely separate boundary, not an overlapping stroke)
   *   else  = material
   * Then: material CCW(+), holes CW(−), one NonZero union. Self-crossing
   * material loops fill correctly (winding ±2 regions stay filled).
   */
  function repairGlyphLoops(loops) {
    const CL = getClipperLib();
    if (!CL) return loops.map((l) => ({ pts: l.slice(), closed: true }));
    if (!loops.length) return [];
    const SCL = 1000;
    const toClip = (pts) => pts.map((p) => ({ X: Math.round(p[0] * SCL), Y: Math.round(p[1] * SCL) }));
    const fromClip = (paths) => paths.map((pl) => pl.map((p) => [p.X / SCL, p.Y / SCL]));

    const boxes = loops.map(loopBounds);

    // ε-inward probes from edge midpoints (hug the boundary of THIS loop,
    // capped in count for performance)
    const probesOf = (pts) => {
      const sign = Math.sign(signedArea(pts)) || 1;
      const probes = [];
      const step = Math.max(1, Math.floor(pts.length / 32));
      for (let i = 0; i < pts.length; i += step) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        let nx = -(b[1] - a[1]), ny = b[0] - a[0];
        const len = Math.hypot(nx, ny) || 1;
        nx /= len; ny /= len;
        if (sign < 0) { nx = -nx; ny = -ny; } // inward = left normal when CCW
        probes.push([(a[0] + b[0]) / 2 + nx * 0.02, (a[1] + b[1]) / 2 + ny * 0.02]);
      }
      return probes;
    };
    const allProbes = loops.map(probesOf);

    // pairwise boundary-crossing detection (bbox-filtered)
    const crosses = loops.map(() => false);
    for (let i = 0; i < loops.length; i++) {
      for (let j = i + 1; j < loops.length; j++) {
        if (!bboxesOverlap(boxes[i], boxes[j], 0.1)) continue;
        if (loopsCross(CL, toClip, loops[i], loops[j])) {
          crosses[i] = true;
          crosses[j] = true;
        }
      }
    }

    // hole = odd-parity nesting of ALL probes, and no crossings
    const isHole = [];
    for (let i = 0; i < loops.length; i++) {
      let hole = false;
      if (!crosses[i] && allProbes[i].length) {
        hole = true;
        for (const q of allProbes[i]) {
          let parity = 0;
          for (let j = 0; j < loops.length; j++) {
            if (j === i) continue;
            if (!bboxesOverlap(boxes[i], boxes[j], 0.1)) continue;
            if (pointInRegion(q[0], q[1], [{ pts: loops[j] }])) parity++;
          }
          if (parity % 2 === 0) { hole = false; break; }
        }
      }
      isHole.push(hole);
    }

    // orient material CCW(+), holes CW(−), then one NonZero union
    const clipLoops = loops.map((pts, i) => {
      const positive = signedArea(pts) > 0;
      if (isHole[i] === positive) return toClip(pts.slice().reverse());
      return toClip(pts);
    });
    const c = new CL.Clipper();
    c.AddPaths(clipLoops, CL.PolyType.ptSubject, true);
    const solution = new CL.Paths();
    c.Execute(CL.ClipType.ctUnion, solution, CL.PolyFillType.pftNonZero, CL.PolyFillType.pftNonZero);
    return fromClip(solution)
      .filter((pl) => pl.length >= 3)
      .map((pl) => ({ pts: simplify(pl, 0.002), closed: true }));
  }

  /**
   * Union all closed glyph contours into non-overlapping loops with correct
   * hole nesting. Self-intersecting glyph outlines are repaired with union
   * semantics first (see repairGlyphLoops). Requires Clipper; falls back to
   * passing loops through untouched.
   * opts: { tol: simplification tolerance (mm, default 0.04) }
   */
  function unionContours(contours, opts) {
    opts = opts || {};
    const closed = contours.filter((c) => c.closed && c.pts.length > 2);
    if (!closed.length) return [];
    const tol = opts.tol != null ? opts.tol : 0.04;
    const loops = closed.map((c) => simplifyClosed(c.pts, tol));
    const repaired = repairGlyphLoops(loops);
    if (repaired.length) return repaired;
    return closed.map((c) => ({ pts: c.pts.slice(), closed: true }));
  }

  // ------------------------------------------------------------------
  // Hatch fill
  // ------------------------------------------------------------------

  function pointInRegion(x, y, contours) {
    let inside = false;
    for (const c of contours) {
      const pts = c.pts;
      const n = pts.length;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const yi = pts[i][1], yj = pts[j][1], xi = pts[i][0], xj = pts[j][0];
        if ((yi > y) !== (yj > y)) {
          const xint = (xj - xi) * (y - yi) / (yj - yi) + xi;
          if (x < xint) inside = !inside;
        }
      }
    }
    return inside;
  }

  /**
   * Generate hatch (raster) fill lines inside glyph contours.
   * angle: degrees; stepover: mm; zigzag: connect adjacent lines where legal.
   * Returns array of polylines [[x,y],...].
   */
  function hatchFill(contours, angleDeg, stepover, zigzag) {
    const rad = (angleDeg || 0) * Math.PI / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const fwd = (p) => [p[0] * cos + p[1] * sin, -p[0] * sin + p[1] * cos];
    const inv = (p) => [p[0] * cos - p[1] * sin, p[0] * sin + p[1] * cos];

    // collect edges in rotated space
    const edges = [];
    let minY = Infinity, maxY = -Infinity;
    for (const c of contours) {
      const rp = c.pts.map(fwd);
      const m = c.closed ? rp.length : rp.length - 1;
      for (let i = 0; i < m; i++) {
        const a = rp[i], b = rp[(i + 1) % rp.length];
        if (a[1] === b[1]) continue;
        edges.push([a, b]);
        if (a[1] < minY) minY = a[1];
        if (a[1] > maxY) maxY = a[1];
        if (b[1] < minY) minY = b[1];
        if (b[1] > maxY) maxY = b[1];
      }
    }
    if (!isFinite(minY)) return [];

    stepover = Math.max(0.05, stepover);
    const lines = []; // { y, segs: [[x1,x2],...] }
    for (let y = minY + stepover / 2; y <= maxY; y += stepover) {
      const xs = [];
      for (const [a, b] of edges) {
        if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
          xs.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
        }
      }
      xs.sort((p, q) => p - q);
      const segs = [];
      for (let i = 0; i + 1 < xs.length; i += 2) {
        if (xs[i + 1] - xs[i] > 1e-4) segs.push([xs[i], xs[i + 1]]);
      }
      if (segs.length) lines.push({ y, segs });
    }

    // build polylines (rotated space)
    const polylines = [];
    let curLine = null;
    for (let li = 0; li < lines.length; li++) {
      const { y, segs } = lines[li];
      const reverse = zigzag && li % 2 === 1;
      const order = reverse ? segs.slice().reverse() : segs;
      for (const seg of order) {
        const p1 = [reverse ? seg[1] : seg[0], y];
        const p2 = [reverse ? seg[0] : seg[1], y];
        if (curLine && zigzag) {
          // try to connect from end of curLine to start of this segment
          const end = curLine[curLine.length - 1];
          const ok = connectorInside(end, p1, lines[li - 1], lines[li], contours, fwd);
          if (ok) { curLine.push(p1, p2); continue; }
        }
        if (curLine) polylines.push(curLine);
        curLine = [p1, p2];
      }
    }
    if (curLine) polylines.push(curLine);

    // transform back
    return polylines.map((pl) => pl.map(inv));
  }

  /**
   * Contour-parallel pocket: carve rings that FOLLOW the polygon shapes.
   * First ring offsets the (unioned) region inward by the tool radius so the
   * tool edge lands exactly on the boundary — the same offset the boss mode
   * uses, just negative. Each further ring steps inward by the stepover.
   * Iterates until the region is consumed (features narrower than the tool
   * vanish automatically inside Clipper).
   * tool: { diameter, stepoverPct, contourPass }
   * Returns array of closed cut polylines (outermost ring first).
   */
  function contourPocket(contours, tool) {
    const dia = tool.diameter || 2;
    const r = dia / 2;
    const stepover = Math.max(0.05, dia * (tool.stepoverPct / 100));
    const paths = [];
    let loops = contours.filter((c) => c.closed && c.pts.length > 2);
    let delta = -r;          // first ring: tool edge on the boundary
    let first = true;
    let guard = 20000;       // safety against numerical no-progress loops
    while (loops.length && guard-- > 0) {
      const off = clipperOffsetLoops(loops, delta);
      if (!off || !off.length) break;
      if (!(first && !tool.contourPass)) {
        for (const p of off) paths.push(p.concat([p[0]]));
      }
      loops = off.map((pts) => ({ pts, closed: true }));
      delta = -stepover;     // subsequent rings: one stepover inward
      first = false;
    }
    return paths;
  }

  /** Check whether a short connector crosses only material to be removed. */
  function connectorInside(a, b, prevLine, curLine, contours, fwd) {
    if (!prevLine || !curLine) return false;
    // connector must not be absurdly long (e.g. spanning a wide hole)
    const spanX0 = Math.min(prevLine.segs[0][0], curLine.segs[0][0]);
    const spanX1 = Math.max(prevLine.segs[prevLine.segs.length - 1][1], curLine.segs[curLine.segs.length - 1][1]);
    if (Math.max(a[0], b[0]) - Math.min(a[0], b[0]) > (spanX1 - spanX0) * 0.999) return false;
    const steps = 5;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = a[0] + (b[0] - a[0]) * t;
      const y = a[1] + (b[1] - a[1]) * t;
      if (!pointInRegion(x, y, contours.map((c) => ({ pts: c.pts.map(fwd) })))) return false;
    }
    return true;
  }

  // ------------------------------------------------------------------
  // Build complete toolpath (list of moves) for a mode
  // ------------------------------------------------------------------

  /**
   * Generate cut polylines for a mode.
   * contours: glyph contours — closed+unioned for boss/pocket, raw for single
   * mode: 'single' | 'boss' | 'pocket'
   * tool: { diameter, stepoverPct, hatchAngle, contourPass: bool, zigzag: bool }
   */
  function buildCutPaths(contours, mode, tool) {
    const paths = [];
    const r = (tool.diameter || 2) / 2;

    if (mode === 'single') {
      for (const c of contours) paths.push(c.pts.slice());
      return paths;
    }

    // 'boss' and 'pocket' expect contours that are ALREADY unioned
    // (see unionContours) so overlapping letters share one boundary.

    if (mode === 'boss') {
      // Boss: letters stay as a raised region; cut everywhere else.
      // contours are already UNIONED (letters considered together), so shared
      // boundaries between overlapping letters are not cut.
      // Grow the region by the tool radius (Clipper offset, round joins):
      // the tool edge lands exactly on the boss edge and the tool can never
      // cut into the letters.
      const off = offsetGlyphContours(contours, r);
      for (const p of off) paths.push(p.concat([p[0]]));
      return paths;
    }

    if (mode === 'pocket') {
      // contour-parallel pocketing: rings follow the letter shapes, stepping
      // inward by the tool radius (first ring) then the stepover, until done
      return contourPocket(contours, tool);
    }

    return paths;
  }

  function polyLength(pts) {
    let len = 0;
    for (let i = 1; i < pts.length; i++) {
      len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    }
    return len;
  }

  const api = {
    flattenPath,
    buildOpenTypeContours,
    buildHersheyContours,
    normalize,
    bounds,
    signedArea,
    offsetPolygon,
    clipperOffsetLoops,
    normalizeLoopsViaClipper,
    offsetGlyphContours,
    unionContours,
    simplifyClosed,
    contourPocket,
    hatchFill,
    pointInRegion,
    buildCutPaths,
    polyLength,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Toolpath = api;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));