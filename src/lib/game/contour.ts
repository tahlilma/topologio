// Marching squares over a scalar grid, producing joined polylines in grid coordinates.

export interface Polyline {
  /** x0,y0,x1,y1,... in grid units. */
  pts: Float32Array;
  closed: boolean;
}

// Segment table: for each corner case, pairs of edges (0 top, 1 right, 2 bottom, 3 left).
// Saddles (5, 10) are resolved per cell from the centre value.
const CASES: (number[] | null)[] = [
  [], [3, 2], [2, 1], [3, 1], [0, 1], null, [0, 2], [0, 3],
  [0, 3], [0, 2], null, [0, 1], [3, 1], [2, 1], [3, 2], [],
];

/** Contours evenly spaced levels at once; returns one polyline list per level. */
export function contourLevels(field: Float32Array, w: number, h: number, levels: number[]): Polyline[][] {
  const nL = levels.length;
  const segs: number[][] = Array.from({ length: nL }, () => []);
  if (!nL) return [];
  const lo = levels[0], hi = levels[nL - 1];
  const step = nL > 1 ? levels[1] - levels[0] : 1;
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const i = y * w + x;
      const a = field[i], b = field[i + 1], c = field[i + w + 1], d = field[i + w];
      const mn = Math.min(a, b, c, d), mx = Math.max(a, b, c, d);
      if (mx < lo || mn > hi) continue;
      const k0 = Math.max(0, Math.ceil((mn - lo) / step - 1e-9));
      const k1 = Math.min(nL - 1, Math.floor((mx - lo) / step + 1e-9));
      for (let k = k0; k <= k1; k++) cellSegments(segs[k], levels[k], x, y, w, a, b, c, d);
    }
  }
  return segs.map((s, k) => joinSegments(s, field, w, levels[k]));
}

export function contourSingle(field: Float32Array, w: number, h: number, level: number) {
  return contourLevels(field, w, h, [level])[0];
}

function cellSegments(out: number[], L: number, x: number, y: number, w: number, a: number, b: number, c: number, d: number) {
  const idx = (a >= L ? 8 : 0) | (b >= L ? 4 : 0) | (c >= L ? 2 : 0) | (d >= L ? 1 : 0);
  if (idx === 0 || idx === 15) return;
  let pairs = CASES[idx];
  if (pairs === null) {
    const centreHigh = (a + b + c + d) / 4 >= L;
    if (idx === 5) pairs = centreHigh ? [0, 3, 2, 1] : [3, 2, 0, 1];
    else pairs = centreHigh ? [0, 1, 3, 2] : [0, 3, 2, 1];
  }
  for (let p = 0; p < pairs.length; p += 2) out.push(edgeId(pairs[p], x, y, w), edgeId(pairs[p + 1], x, y, w));
}

// Horizontal edge (x,y)-(x+1,y): even id. Vertical edge (x,y)-(x,y+1): odd id.
function edgeId(e: number, x: number, y: number, w: number) {
  switch (e) {
    case 0: return (y * w + x) * 2;
    case 1: return (y * w + x + 1) * 2 + 1;
    case 2: return ((y + 1) * w + x) * 2;
    default: return (y * w + x) * 2 + 1;
  }
}

function edgePoint(id: number, field: Float32Array, w: number, L: number, out: Float32Array, o: number) {
  const e = id >> 1, x = e % w, y = (e / w) | 0;
  const a = field[e];
  if ((id & 1) === 0) {
    const b = field[e + 1];
    out[o] = x + (L - a) / (b - a || 1e-9);
    out[o + 1] = y;
  } else {
    const b = field[e + w];
    out[o] = x;
    out[o + 1] = y + (L - a) / (b - a || 1e-9);
  }
}

function joinSegments(s: number[], field: Float32Array, w: number, L: number): Polyline[] {
  const nSeg = s.length >> 1;
  if (!nSeg) return [];
  const first = new Map<number, number>(), second = new Map<number, number>();
  for (let i = 0; i < nSeg; i++) {
    for (const e of [s[2 * i], s[2 * i + 1]]) {
      if (first.has(e)) second.set(e, i);
      else first.set(e, i);
    }
  }
  const other = (e: number, seg: number) => {
    const f = first.get(e);
    if (f !== undefined && f !== seg) return f;
    const g = second.get(e);
    return g !== undefined && g !== seg ? g : -1;
  };
  const used = new Uint8Array(nSeg);
  const lines: Polyline[] = [];
  for (let s0 = 0; s0 < nSeg; s0++) {
    if (used[s0]) continue;
    used[s0] = 1;
    const fwd = [s[2 * s0], s[2 * s0 + 1]];
    let closed = false;
    let e = fwd[1], seg = s0;
    for (;;) {
      const t = other(e, seg);
      if (t < 0 || used[t]) break;
      used[t] = 1;
      const e2 = s[2 * t] === e ? s[2 * t + 1] : s[2 * t];
      if (e2 === fwd[0]) { closed = true; break; }
      fwd.push(e2);
      e = e2;
      seg = t;
    }
    let ids = fwd;
    if (!closed) {
      const back: number[] = [];
      e = fwd[0];
      seg = s0;
      for (;;) {
        const t = other(e, seg);
        if (t < 0 || used[t]) break;
        used[t] = 1;
        const e2 = s[2 * t] === e ? s[2 * t + 1] : s[2 * t];
        back.push(e2);
        e = e2;
        seg = t;
      }
      ids = back.reverse().concat(fwd);
    }
    const pts = new Float32Array(ids.length * 2);
    for (let i = 0; i < ids.length; i++) edgePoint(ids[i], field, w, L, pts, i * 2);
    lines.push({ pts, closed });
  }
  return lines;
}

/** Path-like target shared by Path2D and CanvasRenderingContext2D. */
export interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void;
  closePath(): void;
}

/** Appends a polyline as a smooth curve through segment midpoints. */
export function tracePolyline(path: PathSink, pts: ArrayLike<number>, closed: boolean, sx = 1, ox = 0) {
  const n = pts.length >> 1;
  if (n < 2) return;
  const X = (i: number) => pts[2 * i] * sx + ox, Y = (i: number) => pts[2 * i + 1] * sx + ox;
  if (closed && n > 2) {
    path.moveTo((X(n - 1) + X(0)) / 2, (Y(n - 1) + Y(0)) / 2);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      path.quadraticCurveTo(X(i), Y(i), (X(i) + X(j)) / 2, (Y(i) + Y(j)) / 2);
    }
    path.closePath();
  } else {
    path.moveTo(X(0), Y(0));
    for (let i = 1; i < n - 1; i++) path.quadraticCurveTo(X(i), Y(i), (X(i) + X(i + 1)) / 2, (Y(i) + Y(i + 1)) / 2);
    path.lineTo(X(n - 1), Y(n - 1));
  }
}

/** Chaikin corner cutting; keeps the end points of open lines. */
export function chaikin(pts: Float32Array, iterations = 2): Float32Array {
  let cur = pts;
  for (let it = 0; it < iterations; it++) {
    const n = cur.length >> 1;
    if (n < 3) return cur;
    const out = new Float32Array((2 * (n - 1)) * 2);
    let o = 0;
    out[o++] = cur[0];
    out[o++] = cur[1];
    for (let i = 0; i < n - 1; i++) {
      const x0 = cur[2 * i], y0 = cur[2 * i + 1], x1 = cur[2 * i + 2], y1 = cur[2 * i + 3];
      if (i > 0) { out[o++] = 0.75 * x0 + 0.25 * x1; out[o++] = 0.75 * y0 + 0.25 * y1; }
      if (i < n - 2) { out[o++] = 0.25 * x0 + 0.75 * x1; out[o++] = 0.25 * y0 + 0.75 * y1; }
    }
    out[o++] = cur[2 * n - 2];
    out[o++] = cur[2 * n - 1];
    cur = out.subarray(0, o);
  }
  return cur;
}
