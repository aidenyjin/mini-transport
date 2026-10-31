// Road graph: intersections, road segments and their lanes, lane geometry, and routing
// for cars, buses and people on foot.

import { C } from './config.js';
import { LANE_CAR, LANE_BUS, clamp, dist } from './model.js';

export class RoadNetwork {
  constructor() {
    this.nodes = [];
    this.segs = [];
    this.version = 0;          // bumps whenever lanes change in a way that affects routing
    this._laneId = 0;
    this._driveCache = new Map();
    this._driveCacheVersion = -1;
    this._walkD = null;        // all-pairs walking distances between nodes
    this._walkPrev = null;
  }

  addNode(x, y) {
    const n = { id: this.nodes.length, x, y, segs: [], hx: 0, hy: 0 };
    this.nodes.push(n);
    return n.id;
  }

  // spec: list of [dir, type] from left to right looking from a to b.
  addSegment(a, b, spec) {
    const A = this.nodes[a], B = this.nodes[b];
    const dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy);
    const s = {
      id: this.segs.length, a, b, lanes: [], width: 0, length: L,
      dx: dx / L, dy: dy / L, rx: -dy / L, ry: dx / L, bridge: false,
    };
    for (const [dir, type] of spec) {
      const lane = this.makeLane(s, dir, type);
      lane.w = C.LANE_W;
      s.lanes.push(lane);
    }
    this.segs.push(s);
    A.segs.push(s.id);
    B.segs.push(s.id);
    return s.id;
  }

  makeLane(s, dir, type) {
    return {
      id: this._laneId++, seg: s.id, dir, type, w: 0, closing: false, flip: false,
      vehicles: [], reserved: 0, p0: { x: 0, y: 0 }, p1: { x: 0, y: 0 },
      dx: 1, dy: 0, length: 1, offset: 0,
    };
  }

  findSegment(a, b) {
    for (const sid of this.nodes[a].segs) {
      const s = this.segs[sid];
      if ((s.a === a && s.b === b) || (s.a === b && s.b === a)) return sid;
    }
    return -1;
  }

  other(sid, node) {
    const s = this.segs[sid];
    return s.a === node ? s.b : s.a;
  }

  isHorizontal(sid) {
    const s = this.segs[sid];
    return Math.abs(s.dx) >= Math.abs(s.dy);
  }

  // --- Geometry ----------------------------------------------------------------

  // Animates lane widths, finishes pending lane removals and flips, and recomputes
  // where every lane starts and ends.
  update(dt) {
    const k = 1 - Math.exp(-dt * C.LANE_ANIM);
    for (const s of this.segs) {
      let total = 0;
      for (let i = s.lanes.length - 1; i >= 0; i--) {
        const l = s.lanes[i];
        const empty = l.vehicles.length === 0 && l.reserved <= 0.01;
        if (l.flip && empty) {
          l.dir = -l.dir;
          l.flip = false;
          this.version++;
        }
        const target = l.closing && empty ? 0 : C.LANE_W;
        l.w += (target - l.w) * k;
        if (l.closing && empty && l.w < 0.3) {
          s.lanes.splice(i, 1);
          continue;
        }
        total += l.w;
      }
      s.lanesW = total;
      s.width = s.lanes.length ? Math.max(C.PED_W, total + 2 * C.CURB) : C.PED_W;
    }
    for (const n of this.nodes) {
      let hx = 0, hy = 0;
      for (const sid of n.segs) {
        const s = this.segs[sid];
        if (!s.lanes.length) continue;
        if (Math.abs(s.dy) > 0.7) hx = Math.max(hx, s.width / 2);
        else hy = Math.max(hy, s.width / 2);
      }
      n.hx = hx;
      n.hy = hy;
    }
    for (const s of this.segs) {
      const A = this.nodes[s.a], B = this.nodes[s.b];
      const ia = this.inset(s.a, s.id), ib = this.inset(s.b, s.id);
      let x = -s.lanesW / 2;
      for (const l of s.lanes) {
        const off = x + l.w / 2;
        x += l.w;
        l.offset = off;
        const ax = A.x + s.dx * ia + s.rx * off, ay = A.y + s.dy * ia + s.ry * off;
        const bx = B.x - s.dx * ib + s.rx * off, by = B.y - s.dy * ib + s.ry * off;
        const from = l.dir > 0 ? [ax, ay] : [bx, by];
        const to = l.dir > 0 ? [bx, by] : [ax, ay];
        l.p0.x = from[0]; l.p0.y = from[1];
        l.p1.x = to[0]; l.p1.y = to[1];
        l.length = Math.max(1, Math.hypot(bx - ax, by - ay));
        l.dx = (l.p1.x - l.p0.x) / l.length;
        l.dy = (l.p1.y - l.p0.y) / l.length;
      }
    }
  }

  // How far from a node's centre a road's lanes begin.
  inset(node, sid) {
    const n = this.nodes[node], s = this.segs[sid];
    return Math.abs(s.dx) * n.hx + Math.abs(s.dy) * n.hy;
  }

  segPoint(sid, t) {
    const s = this.segs[sid], A = this.nodes[s.a], B = this.nodes[s.b];
    return { x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t };
  }

  sidewalk(sid, t, side) {
    const s = this.segs[sid], p = this.segPoint(sid, t);
    const off = side * (s.width / 2 + C.SIDEWALK);
    return { x: p.x + s.rx * off, y: p.y + s.ry * off };
  }

  // Sidewalk point just short of a road's end at `node`.
  sidewalkEnd(sid, node, side) {
    const s = this.segs[sid];
    const d = (this.inset(node, sid) + C.SIDEWALK + 1) / s.length;
    return this.sidewalk(sid, s.a === node ? d : 1 - d, side);
  }

  tOf(sid, p) {
    const s = this.segs[sid], A = this.nodes[s.a];
    return clamp(((p.x - A.x) * s.dx + (p.y - A.y) * s.dy) / s.length, 0, 1);
  }

  sideOf(sid, p) {
    const s = this.segs[sid], A = this.nodes[s.a];
    return (p.x - A.x) * s.rx + (p.y - A.y) * s.ry >= 0 ? 1 : -1;
  }

  distToSeg(sid, p) {
    return dist(p, this.segPoint(sid, this.tOf(sid, p)));
  }

  segmentAt(p, pad = 4) {
    let best = -1, bd = Infinity;
    for (const s of this.segs) {
      const d = this.distToSeg(s.id, p);
      if (d <= s.width / 2 + pad && d < bd) { bd = d; best = s.id; }
    }
    return best;
  }

  nearestPlace(p) {
    let best = 0, bd = Infinity;
    for (const s of this.segs) {
      const d = this.distToSeg(s.id, p);
      if (d < bd) { bd = d; best = s.id; }
    }
    return { x: p.x, y: p.y, seg: best, t: this.tOf(best, p), side: this.sideOf(best, p) };
  }

  // All the segments in a straight line with this one.
  streetOf(sid) {
    const out = [sid];
    const s0 = this.segs[sid];
    for (const start of [s0.b, s0.a]) {
      let cur = sid, node = start;
      for (let guard = 0; guard < 100; guard++) {
        const cs = this.segs[cur];
        let next = -1;
        for (const o of this.nodes[node].segs) {
          if (o === cur) continue;
          const os = this.segs[o];
          if (Math.abs(os.dx * cs.dx + os.dy * cs.dy) > 0.99) { next = o; break; }
        }
        if (next < 0) break;
        out.push(next);
        cur = next;
        node = this.other(next, node);
      }
    }
    return out;
  }

  // Lanes in the order they appear on screen (top to bottom for horizontal roads, left
  // to right for vertical ones), ignoring lanes that are being removed.
  displayLanes(sid) {
    const s = this.segs[sid];
    const horiz = this.isHorizontal(sid);
    const sign = horiz ? s.ry : s.rx;
    const lanes = s.lanes.filter((l) => !l.closing);
    if (sign < 0) lanes.reverse();
    return { horiz, lanes, reversed: sign < 0 };
  }

  // --- Routing -------------------------------------------------------------------

  laneOk(l, dir, bus) {
    return !l.closing && !l.flip && l.dir === dir && (bus || l.type === LANE_CAR);
  }

  usable(s, dir, bus) {
    for (const l of s.lanes) if (this.laneOk(l, dir, bus)) return true;
    return false;
  }

  usableLanes(s, dir, bus) {
    return s.lanes.filter((l) => this.laneOk(l, dir, bus));
  }

  edgeCost(s, dir, bus, congestion) {
    let c = s.length;
    let n = 0, cap = 0, busLane = false;
    for (const l of s.lanes) {
      if (!this.laneOk(l, dir, bus)) continue;
      if (l.type === LANE_BUS) busLane = true;
      if (bus && busLane && l.type !== LANE_BUS) continue;
      n += l.vehicles.length;
      cap += l.length / (C.CAR_LEN + C.GAP);
    }
    if (bus && busLane) c *= 0.8;
    if (congestion && cap > 0) {
      const occ = n / cap;
      c *= 1 + 3 * occ * occ;
    }
    return c + C.TURN_COST;
  }

  dijkstra(sources, bus, congestion, walk = false) {
    const n = this.nodes.length;
    const d = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const done = new Uint8Array(n);
    for (const [node, c] of sources) if (c < d[node]) d[node] = c;
    for (;;) {
      let u = -1, best = Infinity;
      for (let i = 0; i < n; i++) if (!done[i] && d[i] < best) { best = d[i]; u = i; }
      if (u < 0) break;
      done[u] = 1;
      for (const sid of this.nodes[u].segs) {
        const s = this.segs[sid];
        const dir = s.a === u ? 1 : -1;
        let cost;
        if (walk) cost = s.length;
        else {
          if (!this.usable(s, dir, bus)) continue;
          cost = this.edgeCost(s, dir, bus, congestion);
        }
        const v = dir === 1 ? s.b : s.a;
        if (best + cost < d[v]) { d[v] = best + cost; prev[v] = sid; }
      }
    }
    return { d, prev };
  }

  // Route from a point on one road to a point on another, as [seg, dir] hops.
  // onlyDir forces the starting direction (for vehicles already moving on that road).
  drivePath(seg0, t0, seg1, t1, bus, onlyDir = 0) {
    const s0 = this.segs[seg0], s1 = this.segs[seg1];
    let bestCost = Infinity, best = [];
    if (seg0 === seg1) {
      for (const dir of [1, -1]) {
        if (onlyDir && dir !== onlyDir) continue;
        if (!this.usable(s0, dir, bus)) continue;
        if ((t1 - t0) * dir > 0) {
          const c = Math.abs(t1 - t0) * s0.length;
          if (c < bestCost) { bestCost = c; best = [[seg0, dir]]; }
        }
      }
    }
    const sources = [];
    const first = new Map();
    for (const dir of [1, -1]) {
      if (onlyDir && dir !== onlyDir) continue;
      if (!this.usable(s0, dir, bus)) continue;
      const node = dir === 1 ? s0.b : s0.a;
      const c = dir === 1 ? (1 - t0) * s0.length : t0 * s0.length;
      sources.push([node, c]);
      first.set(node, dir);
    }
    if (!sources.length) return best;
    const { d, prev } = this.dijkstra(sources, bus, true);
    let endNode = -1, endDir = 0;
    for (const dir of [1, -1]) {
      if (!this.usable(s1, dir, bus)) continue;
      const node = dir === 1 ? s1.a : s1.b;
      const c = d[node] + (dir === 1 ? t1 * s1.length : (1 - t1) * s1.length);
      if (c < bestCost) { bestCost = c; endNode = node; endDir = dir; }
    }
    if (endNode < 0) return best;
    const mid = [];
    let cur = endNode;
    for (let guard = 0; prev[cur] !== -1 && guard < 1000; guard++) {
      const sid = prev[cur];
      const s = this.segs[sid];
      const from = s.b === cur ? s.a : s.b;
      mid.unshift([sid, s.a === from ? 1 : -1]);
      cur = from;
    }
    return [[seg0, first.get(cur)], ...mid, [seg1, endDir]];
  }

  // Free-flow driving distance, for trip planning. Cached per start node.
  driveEstimate(seg0, t0, seg1, t1, bus) {
    const s0 = this.segs[seg0], s1 = this.segs[seg1];
    let best = Infinity;
    if (seg0 === seg1) {
      for (const dir of [1, -1]) {
        if (this.usable(s0, dir, bus) && (t1 - t0) * dir > 0) {
          best = Math.min(best, Math.abs(t1 - t0) * s0.length);
        }
      }
    }
    for (const dir of [1, -1]) {
      if (!this.usable(s0, dir, bus)) continue;
      const node = dir === 1 ? s0.b : s0.a;
      const c0 = dir === 1 ? (1 - t0) * s0.length : t0 * s0.length;
      const d = this._distsFrom(node, bus);
      for (const dir2 of [1, -1]) {
        if (!this.usable(s1, dir2, bus)) continue;
        const n2 = dir2 === 1 ? s1.a : s1.b;
        const c = c0 + d[n2] + (dir2 === 1 ? t1 * s1.length : (1 - t1) * s1.length);
        best = Math.min(best, c);
      }
    }
    return best;
  }

  _distsFrom(node, bus) {
    if (this._driveCacheVersion !== this.version) {
      this._driveCache.clear();
      this._driveCacheVersion = this.version;
    }
    const key = node * 2 + (bus ? 1 : 0);
    let d = this._driveCache.get(key);
    if (!d) {
      d = this.dijkstra([[node, 0]], bus, false).d;
      this._driveCache.set(key, d);
    }
    return d;
  }

  // Polyline along road centre lines for a list of hops.
  hopsPoints(hops, t0, t1) {
    if (!hops.length) return [];
    const pts = [this.segPoint(hops[0][0], t0)];
    for (let i = 0; i < hops.length - 1; i++) {
      const [sid, dir] = hops[i];
      const s = this.segs[sid];
      const n = this.nodes[dir === 1 ? s.b : s.a];
      pts.push({ x: n.x, y: n.y });
    }
    pts.push(this.segPoint(hops[hops.length - 1][0], t1));
    return pts;
  }

  // --- Walking -------------------------------------------------------------------

  _ensureWalk() {
    if (this._walkD) return;
    this._walkD = [];
    this._walkPrev = [];
    for (let i = 0; i < this.nodes.length; i++) {
      const r = this.dijkstra([[i, 0]], false, false, true);
      this._walkD.push(r.d);
      this._walkPrev.push(r.prev);
    }
  }

  walkEstimate(seg0, t0, seg1, t1) {
    const s0 = this.segs[seg0], s1 = this.segs[seg1];
    if (seg0 === seg1) return Math.abs(t1 - t0) * s0.length;
    this._ensureWalk();
    let best = Infinity;
    for (const [n0, c0] of [[s0.a, t0 * s0.length], [s0.b, (1 - t0) * s0.length]]) {
      for (const [n1, c1] of [[s1.a, t1 * s1.length], [s1.b, (1 - t1) * s1.length]]) {
        best = Math.min(best, c0 + this._walkD[n0][n1] + c1);
      }
    }
    return best;
  }

  // A walking route between two places ({x, y, seg, t, side}) along the sidewalks.
  walkPath(a, b) {
    const pts = [{ x: a.x, y: a.y }];
    if (a.seg === b.seg) {
      pts.push(this.sidewalk(a.seg, a.t, a.side));
      if (a.side !== b.side) pts.push(this.sidewalk(a.seg, b.t, a.side));
      pts.push(this.sidewalk(b.seg, b.t, b.side));
      pts.push({ x: b.x, y: b.y });
      return pts;
    }
    this._ensureWalk();
    const s0 = this.segs[a.seg], s1 = this.segs[b.seg];
    let best = Infinity, n0 = -1, n1 = -1;
    for (const [e0, c0] of [[s0.a, a.t * s0.length], [s0.b, (1 - a.t) * s0.length]]) {
      for (const [e1, c1] of [[s1.a, b.t * s1.length], [s1.b, (1 - b.t) * s1.length]]) {
        const c = c0 + this._walkD[e0][e1] + c1;
        if (c < best) { best = c; n0 = e0; n1 = e1; }
      }
    }
    const chain = [];
    let cur = n1;
    for (let guard = 0; cur !== n0 && guard < 1000; guard++) {
      const sid = this._walkPrev[n0][cur];
      if (sid < 0) break;
      const from = this.other(sid, cur);
      chain.unshift([from, cur, sid]);
      cur = from;
    }
    pts.push(this.sidewalk(a.seg, a.t, a.side));
    pts.push(this.sidewalkEnd(a.seg, n0, a.side));
    for (const [u, v, sid] of chain) {
      const side = this.segs[sid].a === u ? 1 : -1;
      pts.push(this.sidewalkEnd(sid, u, side));
      pts.push(this.sidewalkEnd(sid, v, side));
    }
    pts.push(this.sidewalkEnd(b.seg, n1, b.side));
    pts.push(this.sidewalk(b.seg, b.t, b.side));
    pts.push({ x: b.x, y: b.y });
    return pts;
  }
}
