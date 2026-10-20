// Topographic map: vector layers built once per terrain, rendered into cached raster
// tiers, then shown in a pannable/zoomable canvas with guess and answer overlays.
// Browser only.

import { N, W, CELL, M_TO_FT, HFOV, NO_WATER } from './constants';
import { clamp } from './math';
import { contourLevels, contourSingle, tracePolyline, chaikin, type Polyline } from './contour';
import type { Terrain } from './terrain';

export interface MapStyle {
  woodland: boolean;
  contourLabels: boolean;
  /** CSS font-family list for map lettering. */
  font: string;
}

const INK = {
  paper: '#f7f4ea',
  wood: '#cfe6a6',
  glacier: '#e9f3f8',
  contour: '#ad6c3c',
  index: '#8c4c22',
  label: '#86471f',
  iceContour: '#4f9cc8',
  water: '#a9daeb',
  waterLine: '#2b9bc6',
  waterText: '#1f6f99',
  bathy: 'rgba(43, 140, 190, 0.5)',
  grid: 'rgba(28, 70, 110, 0.16)',
  spot: '#3a2a1c',
  dam: '#2f2620',
  collar: '#efebde',
};

export const GUESS_COLOR = '#d1307c';
export const ANSWER_COLOR = '#ff7a2f';

interface Label { x: number; y: number; ang: number; text: string }
interface WaterLabel { x: number; y: number; ang: number; text: string; size: number; halo: string }
interface RiverRun { pts: Float32Array; width: number }

export interface MapLayers {
  normal: Path2D;
  index: Path2D;
  bathy: Path2D;
  bathyIndex: Path2D;
  labels: Label[];
  veg: Path2D;
  glacierFill: Path2D;
  glacierEdge: Path2D;
  hasGlacier: boolean;
  marsh: Path2D;
  hasMarsh: boolean;
  lakes: Path2D;
  seaFill: Path2D;
  coast: Path2D;
  hasSea: boolean;
  streams: Path2D[];
  rivers: RiverRun[];
  dam: { ax: number; ay: number; bx: number; by: number; name: string } | null;
  falls: { x: number; y: number; ang: number; name: string }[];
  waterLabels: WaterLabel[];
  shade: HTMLCanvasElement;
  peaks: { x: number; y: number; text: string }[];
  interval: number;
  style: MapStyle;
}

function padField(src: Float32Array, val: number) {
  const P = W + 2;
  const out = new Float32Array(P * P).fill(val);
  for (let z = 0; z < W; z++) out.set(src.subarray(z * W, z * W + W), (z + 1) * P + 1);
  return out;
}

function addLines(path: Path2D, lines: Polyline[], offset = 0) {
  for (const ln of lines) tracePolyline(path, ln.pts, ln.closed, 1, offset);
}

/** Positions along a polyline where a label of the given length sits on a straight run. */
function labelSpots(pts: Float32Array, every: number, start: number, half: number) {
  const m = pts.length >> 1;
  const out: { x: number; y: number; ang: number }[] = [];
  if (m < 4) return out;
  const cum = new Float32Array(m);
  for (let i = 1; i < m; i++) cum[i] = cum[i - 1] + Math.hypot(pts[2 * i] - pts[2 * i - 2], pts[2 * i + 1] - pts[2 * i - 1]);
  const total = cum[m - 1];
  const at = (s: number): [number, number] => {
    let i = 1;
    while (i < m - 1 && cum[i] < s) i++;
    const f = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    return [pts[2 * i - 2] + (pts[2 * i] - pts[2 * i - 2]) * f, pts[2 * i - 1] + (pts[2 * i + 1] - pts[2 * i - 1]) * f];
  };
  for (let s = start; s < total - half; s += every) {
    const [x, y] = at(s), [x0, y0] = at(s - half), [x1, y1] = at(s + half);
    const a0 = Math.atan2(y - y0, x - x0), a1 = Math.atan2(y1 - y, x1 - x);
    let da = Math.abs(a1 - a0);
    if (da > Math.PI) da = 2 * Math.PI - da;
    if (da > 0.35) continue;
    let ang = Math.atan2(y1 - y0, x1 - x0);
    if (ang > Math.PI / 2) ang -= Math.PI;
    else if (ang < -Math.PI / 2) ang += Math.PI;
    out.push({ x, y, ang });
  }
  return out;
}

export function buildMapLayers(t: Terrain, style: MapStyle): MapLayers {
  const n = W * W;
  const ft = new Float32Array(n);
  let lowFt = Infinity;
  for (let i = 0; i < n; i++) {
    ft[i] = t.h[i] * M_TO_FT;
    if (ft[i] < lowFt) lowFt = ft[i];
  }
  const minFt = t.minH * M_TO_FT, maxFt = t.maxH * M_TO_FT;
  const interval = maxFt - minFt > 2200 ? 80 : 40;
  const levels: number[] = [];
  for (let v = Math.ceil(lowFt / interval) * interval; v <= maxFt; v += interval) levels.push(v);
  const lines = contourLevels(ft, W, W, levels.map((v) => v + 1e-3));

  const normal = new Path2D(), index = new Path2D(), bathy = new Path2D(), bathyIndex = new Path2D();
  const labelCands: { ln: Polyline; lv: number }[] = [];
  levels.forEach((lv, k) => {
    const isIndex = Math.round(lv / interval) % 5 === 0;
    if (t.coastal && lv <= 0) {
      if (lv < 0) addLines(isIndex ? bathyIndex : bathy, lines[k]);
      return;
    }
    addLines(isIndex ? index : normal, lines[k]);
    if (isIndex) for (const ln of lines[k]) labelCands.push({ ln, lv });
  });

  const labels: Label[] = [];
  if (style.contourLabels) {
    labelCands.sort((a, b) => b.ln.pts.length - a.ln.pts.length);
    for (const { ln, lv } of labelCands) {
      if (ln.pts.length < 24) continue;
      for (const s of labelSpots(ln.pts, 90, 20 + (lv % 37), 5)) {
        if (s.x < 6 || s.y < 6 || s.x > N - 6 || s.y > N - 6) continue;
        const wx = s.x * CELL, wz = s.y * CELL;
        if (t.sampleGrid(t.water, wx, wz) > -2 || t.isSeaAt(wx, wz)) continue;
        if (labels.some((l) => Math.hypot(l.x - s.x, l.y - s.y) < 30)) continue;
        labels.push({ ...s, text: String(lv) });
      }
    }
  }

  const veg = new Path2D();
  if (style.woodland) addLines(veg, contourSingle(padField(t.veg, 0), W + 2, W + 2, 0.5), -1);
  const glacierFill = new Path2D(), glacierEdge = new Path2D();
  let hasGlacier = false;
  if (t.glacierAt) {
    const fill = contourSingle(padField(t.glacier, 0), W + 2, W + 2, 0.5);
    hasGlacier = fill.length > 0;
    addLines(glacierFill, fill, -1);
    addLines(glacierEdge, contourSingle(t.glacier, W, W, 0.5));
  }
  const marsh = new Path2D();
  const marshLines = contourSingle(padField(t.marsh, 0), W + 2, W + 2, 0.5);
  addLines(marsh, marshLines, -1);
  const lakes = new Path2D();
  addLines(lakes, contourSingle(padField(t.water, NO_WATER), W + 2, W + 2, 0), -1);
  const seaFill = new Path2D(), coast = new Path2D();
  let hasSea = false;
  if (t.coastal) {
    const neg = new Float32Array(n);
    for (let i = 0; i < n; i++) neg[i] = -t.h[i];
    const fill = contourSingle(padField(neg, -50), W + 2, W + 2, 0);
    hasSea = fill.length > 0;
    addLines(seaFill, fill, -1);
    addLines(coast, contourSingle(neg, W, W, 0));
  }

  // Channels: thin streams as single lines, wide rivers at true width. Runs inside
  // lakes or the sea are dropped.
  const streams = [new Path2D(), new Path2D(), new Path2D()];
  const rivers: RiverRun[] = [];
  const inWater = (gx: number, gz: number) => {
    const c = Math.round(gz) * W + Math.round(gx);
    return t.water[c] > 0 || (t.sea ? t.sea[c] === 1 : false);
  };
  for (const r of t.rivers) {
    const m = r.pts.length >> 1;
    let run: number[] = [];
    let runW = 0;
    const flush = () => {
      if (run.length >= 4) {
        const pts = chaikin(Float32Array.from(run), 2);
        if (runW >= 8) rivers.push({ pts, width: runW });
        else tracePolyline(streams[runW <= 2 ? 0 : runW <= 4 ? 1 : 2], pts, false);
      }
      run = [];
    };
    for (let i = 0; i < m; i++) {
      const x = r.pts[2 * i], z = r.pts[2 * i + 1];
      const wBucket = r.width[i] >= 8 ? Math.round(r.width[i] / 4) * 4 : r.width[i] < 3.5 ? 2 : r.width[i] < 6 ? 4 : 7;
      const wet = inWater(x, z);
      if (wet && i > 0) {
        // keep the point where the channel meets the water, then stop
        run.push(x, z);
        flush();
        continue;
      }
      if (wet) continue;
      if (run.length && wBucket !== runW) {
        const lx = run[run.length - 2], lz = run[run.length - 1];
        flush();
        run.push(lx, lz);
      }
      runW = wBucket;
      run.push(x, z);
    }
    flush();
  }

  // Hillshade, light from the north-west at 45 degrees.
  const shade = document.createElement('canvas');
  shade.width = shade.height = W;
  const sctx = shade.getContext('2d')!;
  const img = sctx.createImageData(W, W);
  const lx = -0.5, lz = -0.5, ly = 0.7071;
  for (let z = 0; z < W; z++) {
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - 1), x1 = Math.min(W - 1, x + 1), z0 = Math.max(0, z - 1), z1 = Math.min(W - 1, z + 1);
      const gx = (t.h[z * W + x1] - t.h[z * W + x0]) / ((x1 - x0) * CELL);
      const gz = (t.h[z1 * W + x] - t.h[z0 * W + x]) / ((z1 - z0) * CELL);
      const inv = 1 / Math.sqrt(gx * gx + gz * gz + 1);
      const d = (-gx * lx - gz * lz + ly) * inv;
      const v = clamp(0.86 + 0.75 * (d - 0.7071), 0.45, 1) * 255;
      const o = (z * W + x) * 4;
      img.data[o] = v; img.data[o + 1] = v; img.data[o + 2] = v * 0.98; img.data[o + 3] = 255;
    }
  }
  sctx.putImageData(img, 0, 0);

  // Water names.
  const waterLabels: WaterLabel[] = [];
  for (const l of t.lakes) {
    if (!l.name) continue;
    const size = clamp(9 + l.labelR * 0.55, 10, 15);
    waterLabels.push({ x: l.labelX, y: l.labelZ, ang: 0, text: l.name, size, halo: INK.water });
  }
  if (t.seaLabel) waterLabels.push({ x: t.seaLabel.x, y: t.seaLabel.z, ang: 0, text: t.seaLabel.name, size: 16, halo: INK.water });
  if (t.mainRiver) {
    const r = t.rivers[t.mainRiver.index];
    const smooth = chaikin(r.pts, 2);
    const spots = labelSpots(smooth, 50, 40, 9).filter((s) => {
      const c = Math.round(s.y) * W + Math.round(s.x);
      return s.x > 20 && s.y > 20 && s.x < N - 20 && s.y < N - 20 && t.water[c] <= 0 && !(t.sea && t.sea[c]);
    });
    const s = spots[Math.floor(spots.length / 2)];
    if (s) {
      const w = r.width[r.width.length - 1] / CELL;
      const off = w / 2 + 2.2;
      waterLabels.push({
        x: s.x - Math.sin(s.ang) * off, y: s.y + Math.cos(s.ang) * off, ang: s.ang,
        text: t.mainRiver.name, size: 11.5, halo: INK.paper,
      });
    }
  }

  const peaks = t.peaks
    .filter((pk) => t.water[pk.z * W + pk.x] <= NO_WATER)
    .slice(0, 5)
    .map((pk) => ({ x: pk.x, y: pk.z, text: String(Math.round(pk.h * M_TO_FT)) }));

  const dam = t.dam
    ? { ax: t.dam.ax / CELL, ay: t.dam.az / CELL, bx: t.dam.bx / CELL, by: t.dam.bz / CELL, name: t.dam.name }
    : null;
  const falls = t.falls.map((f) => ({ x: f.x / CELL, y: f.z / CELL, ang: f.angle, name: f.name }));

  return {
    normal, index, bathy, bathyIndex, labels, veg, glacierFill, glacierEdge, hasGlacier,
    marsh, hasMarsh: marshLines.length > 0, lakes, seaFill, coast, hasSea, streams, rivers, dam, falls,
    waterLabels, shade, peaks, interval, style,
  };
}

function marshPattern(ctx: CanvasRenderingContext2D, p: number) {
  const tw = Math.round(16 * p), th = Math.round(9 * p);
  const tile = document.createElement('canvas');
  tile.width = tw;
  tile.height = th * 2;
  const c = tile.getContext('2d')!;
  c.strokeStyle = INK.waterLine;
  c.lineWidth = Math.max(1, 0.9 * p);
  c.lineCap = 'round';
  const tuft = (x: number, y: number) => {
    c.beginPath();
    c.moveTo(x - 3.5 * p, y);
    c.lineTo(x + 3.5 * p, y);
    c.moveTo(x, y);
    c.lineTo(x, y - 3 * p);
    c.moveTo(x - 1.6 * p, y);
    c.lineTo(x - 2.6 * p, y - 2.4 * p);
    c.moveTo(x + 1.6 * p, y);
    c.lineTo(x + 2.6 * p, y - 2.4 * p);
    c.stroke();
  };
  tuft(tw * 0.3, th * 0.7);
  tuft(tw * 0.8, th * 1.7);
  return ctx.createPattern(tile, 'repeat')!;
}

export function renderTier(L: MapLayers, S: number, p: number) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d')!;
  const s = S / N;
  const font = L.style.font;
  ctx.fillStyle = INK.paper;
  ctx.fillRect(0, 0, S, S);
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  if (L.style.woodland) {
    ctx.fillStyle = INK.wood;
    ctx.fill(L.veg, 'evenodd');
  }
  if (L.hasGlacier) {
    ctx.fillStyle = INK.glacier;
    ctx.fill(L.glacierFill, 'evenodd');
  }

  ctx.globalCompositeOperation = 'multiply';
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(L.shade, -0.5, -0.5, W, W);
  ctx.globalCompositeOperation = 'source-over';

  ctx.strokeStyle = INK.grid;
  ctx.lineWidth = (0.9 * p) / s;
  ctx.beginPath();
  const km = 1000 / CELL;
  for (let g = km; g < N; g += km) { ctx.moveTo(g, 0); ctx.lineTo(g, N); ctx.moveTo(0, g); ctx.lineTo(N, g); }
  ctx.stroke();

  // Knock label gaps out of the contour lines.
  const fontPx = 11 * p;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = `600 ${fontPx}px ${font}`;
  const boxes = L.labels.map((l) => ({ l, w: (ctx.measureText(l.text).width + 5 * p) / s, h: (fontPx * 0.95) / s }));
  const riverBoxes = L.waterLabels.filter((l) => l.halo === INK.paper).map((l) => {
    ctx.font = `italic 500 ${l.size * p}px ${font}`;
    return { l, w: (ctx.measureText(l.text).width + 6 * p) / s, h: (l.size * p) / s };
  });
  ctx.restore();
  const gaps = new Path2D();
  gaps.rect(-4, -4, N + 8, N + 8);
  for (const { l, w, h } of [...boxes, ...riverBoxes]) {
    const c = Math.cos(l.ang), sn = Math.sin(l.ang);
    const pts = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]
      .map(([u, v]) => [l.x + u * c - v * sn, l.y + u * sn + v * c]);
    gaps.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < 4; i++) gaps.lineTo(pts[i][0], pts[i][1]);
    gaps.closePath();
  }
  const strokeContours = (thin: string, thick: string) => {
    ctx.strokeStyle = thin;
    ctx.lineWidth = (0.7 * p) / s;
    ctx.stroke(L.normal);
    ctx.strokeStyle = thick;
    ctx.lineWidth = (1.55 * p) / s;
    ctx.stroke(L.index);
  };
  ctx.save();
  ctx.clip(gaps, 'evenodd');
  if (L.hasGlacier) {
    // Contours on ice are blue, as on survey maps.
    const outside = new Path2D();
    outside.rect(-4, -4, N + 8, N + 8);
    outside.addPath(L.glacierFill);
    ctx.save();
    ctx.clip(outside, 'evenodd');
    strokeContours(INK.contour, INK.index);
    ctx.restore();
    ctx.save();
    ctx.clip(L.glacierFill, 'evenodd');
    strokeContours(INK.iceContour, INK.iceContour);
    ctx.restore();
  } else {
    strokeContours(INK.contour, INK.index);
  }
  ctx.restore();
  if (L.hasGlacier) {
    ctx.strokeStyle = INK.iceContour;
    ctx.lineWidth = (1 * p) / s;
    ctx.setLineDash([(4 * p) / s, (3 * p) / s]);
    ctx.stroke(L.glacierEdge);
    ctx.setLineDash([]);
  }

  // Sea with depth curves.
  if (L.hasSea) {
    ctx.fillStyle = INK.water;
    ctx.fill(L.seaFill, 'evenodd');
    ctx.strokeStyle = INK.bathy;
    ctx.lineWidth = (0.6 * p) / s;
    ctx.stroke(L.bathy);
    ctx.lineWidth = (1.1 * p) / s;
    ctx.stroke(L.bathyIndex);
    ctx.strokeStyle = INK.waterLine;
    ctx.lineWidth = (1.1 * p) / s;
    ctx.stroke(L.coast);
  }

  // Lakes: tint, stipple, shoreline.
  ctx.fillStyle = INK.water;
  ctx.fill(L.lakes, 'evenodd');
  const dot = document.createElement('canvas');
  dot.width = dot.height = 5;
  const dctx = dot.getContext('2d')!;
  dctx.fillStyle = 'rgba(30, 120, 160, 0.35)';
  dctx.fillRect(1, 1, 1, 1);
  dctx.fillRect(3.5, 3.5, 1, 1);
  const pat = ctx.createPattern(dot, 'repeat')!;
  pat.setTransform(new DOMMatrix().scale(p / s));
  ctx.fillStyle = pat;
  ctx.fill(L.lakes, 'evenodd');
  if (L.hasSea) ctx.fill(L.seaFill, 'evenodd');
  ctx.strokeStyle = INK.waterLine;
  ctx.lineWidth = (1 * p) / s;
  ctx.stroke(L.lakes);

  if (L.hasMarsh) {
    const mp = marshPattern(ctx, p);
    mp.setTransform(new DOMMatrix().scale(1 / s));
    ctx.fillStyle = mp;
    ctx.fill(L.marsh, 'evenodd');
  }

  ctx.strokeStyle = INK.waterLine;
  [0.8, 1.1, 1.45].forEach((wpx, i) => { ctx.lineWidth = (wpx * p) / s; ctx.stroke(L.streams[i]); });
  // Rivers: dark edge first, then the light fill, so wide rivers read as double lines.
  const riverPx = (wm: number) => Math.max((1.6 * p) / s, wm / CELL);
  for (const r of L.rivers) {
    const path = new Path2D();
    tracePolyline(path, r.pts, false);
    ctx.strokeStyle = INK.waterLine;
    ctx.lineWidth = riverPx(r.width) + (1.3 * p) / s;
    ctx.stroke(path);
  }
  for (const r of L.rivers) {
    const path = new Path2D();
    tracePolyline(path, r.pts, false);
    ctx.strokeStyle = INK.water;
    ctx.lineWidth = Math.max(riverPx(r.width) - (0.4 * p) / s, 0.0001);
    ctx.stroke(path);
  }

  if (L.dam) {
    ctx.strokeStyle = INK.dam;
    ctx.lineWidth = (3.2 * p) / s;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(L.dam.ax, L.dam.ay);
    ctx.lineTo(L.dam.bx, L.dam.by);
    ctx.stroke();
    ctx.lineCap = 'round';
  }
  for (const f of L.falls) {
    // A bar across the channel, the survey symbol for falls.
    const nx = Math.cos(f.ang), ny = Math.sin(f.ang);
    const half = (5 * p) / s;
    ctx.strokeStyle = INK.waterText;
    ctx.lineWidth = (2 * p) / s;
    ctx.beginPath();
    ctx.moveTo(f.x - nx * half, f.y - ny * half);
    ctx.lineTo(f.x + nx * half, f.y + ny * half);
    ctx.stroke();
  }

  // Lettering. Names claim space in priority order; a name that would overlap one
  // already placed is left off this zoom level.
  const placed: [number, number, number, number][] = [];
  const box = (x: number, y: number, ang: number, w: number, h: number, align: CanvasTextAlign) => {
    const cx = x * s, cy = y * s;
    const ox = align === 'left' ? w / 2 : align === 'right' ? -w / 2 : 0;
    const c = Math.abs(Math.cos(ang)), sn = Math.abs(Math.sin(ang));
    const hw = (w * c + h * sn) / 2, hh = (w * sn + h * c) / 2;
    const mx = cx + ox * Math.cos(ang), my = cy + ox * Math.sin(ang);
    return [mx - hw, my - hh, mx + hw, my + hh] as [number, number, number, number];
  };
  const free = (b: [number, number, number, number]) =>
    b[0] >= 0 && b[1] >= 0 && b[2] <= S && b[3] <= S && !placed.some((q) => b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1]);
  const text = (
    x: number, y: number, ang: number, str: string, css: string, color: string, halo: string | null,
    align: CanvasTextAlign = 'center', force = false,
  ) => {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = css;
    const w = ctx.measureText(str).width + 4 * p;
    const h = parseFloat(css.match(/([\d.]+)px/)?.[1] ?? '11') * 1.05;
    ctx.restore();
    const b = box(x, y, ang, w, h, align);
    if (!force && !free(b)) return false;
    placed.push(b);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.scale(1 / s, 1 / s);
    ctx.font = css;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    if (halo) {
      ctx.strokeStyle = halo;
      ctx.lineWidth = 3 * p;
      ctx.lineJoin = 'round';
      ctx.strokeText(str, 0, 0);
    }
    ctx.fillStyle = color;
    ctx.fillText(str, 0, 0);
    ctx.restore();
    return true;
  };

  // Contour labels already have gaps cut for them, so they always draw.
  for (const l of L.labels) text(l.x, l.y, l.ang, l.text, `600 ${fontPx}px ${font}`, INK.label, null, 'center', true);
  if (L.dam) {
    const mx = (L.dam.ax + L.dam.bx) / 2, my = (L.dam.ay + L.dam.by) / 2;
    let ang = Math.atan2(L.dam.by - L.dam.ay, L.dam.bx - L.dam.ax);
    if (ang > Math.PI / 2) ang -= Math.PI;
    else if (ang < -Math.PI / 2) ang += Math.PI;
    const off = (11 * p) / s;
    // Try the downstream side first, then the other side of the crest.
    if (!text(mx - Math.sin(ang) * off, my + Math.cos(ang) * off, ang, L.dam.name, `600 ${10 * p}px ${font}`, INK.dam, INK.paper)) {
      text(mx + Math.sin(ang) * off, my - Math.cos(ang) * off, ang, L.dam.name, `600 ${10 * p}px ${font}`, INK.dam, INK.paper);
    }
  }
  for (const f of L.falls) {
    if (!f.name) continue;
    if (!text(f.x + (7 * p) / s, f.y, 0, f.name, `italic 500 ${10.5 * p}px ${font}`, INK.waterText, INK.paper, 'left')) {
      text(f.x - (7 * p) / s, f.y, 0, f.name, `italic 500 ${10.5 * p}px ${font}`, INK.waterText, INK.paper, 'right');
    }
  }
  for (const l of L.waterLabels) {
    const css = `italic 500 ${l.size * p}px ${font}`;
    if (!text(l.x, l.y, l.ang, l.text, css, INK.waterText, l.halo) && l.ang === 0) {
      // Small lakes: try just below, then above, the label point.
      const dy = ((l.size + 4) * p) / s;
      if (!text(l.x, l.y + dy, 0, l.text, css, INK.waterText, INK.paper)) text(l.x, l.y - dy, 0, l.text, css, INK.waterText, INK.paper);
    }
  }

  for (const pk of L.peaks) {
    const r = 3 * p;
    ctx.save();
    ctx.translate(pk.x, pk.y);
    ctx.scale(1 / s, 1 / s);
    ctx.strokeStyle = INK.spot;
    ctx.lineWidth = 1.3 * p;
    ctx.beginPath();
    ctx.moveTo(-r, -r); ctx.lineTo(r, r); ctx.moveTo(r, -r); ctx.lineTo(-r, r);
    ctx.stroke();
    ctx.restore();
    text(pk.x + (r + 3 * p) / s, pk.y - (r + 6 * p) / s, 0, pk.text, `italic 500 ${10.5 * p}px ${font}`, INK.spot, null, 'left');
  }
  return cv;
}

// ---------------------------------------------------------------------------

export type MapMode = 'guess' | 'view' | 'profile';
export interface Pt { x: number; z: number }
export interface Guess extends Pt { bearing: number | null }
export interface OtherGuess extends Pt { bearing: number | null; color: string; label: string }

export interface MapCallbacks {
  onGuess?(g: Guess | null): void;
  onHover?(p: Pt | null): void;
  onProfile?(a: Pt, b: Pt): void;
  /** A plain wheel scroll passed through to the page because zoom needs Ctrl/⌘. */
  onWheelPassed?(): void;
}

export interface MapOptions {
  /** 'modifier': only Ctrl/⌘ + wheel zooms, so the page keeps scrolling over an embedded map. */
  wheel?: 'always' | 'modifier';
}

type Drag =
  | { mode: 'pan'; x: number; y: number }
  | { mode: 'pinch'; dist: number; mx: number; my: number }
  | { mode: 'aim' }
  | { mode: 'move'; ox: number; oy: number }
  | { mode: 'place'; sx: number; sy: number }
  | { mode: 'profile'; a: Pt };

export class MapView {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cb: MapCallbacks;
  private layers: MapLayers | null = null;
  private tiers = new Map<number, HTMLCanvasElement | null>();
  private D = 0;
  private dpr = 1;
  zoom = 1;
  cx = N / 2;
  cy = N / 2;
  mode: MapMode = 'view';
  guess: Guess | null = null;
  answer: (Pt & { bearing: number }) | null = null;
  area: (Pt & { r: number }) | null = null;
  others: OtherGuess[] = [];
  profile: { a: Pt; b: Pt } | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private drag: Drag | null = null;
  private anim = 0;
  private pending = false;
  private disposed = false;
  private unbind: () => void;
  private wheelMode: 'always' | 'modifier';

  constructor(canvas: HTMLCanvasElement, cb: MapCallbacks = {}, opts: MapOptions = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.cb = cb;
    this.wheelMode = opts.wheel ?? 'always';
    this.unbind = this.bindEvents();
    this.resize();
  }

  destroy() {
    this.disposed = true;
    this.unbind();
    if (this.anim) cancelAnimationFrame(this.anim);
  }

  setCallbacks(cb: MapCallbacks) { this.cb = cb; }

  setLayers(layers: MapLayers | null) {
    this.layers = layers;
    this.tiers.clear();
    this.zoom = 1; this.cx = N / 2; this.cy = N / 2;
    this.guess = null; this.answer = null; this.area = null; this.others = []; this.profile = null;
    if (layers) {
      this.ensureTier(1, true);
      setTimeout(() => this.ensureTier(2, false), 400);
    }
    this.requestDraw();
  }

  setMode(mode: MapMode) {
    this.mode = mode;
    this.canvas.dataset.mode = mode;
    this.requestDraw();
  }

  setGuess(g: Guess | null) { this.guess = g; this.requestDraw(); }
  setAnswer(a: (Pt & { bearing: number }) | null) { this.answer = a; this.requestDraw(); }
  setArea(a: (Pt & { r: number }) | null) { this.area = a; this.requestDraw(); }
  setOthers(o: OtherGuess[]) { this.others = o; this.requestDraw(); }
  setProfile(p: { a: Pt; b: Pt } | null) { this.profile = p; this.requestDraw(); }

  /** Animate the view to frame the given points. */
  fit(points: Pt[], pad = 45) {
    if (!points.length) return;
    const xs = points.map((p) => p.x / CELL), ys = points.map((p) => p.z / CELL);
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) + pad * 2;
    const z = clamp(N / span, 1, 3.2);
    this.animateTo(z, (Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2);
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const D = Math.max(50, Math.round(rect.width));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (D === this.D && dpr === this.dpr) return;
    this.D = D;
    this.dpr = dpr;
    this.canvas.width = Math.round(D * dpr);
    this.canvas.height = Math.round(D * dpr);
    this.tiers.clear();
    if (this.layers) this.ensureTier(1, true);
    this.requestDraw();
  }

  private tierSize(tier: number) {
    const S = Math.min(4096, Math.round(this.D * this.dpr * tier));
    return { S, p: S / (this.D * tier) };
  }

  private ensureTier(tier: number, sync: boolean) {
    if (!this.layers || this.tiers.has(tier)) return;
    const build = () => {
      if (this.disposed || this.tiers.get(tier) || !this.layers) return;
      const { S, p } = this.tierSize(tier);
      this.tiers.set(tier, renderTier(this.layers, S, p));
      this.requestDraw();
    };
    if (sync) build();
    else {
      this.tiers.set(tier, null);
      setTimeout(build, 30);
    }
  }

  get scale() { return (this.D / N) * this.zoom; }
  toScreen(gx: number, gy: number): [number, number] {
    return [(gx - this.cx) * this.scale + this.D / 2, (gy - this.cy) * this.scale + this.D / 2];
  }
  toGrid(sx: number, sy: number): [number, number] {
    return [(sx - this.D / 2) / this.scale + this.cx, (sy - this.D / 2) / this.scale + this.cy];
  }

  private clampView() {
    this.zoom = clamp(this.zoom, 1, 8);
    const half = N / (2 * this.zoom);
    this.cx = clamp(this.cx, half, N - half);
    this.cy = clamp(this.cy, half, N - half);
  }

  zoomAt(factor: number, sx: number, sy: number) {
    const [gx, gy] = this.toGrid(sx, sy);
    this.zoom = clamp(this.zoom * factor, 1, 8);
    this.cx = gx - (sx - this.D / 2) / this.scale;
    this.cy = gy - (sy - this.D / 2) / this.scale;
    this.clampView();
    this.requestDraw();
  }

  zoomBy(factor: number) { this.zoomAt(factor, this.D / 2, this.D / 2); }
  resetView() { this.animateTo(1, N / 2, N / 2); }

  private animateTo(zoom: number, cx: number, cy: number) {
    const from = { zoom: this.zoom, cx: this.cx, cy: this.cy };
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const t0 = performance.now(), dur = reduce ? 0 : 520;
    const step = (now: number) => {
      if (this.disposed) return;
      const k = dur ? clamp((now - t0) / dur, 0, 1) : 1;
      const e = 1 - Math.pow(1 - k, 3);
      this.zoom = from.zoom + (zoom - from.zoom) * e;
      this.cx = from.cx + (cx - from.cx) * e;
      this.cy = from.cy + (cy - from.cy) * e;
      this.clampView();
      this.draw();
      this.anim = k < 1 ? requestAnimationFrame(step) : 0;
    };
    if (this.anim) cancelAnimationFrame(this.anim);
    this.anim = requestAnimationFrame(step);
  }

  requestDraw() {
    if (this.pending || this.disposed) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      if (!this.disposed) this.draw();
    });
  }

  // ---- input ----
  private bindEvents() {
    const cv = this.canvas;
    const ctxMenu = (e: Event) => e.preventDefault();
    const wheel = (e: WheelEvent) => {
      if (this.wheelMode === 'modifier' && !(e.ctrlKey || e.metaKey)) {
        this.cb.onWheelPassed?.();
        return;
      }
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      this.zoomAt(Math.exp(-dy * 0.0016), e.clientX - r.left, e.clientY - r.top);
    };
    const down = (e: PointerEvent) => this.onDown(e);
    const move = (e: PointerEvent) => this.onMove(e);
    const up = (e: PointerEvent) => this.onUp(e);
    const leave = () => { if (!this.pointers.size) this.cb.onHover?.(null); };
    cv.addEventListener('contextmenu', ctxMenu);
    cv.addEventListener('wheel', wheel, { passive: false });
    cv.addEventListener('pointerdown', down);
    cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointerleave', leave);
    return () => {
      cv.removeEventListener('contextmenu', ctxMenu);
      cv.removeEventListener('wheel', wheel);
      cv.removeEventListener('pointerdown', down);
      cv.removeEventListener('pointermove', move);
      cv.removeEventListener('pointerup', up);
      cv.removeEventListener('pointercancel', up);
      cv.removeEventListener('pointerleave', leave);
    };
  }

  private local(e: PointerEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  private world(sx: number, sy: number): Pt {
    const [gx, gy] = this.toGrid(sx, sy);
    return { x: clamp(gx, 0, N) * CELL, z: clamp(gy, 0, N) * CELL };
  }

  private onDown(e: PointerEvent) {
    const [x, y] = this.local(e);
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x, y });
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.drag = { mode: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      return;
    }
    if (this.pointers.size > 2) return;
    const pan = e.button === 1 || e.button === 2 || e.shiftKey || this.mode === 'view';
    if (pan) { this.drag = { mode: 'pan', x, y }; return; }
    if (e.button !== 0) return;
    if (this.mode === 'profile') {
      const a = this.world(x, y);
      this.profile = { a, b: a };
      this.drag = { mode: 'profile', a };
      this.requestDraw();
      return;
    }
    const g = this.guess;
    if (g) {
      const [px, py] = this.toScreen(g.x / CELL, g.z / CELL);
      if (g.bearing != null) {
        const tx = px + Math.sin(g.bearing) * 66, ty = py - Math.cos(g.bearing) * 66;
        if (Math.hypot(x - tx, y - ty) < 16) { this.drag = { mode: 'aim' }; return; }
      }
      if (Math.hypot(x - px, y - py) < 13) { this.drag = { mode: 'move', ox: x - px, oy: y - py }; return; }
    }
    const w = this.world(x, y);
    this.guess = { ...w, bearing: g ? g.bearing : null };
    this.drag = { mode: 'place', sx: x, sy: y };
    this.changed();
  }

  private onMove(e: PointerEvent) {
    const [x, y] = this.local(e);
    if (!this.pointers.has(e.pointerId)) {
      if (e.pointerType === 'mouse') {
        const [gx, gy] = this.toGrid(x, y);
        this.cb.onHover?.(gx >= 0 && gy >= 0 && gx <= N && gy <= N ? { x: gx * CELL, z: gy * CELL } : null);
      }
      return;
    }
    this.pointers.set(e.pointerId, { x, y });
    const d = this.drag;
    if (!d) return;
    if (d.mode === 'pinch') {
      if (this.pointers.size < 2) return;
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      this.cx -= (mx - d.mx) / this.scale;
      this.cy -= (my - d.my) / this.scale;
      this.zoomAt(dist / (d.dist || 1), mx, my);
      d.dist = dist; d.mx = mx; d.my = my;
      return;
    }
    if (d.mode === 'pan') {
      this.cx -= (x - d.x) / this.scale;
      this.cy -= (y - d.y) / this.scale;
      d.x = x; d.y = y;
      this.clampView();
      this.requestDraw();
      return;
    }
    if (d.mode === 'profile') {
      this.profile = { a: d.a, b: this.world(x, y) };
      this.requestDraw();
      return;
    }
    const g = this.guess;
    if (!g) return;
    if (d.mode === 'move') {
      const w = this.world(x - d.ox, y - d.oy);
      g.x = w.x; g.z = w.z;
      this.changed();
      return;
    }
    const [px, py] = this.toScreen(g.x / CELL, g.z / CELL);
    if (d.mode === 'place' && Math.hypot(x - d.sx, y - d.sy) < 9) return;
    g.bearing = (Math.atan2(x - px, -(y - py)) + 2 * Math.PI) % (2 * Math.PI);
    this.changed();
  }

  private onUp(e: PointerEvent) {
    this.pointers.delete(e.pointerId);
    const d = this.drag;
    if (d && d.mode === 'profile' && this.profile) {
      const { a, b } = this.profile;
      if (Math.hypot(b.x - a.x, b.z - a.z) > 60) this.cb.onProfile?.(a, b);
      else this.profile = null;
      this.requestDraw();
    }
    if (this.pointers.size === 0) this.drag = null;
    else if (d && d.mode === 'pinch') {
      const [a] = [...this.pointers.values()];
      this.drag = { mode: 'pan', x: a.x, y: a.y };
    }
  }

  private changed() {
    this.requestDraw();
    this.cb.onGuess?.(this.guess ? { ...this.guess } : null);
  }

  // ---- drawing ----
  draw() {
    const { ctx, D, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = INK.collar;
    ctx.fillRect(0, 0, D, D);
    if (!this.layers) return;
    const want = this.zoom <= 1.3 ? 1 : this.zoom <= 2.6 ? 2 : 4;
    this.ensureTier(want, false);
    let img = this.tiers.get(want) ?? null;
    if (!img) for (const t of [4, 2, 1]) { const c = this.tiers.get(t); if (c) { img = c; break; } }
    if (img) {
      const sc = (this.scale * N) / img.width;
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.translate(D / 2 - this.cx * this.scale, D / 2 - this.cy * this.scale);
      ctx.scale(sc, sc);
      ctx.drawImage(img, 0, 0);
      ctx.restore();
    }
    if (this.area) this.drawArea();
    if (this.profile) this.drawProfileLine();
    for (const o of this.others) this.drawOther(o);
    if (this.answer) this.drawAnswer();
    if (this.guess) this.drawGuess();
    this.drawFurniture();
  }

  private wedge(x: number, y: number, bearing: number, r: number, color: string) {
    const { ctx } = this;
    const a0 = bearing - HFOV / 2 - Math.PI / 2, a1 = bearing + HFOV / 2 - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, r, a0, a1);
    ctx.closePath();
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, color + '55');
    grad.addColorStop(1, color + '08');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = color + 'aa';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private arrow(x: number, y: number, bearing: number, len: number, color: string, width = 2.5) {
    const { ctx } = this;
    const dx = Math.sin(bearing), dy = -Math.cos(bearing);
    const tx = x + dx * len, ty = y + dy * len;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x + dx * 10, y + dy * 10);
    ctx.lineTo(tx - dx * 6, ty - dy * 6);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(tx + dx * 4, ty + dy * 4);
    ctx.lineTo(tx - dx * 9 - dy * 6, ty - dy * 9 + dx * 6);
    ctx.lineTo(tx - dx * 9 + dy * 6, ty - dy * 9 - dx * 6);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    return [tx, ty];
  }

  private ring(x: number, y: number, color: string, r = 9) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  private drawGuess() {
    const g = this.guess!;
    const [x, y] = this.toScreen(g.x / CELL, g.z / CELL);
    if (g.bearing != null) {
      this.wedge(x, y, g.bearing, 120, GUESS_COLOR);
      const [tx, ty] = this.arrow(x, y, g.bearing, 66, GUESS_COLOR);
      if (this.mode === 'guess') {
        this.ctx.beginPath();
        this.ctx.arc(tx, ty, 9, 0, Math.PI * 2);
        this.ctx.strokeStyle = GUESS_COLOR + '66';
        this.ctx.lineWidth = 1.5;
        this.ctx.stroke();
      }
    }
    this.ring(x, y, GUESS_COLOR);
  }

  private drawOther(o: OtherGuess) {
    const { ctx } = this;
    const [x, y] = this.toScreen(o.x / CELL, o.z / CELL);
    if (o.bearing != null) this.arrow(x, y, o.bearing, 44, o.color, 2);
    this.ring(x, y, o.color, 7);
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.strokeText(o.label, x + 11, y + 1);
    ctx.fillStyle = '#1d1712';
    ctx.fillText(o.label, x + 11, y + 1);
  }

  private drawArea() {
    const { ctx } = this;
    const a = this.area!;
    const [x, y] = this.toScreen(a.x / CELL, a.z / CELL);
    const r = (a.r / CELL) * this.scale;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(209, 48, 124, 0.07)';
    ctx.fill();
    ctx.setLineDash([7, 5]);
    ctx.strokeStyle = 'rgba(209, 48, 124, 0.85)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private drawProfileLine() {
    const { ctx } = this;
    const { a, b } = this.profile!;
    const [ax, ay] = this.toScreen(a.x / CELL, a.z / CELL);
    const [bx, by] = this.toScreen(b.x / CELL, b.z / CELL);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    ctx.strokeStyle = '#1d1712';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [px, py, l] of [[ax, ay, 'A'], [bx, by, 'B']] as const) {
      ctx.beginPath(); ctx.arc(px, py, 9, 0, Math.PI * 2);
      ctx.fillStyle = '#1d1712'; ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillText(l, px, py + 0.5);
    }
  }

  private drawAnswer() {
    const { ctx } = this;
    const a = this.answer!;
    const [x, y] = this.toScreen(a.x / CELL, a.z / CELL);
    this.wedge(x, y, a.bearing, 150, ANSWER_COLOR);
    if (this.guess) {
      const [gx, gy] = this.toScreen(this.guess.x / CELL, this.guess.z / CELL);
      ctx.setLineDash([2, 5]);
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#2a2018';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(x, y); ctx.stroke();
      ctx.setLineDash([]);
      const d = Math.hypot(this.guess.x - a.x, this.guess.z - a.z);
      const label = d >= 1000 ? `${(d / 1000).toFixed(2)} km` : `${Math.round(d)} m`;
      if (Math.hypot(gx - x, gy - y) > 60) {
        ctx.font = `700 13px ${this.layers?.style.font ?? 'sans-serif'}`;
        const mx = (gx + x) / 2, my = (gy + y) / 2, w = ctx.measureText(label).width + 10;
        ctx.fillStyle = 'rgba(42,32,24,0.86)';
        ctx.fillRect(mx - w / 2, my - 10, w, 20);
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, mx, my + 1);
      }
    }
    // Start triangle pointing along the true bearing.
    const r = 12, b = a.bearing;
    const pt = (ang: number, rad: number): [number, number] => [x + Math.sin(ang) * rad, y - Math.cos(ang) * rad];
    const tri = [pt(b, r * 1.25), pt(b + 2.3, r), pt(b - 2.3, r)];
    ctx.beginPath();
    ctx.moveTo(...tri[0]); ctx.lineTo(...tri[1]); ctx.lineTo(...tri[2]); ctx.closePath();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 5; ctx.stroke();
    ctx.strokeStyle = ANSWER_COLOR; ctx.lineWidth = 2.8; ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fillStyle = ANSWER_COLOR; ctx.fill();
  }

  private drawFurniture() {
    const { ctx, D } = this;
    const font = this.layers?.style.font ?? 'sans-serif';
    ctx.save();
    ctx.translate(26, 34);
    ctx.fillStyle = 'rgba(247,244,234,0.85)';
    ctx.beginPath(); ctx.arc(0, -2, 17, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2a2018';
    ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(6, 6); ctx.lineTo(0, 2); ctx.lineTo(-6, 6); ctx.closePath(); ctx.fill();
    ctx.font = `700 10px ${font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f7f4ea';
    ctx.fillText('N', 0, -2);
    ctx.restore();

    const mPerPx = CELL / this.scale;
    const target = D * 0.22 * mPerPx;
    const nice = [100, 200, 250, 500, 1000, 2000];
    const len = nice.reduce((best, v) => (Math.abs(v - target) < Math.abs(best - target) ? v : best), nice[0]);
    const px = len / mPerPx;
    const x0 = 14, y0 = D - 18;
    ctx.fillStyle = 'rgba(247,244,234,0.85)';
    ctx.fillRect(x0 - 6, y0 - 20, px + 46, 30);
    ctx.fillStyle = '#2a2018';
    ctx.fillRect(x0, y0, px, 4);
    ctx.fillStyle = '#f7f4ea';
    ctx.fillRect(x0 + px / 2, y0 + 1, px / 2 - 1, 2);
    ctx.font = `600 11px ${font}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#2a2018';
    ctx.fillText('0', x0 - 2, y0 - 5);
    ctx.fillText(len >= 1000 ? `${len / 1000} km` : `${len} m`, x0 + px - 6, y0 - 5);
  }
}

