// Draws the world onto the canvas. Reads the simulation; never changes it.
//
// Look: flat shapes, one warm light from the top left, soft shadows falling down-right.
// Buildings are shown as low blocks (a lit roof and a darker front wall). Road paint and
// crossings only appear as you zoom in, so the zoomed-out view stays calm.

import { C } from './config.js';
import {
  LANE_BUS, B_HOUSE, B_APARTMENT, B_OFFICE, B_PARKING, V_BUS,
  VS_SPAWN, VS_GONE, VS_LANE, VS_CROSS, PS_WALK, PS_WAIT, PS_BOARD, PS_ENTER, PS_HOME, isLot, clamp,
} from './model.js';
import { VS_FADE } from './sim.js';
import { palette, withAlpha, mix, ease } from './palette.js';

export const FONT = 'ui-rounded, "SF Pro Rounded", "Nunito", "Varela Round", system-ui, -apple-system, "Segoe UI", sans-serif';

const TAU = Math.PI * 2;

function rrect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Rounded rectangle with its own radius per corner: top-left, top-right, bottom-right, bottom-left.
function rrect4(ctx, x, y, w, h, tl, tr, br, bl) {
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  if (tr) ctx.arcTo(x + w, y, x + w, y + tr, tr); else ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h - br);
  if (br) ctx.arcTo(x + w, y + h, x + w - br, y + h, br); else ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + bl, y + h);
  if (bl) ctx.arcTo(x, y + h, x, y + h - bl, bl); else ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + tl);
  if (tl) ctx.arcTo(x, y, x + tl, y, tl); else ctx.lineTo(x, y);
  ctx.closePath();
}

function circle(ctx, x, y, r) {
  ctx.moveTo(x + r, y);
  ctx.arc(x, y, r, 0, TAU);
}

function polyline(ctx, pts) {
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
}

// Shift a polyline sideways by `off`, measured against a direction-independent normal so a
// route that goes out and comes back along the same streets draws as a single line.
function offsetPoly(pts, off) {
  if (!off || pts.length < 2) return pts;
  const normal = (a, b) => {
    let dx = b.x - a.x, dy = b.y - a.y;
    const l = Math.hypot(dx, dy) || 1;
    dx /= l; dy /= l;
    if (dx < -1e-6 || (Math.abs(dx) <= 1e-6 && dy < 0)) { dx = -dx; dy = -dy; }
    return { x: -dy, y: dx };
  };
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const n1 = i > 0 ? normal(pts[i - 1], pts[i]) : normal(pts[0], pts[1]);
    const n2 = i < pts.length - 1 ? normal(pts[i], pts[i + 1]) : n1;
    let mx = n1.x + n2.x, my = n1.y + n2.y;
    const ml = Math.hypot(mx, my);
    if (ml < 1e-3) { mx = n2.x; my = n2.y; } else { mx /= ml; my /= ml; }
    const scale = off / Math.max(0.4, mx * n1.x + my * n1.y);
    out.push({ x: pts[i].x + mx * scale, y: pts[i].y + my * scale });
  }
  return out;
}

export class View {
  constructor(canvas, sim) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.sim = sim;
    this.cam = { x: sim.map.w / 2, y: sim.map.h / 2, z: 1 };
    this.W = 0;
    this.H = 0;
    this.dpr = 1;
    this.time = 0;
    this.reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Interaction state, set by main.js and ui.js
    this.tool = 'select';
    this.hoverSeg = -1;
    this.selSegs = [];
    this.hoverLane = -1;           // display index of the lane hovered in the road editor
    this.ghostLane = 0;            // -1 / +1: preview a new lane on that side of the road
    this.hoverBuilding = null;
    this.hoverStop = null;
    this.hoverLot = null;
    this.selected = null;
    this.ghostStop = null;
    this.draft = null;
    this.highlightRoute = null;
    this._sortedTrees = null;
  }

  resize(w, h, dpr) {
    this.W = w;
    this.H = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }

  toWorld(sx, sy) {
    return { x: (sx - this.W / 2) / this.cam.z + this.cam.x, y: (sy - this.H / 2) / this.cam.z + this.cam.y };
  }

  toScreen(wx, wy) {
    return { x: (wx - this.cam.x) * this.cam.z + this.W / 2, y: (wy - this.cam.y) * this.cam.z + this.H / 2 };
  }

  render(dt) {
    this.time += dt;
    const { ctx, sim, cam, dpr } = this;
    const P = palette(sim.night());
    this.P = P;
    // Road paint fades in as you zoom closer.
    this.detail = clamp((cam.z - 0.85) / 0.5, 0, 1);
    this.fine = clamp((cam.z - 1.3) / 0.5, 0, 1);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = P.outskirts;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(dpr * cam.z, 0, 0, dpr * cam.z, dpr * (this.W / 2 - cam.x * cam.z), dpr * (this.H / 2 - cam.y * cam.z));

    this.drawGround(P);
    this.drawRoads(P);
    this.drawPaint(P);
    this.drawRoutes(P);
    this.drawSelection(P);
    this.drawDriveways(P);
    this.drawTrees(P);
    this.drawBuildings(P);
    this.drawStops(P);
    this.drawVehicles(P);
    this.drawPeople(P);
    this.drawBadges(P);
    this.drawTools(P);
    this.drawFx(P);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const g = ctx.createRadialGradient(this.canvas.width / 2, this.canvas.height / 2, Math.min(this.canvas.width, this.canvas.height) * 0.35,
      this.canvas.width / 2, this.canvas.height / 2, Math.max(this.canvas.width, this.canvas.height) * 0.75);
    g.addColorStop(0, 'rgba(40, 30, 15, 0)');
    g.addColorStop(1, `rgba(40, 30, 15, ${0.1 + P.glow * 0.15})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  // --- Ground ----------------------------------------------------------------------

  drawGround(P) {
    const { ctx, sim } = this;
    const map = sim.map;
    ctx.fillStyle = P.ground;
    ctx.beginPath();
    rrect(ctx, -70, -70, map.w + 140, map.h + 140, 90);
    ctx.fill();

    const { left, right } = map.river;
    const band = (off, color) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      left.forEach((p, i) => (i ? ctx.lineTo(p.x - off, p.y) : ctx.moveTo(p.x - off, p.y)));
      for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i].x + off, right[i].y);
      ctx.closePath();
      ctx.fill();
    };
    band(5, P.shore);
    band(0, P.water);
    band(-26, P.waterDeep);
    // Slow ripples drifting downstream.
    ctx.strokeStyle = P.wave;
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    const drift = this.reduceMotion ? 0 : this.time * 6;
    for (const w of map.waves) {
      const y = ((w.y + drift + 300) % (map.h + 600)) - 300;
      const x = w.x + Math.sin(this.time * 0.6 + w.phase) * 3;
      ctx.moveTo(x - w.len / 2, y);
      ctx.quadraticCurveTo(x, y - 2.5, x + w.len / 2, y);
    }
    ctx.stroke();

    ctx.fillStyle = P.grass;
    ctx.beginPath();
    for (const r of map.parks) rrect(ctx, r.x - 4, r.y - 4, r.w + 8, r.h + 8, 16);
    ctx.fill();
  }

  // --- Roads -----------------------------------------------------------------------

  drawRoads(P) {
    const { ctx, sim } = this;
    const net = sim.net;
    const map = sim.map;
    const line = (ax, ay, bx, by) => {
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    };
    ctx.lineCap = 'butt';

    // Roads out of town fade away into the countryside.
    for (const s of map.stubs) {
      const len = 300;
      const g = ctx.createLinearGradient(s.x, s.y, s.x + s.dx * len, s.y + s.dy * len);
      g.addColorStop(0, P.road);
      g.addColorStop(1, withAlpha(P.road, 0));
      ctx.strokeStyle = g;
      ctx.lineWidth = s.lanes * C.LANE_W + 2 * C.CURB;
      line(s.x, s.y, s.x + s.dx * len, s.y + s.dy * len);
    }

    // Bridges: a shadow on the water and a slightly wider deck.
    for (const s of net.segs) {
      if (!s.bridge) continue;
      const A = net.nodes[s.a], B = net.nodes[s.b];
      ctx.strokeStyle = P.shadow;
      ctx.lineWidth = s.width + 12;
      line(A.x + 3, A.y + 7, B.x + 3, B.y + 7);
      ctx.strokeStyle = P.roadDeck;
      ctx.lineWidth = s.width + 6;
      line(A.x, A.y, B.x, B.y);
    }

    ctx.strokeStyle = P.road;
    for (const s of net.segs) {
      if (!s.lanes.length) continue;
      const A = net.nodes[s.a], B = net.nodes[s.b];
      ctx.lineWidth = s.width;
      line(A.x, A.y, B.x, B.y);
    }

    // Junctions: a box where roads cross, rounded on open corners, with kerb fillets
    // filling the inside corners so streets meet in soft curves.
    ctx.fillStyle = P.road;
    ctx.beginPath();
    const R = 9;
    for (const n of net.nodes) {
      const d = this.nodeDirs(n);
      const count = (d.E > 0) + (d.W > 0) + (d.N > 0) + (d.S > 0);
      if (!count) continue;
      const hx = Math.max(d.N, d.S), hy = Math.max(d.E, d.W);
      if (count === 1) { circle(ctx, n.x, n.y, Math.max(hx, hy)); continue; }
      if (!hx || !hy) continue;
      const ro = Math.min(hx, hy);
      rrect4(ctx, n.x - hx, n.y - hy, 2 * hx, 2 * hy,
        !d.W && !d.N ? ro : 0, !d.E && !d.N ? ro : 0, !d.E && !d.S ? ro : 0, !d.W && !d.S ? ro : 0);
      for (const [sx, sy, dx, dy] of [[1, 1, 'E', 'S'], [-1, 1, 'W', 'S'], [1, -1, 'E', 'N'], [-1, -1, 'W', 'N']]) {
        if (!d[dx] || !d[dy]) continue;
        const px = n.x + sx * d[dy], py = n.y + sy * d[dx];
        const cx = px + sx * R, cy = py + sy * R;
        const a1 = Math.atan2(-sy, 0), a2 = Math.atan2(0, -sx);
        let delta = a2 - a1;
        while (delta > Math.PI) delta -= TAU;
        while (delta < -Math.PI) delta += TAU;
        ctx.moveTo(px, py);
        ctx.lineTo(px + sx * R, py);
        ctx.arc(cx, cy, R, a1, a2, delta < 0);
        ctx.closePath();
      }
    }
    ctx.fill();

    // Pedestrian streets: a paved path with a dotted texture.
    ctx.lineCap = 'round';
    for (const s of net.segs) {
      if (s.lanes.length) continue;
      const A = net.nodes[s.a], B = net.nodes[s.b];
      ctx.strokeStyle = P.ped;
      ctx.lineWidth = C.PED_W;
      line(A.x, A.y, B.x, B.y);
      ctx.strokeStyle = P.pedDot;
      ctx.lineWidth = 1.6;
      ctx.setLineDash([0.1, 5]);
      line(A.x, A.y, B.x, B.y);
      ctx.setLineDash([]);
    }
  }

  // Half-widths of the lane-carrying roads leaving a node, by compass direction.
  nodeDirs(n) {
    const net = this.sim.net;
    const d = { E: 0, W: 0, N: 0, S: 0 };
    for (const sid of n.segs) {
      const s = net.segs[sid];
      if (!s.lanes.length) continue;
      let dx = s.dx, dy = s.dy;
      if (s.b === n.id) { dx = -dx; dy = -dy; }
      const k = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'E' : 'W') : (dy > 0 ? 'S' : 'N');
      d[k] = Math.max(d[k], s.width / 2);
    }
    return d;
  }

  drawPaint(P) {
    const { ctx, sim } = this;
    const net = sim.net;
    ctx.lineCap = 'butt';
    for (const s of net.segs) {
      const n = s.lanes.length;
      if (!n) continue;
      for (const l of s.lanes) {
        if (l.type !== LANE_BUS && !l.closing && !l.flip) continue;
        ctx.globalAlpha = l.closing || l.flip ? 0.5 : 1;
        ctx.strokeStyle = l.type === LANE_BUS ? P.busLane : P.road;
        ctx.lineWidth = Math.max(0, l.w);
        ctx.beginPath();
        ctx.moveTo(l.p0.x, l.p0.y);
        ctx.lineTo(l.p1.x, l.p1.y);
        ctx.stroke();
        ctx.globalAlpha = 1;
        if (l.type === LANE_BUS && this.fine > 0 && l.length > 50 && l.w > 6) {
          // Road paint, written to be read by drivers coming towards it.
          ctx.fillStyle = withAlpha('#ffffff', 0.75 * this.fine);
          ctx.font = `800 ${l.w * 0.62}px ${FONT}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          for (let s2 = 34; s2 < l.length - 20; s2 += 110) {
            ctx.save();
            ctx.translate(l.p0.x + l.dx * s2, l.p0.y + l.dy * s2);
            ctx.rotate(Math.atan2(l.dy, l.dx) + Math.PI / 2);
            ctx.fillText('BUS', 0, 0);
            ctx.restore();
          }
        }
      }
      if (this.detail <= 0) continue;
      const A = net.nodes[s.a], B = net.nodes[s.b];
      const ia = net.inset(s.a, s.id), ib = net.inset(s.b, s.id);
      for (let i = 0; i < n - 1; i++) {
        const l1 = s.lanes[i], l2 = s.lanes[i + 1];
        const off = l1.offset + l1.w / 2;
        const opposite = l1.dir !== l2.dir;
        ctx.strokeStyle = withAlpha(P.paint, this.detail * (opposite ? 1 : 0.8));
        ctx.lineWidth = opposite ? 1.2 : 1;
        ctx.setLineDash(opposite ? [] : [7, 7]);
        ctx.beginPath();
        ctx.moveTo(A.x + s.dx * (ia + 4) + s.rx * off, A.y + s.dy * (ia + 4) + s.ry * off);
        ctx.lineTo(B.x - s.dx * (ib + 4) + s.rx * off, B.y - s.dy * (ib + 4) + s.ry * off);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      // Zebra crossings at real intersections, only up close.
      if (this.fine <= 0) continue;
      ctx.strokeStyle = withAlpha(P.paint, this.fine * 0.9);
      ctx.lineWidth = 1.7;
      ctx.beginPath();
      for (const [node, sign, inset] of [[s.a, 1, ia], [s.b, -1, ib]]) {
        if (net.nodes[node].segs.length < 3 || inset < 1) continue;
        const N = net.nodes[node];
        const half = s.lanesW / 2 - 1.5;
        for (let o = -half; o <= half + 0.01; o += 3.4) {
          const x0 = N.x + s.dx * sign * (inset + 2) + s.rx * o, y0 = N.y + s.dy * sign * (inset + 2) + s.ry * o;
          ctx.moveTo(x0, y0);
          ctx.lineTo(x0 + s.dx * sign * 6, y0 + s.dy * sign * 6);
        }
      }
      ctx.stroke();
    }
  }

  // --- Transit lines --------------------------------------------------------------------

  routePoints(r) {
    const pts = [];
    for (const leg of r.legPts) {
      if (!leg) continue;
      for (const p of leg) {
        const last = pts[pts.length - 1];
        if (!last || Math.hypot(last.x - p.x, last.y - p.y) > 0.5) pts.push(p);
      }
    }
    return pts;
  }

  drawRoutes(P) {
    const { ctx, sim } = this;
    const routes = sim.routes;
    if (!routes.length) return;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const paths = routes.map((r, ri) => {
      const pts = offsetPoly(this.routePoints(r), (ri - (routes.length - 1) / 2) * 5.5);
      let total = 0;
      for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      return { r, pts, total };
    });
    const stroke = (p, width, color) => {
      const visible = p.total * ease.out(p.r.appear);
      ctx.setLineDash(p.r.appear < 1 ? [visible, p.total + 10] : []);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      polyline(ctx, p.pts);
      ctx.stroke();
    };
    for (const p of paths) {
      const hl = this.highlightRoute === p.r;
      if (P.glow > 0.02 || hl) stroke(p, hl ? 14 : 12, withAlpha(p.r.color, hl ? 0.28 : 0.22 * P.glow));
    }
    for (const p of paths) stroke(p, this.highlightRoute === p.r ? 8.5 : 7, withAlpha(P.ground, 0.92));
    for (const p of paths) stroke(p, this.highlightRoute === p.r ? 5.5 : 4.2, p.r.color);
    ctx.setLineDash([]);
  }

  drawSelection(P) {
    const { ctx, sim } = this;
    const net = sim.net;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // One path per highlight so overlapping ends don't stack up into darker blobs.
    const glow = (sids, color, extra) => {
      if (!sids.length) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(...sids.map((sid) => net.segs[sid].width)) + extra;
      ctx.beginPath();
      for (const sid of sids) {
        const s = net.segs[sid], A = net.nodes[s.a], B = net.nodes[s.b];
        ctx.moveTo(A.x, A.y);
        ctx.lineTo(B.x, B.y);
      }
      ctx.stroke();
    };
    if (this.hoverSeg >= 0 && !this.selSegs.includes(this.hoverSeg)) glow([this.hoverSeg], withAlpha(P.accent, 0.16), 8);
    if (!this.selSegs.length) return;
    glow(this.selSegs, withAlpha(P.accent, 0.22), 10);

    ctx.lineCap = 'butt';
    for (const sid of this.selSegs) {
      const s = net.segs[sid];
      const { lanes, reversed } = net.displayLanes(sid);
      // The lane under the mouse in the road editor.
      const hl = lanes[this.hoverLane];
      if (hl) {
        ctx.strokeStyle = withAlpha(P.accent, 0.5);
        ctx.lineWidth = hl.w;
        ctx.beginPath();
        ctx.moveTo(hl.p0.x, hl.p0.y);
        ctx.lineTo(hl.p1.x, hl.p1.y);
        ctx.stroke();
      }
      // Where a new lane would go.
      if (this.ghostLane) {
        const side = (this.ghostLane < 0) !== reversed ? -1 : 1;
        const off = side * (s.lanesW / 2 + C.LANE_W / 2 + C.CURB);
        const A = net.nodes[s.a], B = net.nodes[s.b];
        const ia = net.inset(s.a, sid), ib = net.inset(s.b, sid);
        ctx.strokeStyle = withAlpha(P.accent, 0.7);
        ctx.lineWidth = 1.4;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        const corner = (t, o) => ({ x: (t ? B.x - s.dx * ib : A.x + s.dx * ia) + s.rx * o, y: (t ? B.y - s.dy * ib : A.y + s.dy * ia) + s.ry * o });
        const c = [corner(0, off - C.LANE_W / 2), corner(1, off - C.LANE_W / 2), corner(1, off + C.LANE_W / 2), corner(0, off + C.LANE_W / 2)];
        polyline(ctx, c);
        ctx.closePath();
        ctx.fillStyle = withAlpha(P.accent, 0.12);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // Direction arrows on every lane of the selection.
      ctx.strokeStyle = withAlpha('#ffffff', 0.9);
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (const l of s.lanes) {
        if (l.closing || l.length < 20) continue;
        const dir = l.flip ? -1 : 1;
        const dx = l.dx * dir, dy = l.dy * dir;
        const px = -dy, py = dx;
        const a = Math.min(2.2, l.w * 0.3);
        for (let s2 = 14; s2 < l.length - 8; s2 += 24) {
          const x = l.p0.x + l.dx * s2, y = l.p0.y + l.dy * s2;
          ctx.moveTo(x - dx * a + px * a, y - dy * a + py * a);
          ctx.lineTo(x + dx * a * 0.6, y + dy * a * 0.6);
          ctx.lineTo(x - dx * a - px * a, y - dy * a - py * a);
        }
      }
      ctx.stroke();
      ctx.lineCap = 'butt';
    }
  }

  // --- Buildings and trees ------------------------------------------------------------

  drawDriveways(P) {
    const { ctx, sim } = this;
    const net = sim.net;
    ctx.strokeStyle = P.driveway;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const b of sim.buildings.values()) {
      if (b.appear < 0.3) continue;
      const s = net.segs[b.seg];
      const p = net.segPoint(b.seg, b.t);
      const off = b.side * (s.width / 2 - 1);
      ctx.moveTo(b.door.x, b.door.y);
      ctx.lineTo(p.x + s.rx * off, p.y + s.ry * off);
    }
    ctx.stroke();
  }

  drawTrees(P) {
    const { ctx, sim } = this;
    const trees = [...sim.map.trees];
    for (const lot of sim.lots) if (lot.building < 0 && !lot.cleared) trees.push(...lot.trees);
    ctx.fillStyle = P.shadow;
    ctx.beginPath();
    for (const t of trees) circle(ctx, t.x + t.r * 0.35 + 1, t.y + t.r * 0.45 + 1, t.r);
    ctx.fill();
    ctx.fillStyle = P.tree;
    ctx.beginPath();
    for (const t of trees) circle(ctx, t.x, t.y, t.r);
    ctx.fill();
    ctx.fillStyle = P.treeLight;
    ctx.beginPath();
    for (const t of trees) circle(ctx, t.x - t.r * 0.28, t.y - t.r * 0.3, t.r * 0.55);
    ctx.fill();
  }

  // A raised block: shadow, front wall and roof. Returns the roof's rectangle.
  block(x, y, w, h, H, top, side, rad) {
    const { ctx, P } = this;
    ctx.fillStyle = P.shadow;
    ctx.beginPath();
    rrect(ctx, x + 1.5 + H * 0.35, y + 1.5 + H * 0.12, w, h, rad);
    ctx.fill();
    ctx.fillStyle = side;
    ctx.beginPath();
    rrect(ctx, x, y - H / 2, w, h + H / 2, rad);
    ctx.fill();
    ctx.fillStyle = top;
    ctx.beginPath();
    rrect(ctx, x, y - H / 2, w, h, rad);
    ctx.fill();
    return { x, y: y - H / 2, w, h, wallY: y + h - H / 2, wallH: H / 2 };
  }

  houseColor(P, b, i) {
    const k = ['house', 'house2', 'house3'][(Math.floor(b.shade * 3) + i) % 3];
    return { top: P[`${k}Lit`], base: P[k], side: P[`${k}Side`] };
  }

  drawBuildings(P) {
    const { ctx, sim } = this;
    const list = [...sim.buildings.values()].sort((a, b) => (a.rect.y + a.rect.h) - (b.rect.y + b.rect.h));
    const night = P.glow;
    for (const b of list) {
      const grow = b.dying ? ease.smooth(b.appear) : ease.outBack(b.appear, 1.1);
      const alpha = b.dying ? clamp(b.appear * 1.5, 0, 1) : clamp(b.appear * 4, 0, 1);
      if (alpha < 0.01) continue;
      const pulse = 1 + b.pulse * 0.025;
      const H = b.height * grow * pulse;
      // Grow up from a slightly smaller footprint, never from nothing.
      const k = 0.9 + 0.1 * Math.min(1, grow);
      const r = b.rect;
      const w = r.w * k, h = r.h * k, x = r.x + (r.w - w) / 2, y = r.y + (r.h - h) / 2;
      ctx.globalAlpha = alpha;
      let roof;
      if (b.type === B_HOUSE) {
        roof = this.drawHouses(P, b, x, y, w, h, H, night);
      } else if (b.type === B_APARTMENT) {
        roof = this.block(x, y, w, h, H, P.apartmentLit, P.apartmentSide, 3);
        ctx.fillStyle = P.apartment;
        ctx.beginPath();
        rrect(ctx, roof.x + 3, roof.y + 3, roof.w - 6, roof.h - 6, 2);
        ctx.fill();
        ctx.fillStyle = P.apartmentLit;
        ctx.beginPath();
        rrect(ctx, roof.x + roof.w * 0.62, roof.y + roof.h * 0.22, roof.w * 0.18, roof.h * 0.24, 1.5);
        rrect(ctx, roof.x + roof.w * 0.2, roof.y + roof.h * 0.55, roof.w * 0.14, roof.h * 0.2, 1.5);
        ctx.fill();
        this.windows(roof, night > 0.05 ? P.window : P.glass, 3.2, 2.6, 2.2);
      } else if (b.type === B_OFFICE) {
        const tone = ['office', 'office2', 'office3'][Math.floor(b.shade * 3)];
        roof = this.block(x, y, w, h, H, P[`${tone}Lit`], P[`${tone}Side`], 3);
        ctx.fillStyle = P[tone];
        ctx.beginPath();
        rrect(ctx, roof.x + 2.5, roof.y + 2.5, roof.w - 5, roof.h - 5, 2);
        ctx.fill();
        // Rooftop plant room
        const mw = roof.w * 0.3, mh = roof.h * 0.32;
        const mx = roof.x + roof.w * (b.layout === 1 ? 0.15 : 0.55), my = roof.y + roof.h * 0.2;
        ctx.fillStyle = P[`${tone}Side`];
        ctx.beginPath();
        rrect(ctx, mx, my + 1.5, mw, mh, 1.5);
        ctx.fill();
        ctx.fillStyle = P[`${tone}Lit`];
        ctx.beginPath();
        rrect(ctx, mx, my, mw, mh, 1.5);
        ctx.fill();
        this.windows(roof, night > 0.05 ? P.window : P.glass, 4.5, 2.2, 1.8, true);
      } else {
        const lit = b.type === B_PARKING ? P.parkingLit : P.parkRideLit;
        roof = this.block(x, y, w, h, H, lit, b.type === B_PARKING ? P.parkingSide : P.parkRideSide, 3);
        // Parking bays
        ctx.strokeStyle = withAlpha('#ffffff', 0.55 - night * 0.35);
        ctx.lineWidth = 1;
        ctx.beginPath();
        const rows = [roof.y + 3, roof.y + roof.h - 3 - roof.h * 0.3];
        for (const ry of rows) {
          for (let bx = roof.x + 5; bx < roof.x + roof.w - 3; bx += 5) {
            ctx.moveTo(bx, ry);
            ctx.lineTo(bx, ry + roof.h * 0.3);
          }
        }
        ctx.stroke();
      }
      b._roof = roof;
      ctx.globalAlpha = 1;

      const sel = this.selected === b;
      if ((this.hoverBuilding === b || sel) && !b.dying) {
        ctx.strokeStyle = sel ? P.accent : withAlpha(P.ink, 0.35);
        ctx.lineWidth = sel ? 2.2 : 1.6;
        ctx.beginPath();
        rrect(ctx, r.x - 3, r.y - 3 - b.height / 2, r.w + 6, r.h + 6 + b.height / 2, 6);
        ctx.stroke();
      }
    }

    // Empty lots show a dashed outline while hovered or selected, so they read as buildable.
    const lot = this.hoverLot || (this.selected && this.selected.access ? this.selected : null);
    if (lot && lot.building < 0) {
      const r = lot.rect;
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = withAlpha(P.ink, 0.4);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      rrect(ctx, r.x + 2, r.y + 2, r.w - 4, r.h - 4, 5);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // A row of windows along a building's front wall.
  windows(roof, color, step, ww, wh, band = false) {
    const { ctx } = this;
    if (roof.wallH < 3) return;
    ctx.fillStyle = color;
    ctx.beginPath();
    const y = roof.wallY + roof.wallH / 2 - wh / 2;
    if (band) {
      rrect(ctx, roof.x + 3, y, roof.w - 6, wh, 0.8);
      if (roof.wallH > 9) rrect(ctx, roof.x + 3, y - 4, roof.w - 6, wh, 0.8);
    } else {
      for (let x = roof.x + 4; x < roof.x + roof.w - 4 - ww + 0.1; x += step) rrect(ctx, x, y, ww, wh, 0.6);
    }
    ctx.fill();
  }

  // Little houses with pitched roofs, one to three to a lot.
  drawHouses(P, b, x, y, w, h, H, night) {
    const { ctx } = this;
    const homes = b.people.length ? b.people.filter((p) => p.state === PS_HOME).length / b.people.length : 0;
    const horiz = b.edge === 't' || b.edge === 'b';
    const units = [];
    if (b.layout === 0) {
      const uw = horiz ? w * 0.42 : w * 0.7, uh = horiz ? h * 0.66 : h * 0.4;
      units.push(horiz ? [x + w * 0.05, y + (h - uh) / 2, uw, uh] : [x + (w - uw) / 2, y + h * 0.06, uw, uh]);
      units.push(horiz ? [x + w * 0.53, y + (h - uh) / 2, uw, uh] : [x + (w - uw) / 2, y + h * 0.54, uw, uh]);
    } else if (b.layout === 1) {
      units.push([x + w * 0.1, y + h * 0.16, w * 0.52, h * 0.68]);
      units.push([x + w * 0.7, y + h * 0.48, w * 0.22, h * 0.32]);
    } else {
      const uw = w * 0.27;
      for (let i = 0; i < 3; i++) units.push([x + w * 0.05 + i * w * 0.32, y + h * (i === 1 ? 0.14 : 0.24), uw, h * 0.58]);
    }
    let roof = null;
    units.forEach(([ux, uy, uw, uh], i) => {
      const c = this.houseColor(P, b, i);
      const r = this.block(ux, uy, uw, uh, H * (i === 1 && b.layout === 1 ? 0.7 : 1), c.top, c.side, 2.5);
      // The far slope catches the light; the near slope is in shade.
      ctx.fillStyle = c.base;
      ctx.beginPath();
      if (uw >= uh) rrect4(ctx, r.x, r.y + r.h / 2, r.w, r.h / 2, 0, 0, 2.5, 2.5);
      else rrect4(ctx, r.x + r.w / 2, r.y, r.w / 2, r.h, 0, 2.5, 2.5, 0);
      ctx.fill();
      if (night > 0.05 && homes > 0 && r.wallH > 1.5) {
        ctx.fillStyle = withAlpha(P.window, Math.min(1, night * (0.4 + homes)));
        ctx.beginPath();
        rrect(ctx, r.x + r.w * 0.3, r.wallY + 0.4, r.w * 0.4, Math.max(1, r.wallH - 0.8), 0.6);
        ctx.fill();
      }
      if (!roof) roof = r;
    });
    return roof;
  }

  // --- Stops, vehicles, people -------------------------------------------------------

  drawStops(P) {
    const { ctx, sim } = this;
    for (const st of sim.stops.values()) {
      const k = st.dying ? ease.smooth(st.appear) : ease.outBack(st.appear, 1.8);
      if (k < 0.02) continue;
      const routes = sim.stopRoutes(st);
      const R = 5.4 * k;
      ctx.fillStyle = P.shadow;
      ctx.beginPath();
      circle(ctx, st.x + 1, st.y + 1.6, R + 1.2);
      ctx.fill();
      ctx.fillStyle = P.stop;
      ctx.beginPath();
      circle(ctx, st.x, st.y, R + 1.2);
      ctx.fill();
      ctx.lineWidth = 2.6 * k;
      ctx.lineCap = 'butt';
      if (routes.length) {
        const seg = TAU / routes.length;
        routes.forEach((r, i) => {
          ctx.strokeStyle = r.color;
          ctx.beginPath();
          ctx.arc(st.x, st.y, R - 0.6, -Math.PI / 2 + i * seg, -Math.PI / 2 + (i + 1) * seg);
          ctx.stroke();
        });
      } else {
        ctx.strokeStyle = P.ink;
        ctx.beginPath();
        ctx.arc(st.x, st.y, R - 0.6, 0, TAU);
        ctx.stroke();
      }
      if (st.waiting.length || st.ring > 0.01) {
        this.ring(st.x, st.y, 10.5 * k, st.ring, 2.2, P.ringTrack, this.ringColor(P, st.ring));
      }
      if (this.hoverStop === st || this.selected === st) {
        ctx.strokeStyle = P.accent;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(st.x, st.y, 13.5, 0, TAU);
        ctx.stroke();
      }
    }
  }

  drawVehicles(P) {
    const { ctx, sim } = this;
    const night = P.glow;
    for (const v of sim.vehicles) {
      if (v.state === VS_SPAWN || v.state === VS_GONE) continue;
      const alpha = v.state === VS_FADE ? Math.max(0, v.fade) : 1;
      const k = v.state === VS_LANE || v.state === VS_CROSS || v.state === VS_FADE ? 0.6 + 0.4 * ease.outBack(v.pop, 2) : v.pop;
      if (k < 0.03 || alpha < 0.02) continue;
      const L = v.length, W = v.width;
      ctx.globalAlpha = alpha;
      ctx.save();
      ctx.translate(v.x + 1.1, v.y + 1.6);
      ctx.rotate(v.ang);
      ctx.scale(k, k);
      ctx.fillStyle = P.shadow;
      ctx.beginPath();
      rrect(ctx, -L / 2, -W / 2, L, W, 2.4);
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.translate(v.x, v.y);
      ctx.rotate(v.ang);
      ctx.scale(k, k);
      if (night > 0.05) {
        const g = ctx.createRadialGradient(L / 2 + 2, 0, 0, L / 2 + 2, 0, 16);
        g.addColorStop(0, withAlpha('#ffe6a6', 0.32 * night));
        g.addColorStop(1, withAlpha('#ffe6a6', 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(L / 2, -W * 0.3);
        ctx.lineTo(L / 2 + 16, -W * 1.4);
        ctx.lineTo(L / 2 + 16, W * 1.4);
        ctx.lineTo(L / 2, W * 0.3);
        ctx.fill();
      }
      if (v.kind === V_BUS) {
        const col = v.route.color;
        ctx.fillStyle = col;
        ctx.beginPath();
        rrect(ctx, -L / 2, -W / 2, L, W, 2.8);
        ctx.fill();
        ctx.fillStyle = mix(col, '#ffffff', 0.28);
        ctx.beginPath();
        rrect(ctx, -L / 2 + 3, -W * 0.24, L - 7.5, W * 0.48, 1.4);
        ctx.fill();
        ctx.fillStyle = 'rgba(30, 30, 40, 0.35)';
        ctx.beginPath();
        rrect(ctx, L / 2 - 3.2, -W / 2 + 1, 2.2, W - 2, 1);
        ctx.fill();
        const n = Math.ceil((v.passengers.length / C.BUS_CAP) * 7);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        for (let i = 0; i < n; i++) circle(ctx, -L / 2 + 5 + i * 2.2, 0, 0.75);
        ctx.fill();
      } else {
        ctx.fillStyle = P.car;
        ctx.beginPath();
        rrect(ctx, -L / 2, -W / 2, L, W, 2.4);
        ctx.fill();
        ctx.fillStyle = P.carRoof;
        ctx.beginPath();
        rrect(ctx, -L * 0.2, -W / 2 + 1.1, L * 0.42, W - 2.2, 1.4);
        ctx.fill();
      }
      if (v.braking && v.state === VS_LANE) {
        ctx.fillStyle = withAlpha('#ff5a4a', 0.55 + night * 0.4);
        ctx.beginPath();
        circle(ctx, -L / 2 + 0.6, -W * 0.3, 0.8);
        circle(ctx, -L / 2 + 0.6, W * 0.3, 0.8);
        ctx.fill();
      }
      if (night > 0.05) {
        ctx.fillStyle = withAlpha('#fff1c8', night);
        ctx.beginPath();
        circle(ctx, L / 2 - 0.6, -W * 0.3, 0.8);
        circle(ctx, L / 2 - 0.6, W * 0.3, 0.8);
        ctx.fill();
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }
  }

  drawPeople(P) {
    const { ctx, sim } = this;
    ctx.fillStyle = P.person;
    ctx.beginPath();
    for (const p of sim.people) {
      const st = p.state;
      if (st !== PS_WALK && st !== PS_WAIT && st !== PS_BOARD && st !== PS_ENTER) continue;
      const r = C.DOT_R * (0.4 + 0.6 * ease.outBack(p.pop, 2)) * (1 - p.vanish);
      if (r < 0.05) continue;
      circle(ctx, p.x, p.y, r);
    }
    ctx.fill();
  }

  // --- Rings ----------------------------------------------------------------------------

  ring(cx, cy, radius, frac, width, track, fill) {
    const { ctx } = this;
    ctx.lineCap = 'round';
    ctx.lineWidth = width;
    ctx.strokeStyle = track;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, TAU);
    ctx.stroke();
    if (frac > 0.005) {
      ctx.strokeStyle = fill;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, frac));
      ctx.stroke();
    }
  }

  ringColor(P, frac) {
    if (frac >= 0.995) return P.full;
    if (frac > 0.7) return mix(P.ink, P.warn, (frac - 0.7) / 0.3);
    return P.ink;
  }

  // Parking buildings wear a gauge badge on the roof that fills as cars arrive.
  drawBadges(P) {
    const { ctx, sim } = this;
    for (const b of sim.buildings.values()) {
      if (!isLot(b) || !b._roof || b.appear < 0.05) continue;
      const roof = b._roof;
      const full = b.parked >= b.capacity;
      const k = (b.dying ? ease.smooth(b.appear) : ease.outBack(b.appear, 1.6)) *
        (1 + (full && !this.reduceMotion ? (Math.sin(this.time * 6) * 0.5 + 0.5) * 0.08 : 0) + b.flash * 0.12);
      const cx = roof.x + roof.w / 2, cy = roof.y + roof.h / 2;
      const R = 9.5 * k;
      ctx.fillStyle = P.shadow;
      ctx.beginPath();
      circle(ctx, cx + 1, cy + 2, R + 2);
      ctx.fill();
      ctx.fillStyle = P.stop;
      ctx.beginPath();
      circle(ctx, cx, cy, R + 2);
      ctx.fill();
      this.ring(cx, cy, R - 0.6, b.ring, 2.6 * k, P.ringTrack, b.flash > 0.05 ? P.full : this.ringColor(P, b.ring));
      ctx.fillStyle = full ? P.full : P.ink;
      ctx.font = `800 ${(b.type === B_PARKING ? 9.5 : 6.6) * k}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.type === B_PARKING ? 'P' : 'P+R', cx, cy + 0.6 * k);
    }
  }

  // --- Tool previews and effects -----------------------------------------------------------

  drawTools(P) {
    const { ctx } = this;
    const g = this.ghostStop;
    if (g) {
      ctx.fillStyle = withAlpha(P.accent, 0.07);
      ctx.strokeStyle = withAlpha(P.accent, 0.4);
      ctx.lineWidth = 1.3;
      ctx.setLineDash([5, 6]);
      ctx.beginPath();
      ctx.arc(g.x, g.y, C.WALK_RADIUS * 0.8, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = g.ok ? 0.9 : 0.4;
      ctx.fillStyle = P.stop;
      ctx.beginPath();
      circle(ctx, g.x, g.y, 6.6);
      ctx.fill();
      ctx.strokeStyle = g.ok ? P.accent : P.full;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.arc(g.x, g.y, 4.8, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    const d = this.draft;
    if (d) {
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      const pts = [];
      for (const leg of d.legs) for (const p of leg) pts.push(p);
      ctx.strokeStyle = withAlpha(P.ground, 0.9);
      ctx.lineWidth = 7;
      ctx.beginPath();
      polyline(ctx, pts);
      ctx.stroke();
      ctx.strokeStyle = d.color;
      ctx.lineWidth = 4.2;
      ctx.beginPath();
      polyline(ctx, pts);
      ctx.stroke();
      const last = d.stops.length ? this.sim.stops.get(d.stops[d.stops.length - 1]) : null;
      if (last && d.mouse) {
        ctx.setLineDash([2, 7]);
        ctx.strokeStyle = withAlpha(d.color, 0.8);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(d.mouse.x, d.mouse.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      for (const id of d.stops) {
        const st = this.sim.stops.get(id);
        if (!st) continue;
        ctx.strokeStyle = d.color;
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.arc(st.x, st.y, 11, 0, TAU);
        ctx.stroke();
      }
    }
  }

  drawFx(P) {
    const { ctx, sim, cam } = this;
    const s = 1 / Math.max(0.6, cam.z);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of sim.fx) {
      if (f.kind === 'ghost') {
        ctx.fillStyle = withAlpha(P.person, Math.max(0, 1 - f.t * 2));
        ctx.beginPath();
        circle(ctx, f.x, f.y - f.t * 6, C.DOT_R);
        ctx.fill();
      } else if (f.kind === 'ripple') {
        const t = Math.min(1, f.t / 0.6);
        ctx.strokeStyle = withAlpha(P.accent, 0.6 * (1 - t));
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(f.x, f.y, 6 + 22 * ease.out(t), 0, TAU);
        ctx.stroke();
      } else if (f.kind === 'dust') {
        const t = Math.min(1, f.t / 0.7);
        ctx.fillStyle = withAlpha(P.driveway, 0.7 * (1 - t));
        ctx.beginPath();
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * TAU + 0.4;
          const d = (f.w * 0.3 + 10) * ease.out(t);
          circle(ctx, f.x + Math.cos(a) * d, f.y + Math.sin(a) * d * 0.7, (4 + (i % 3)) * (1 - t * 0.5));
        }
        ctx.fill();
      } else {
        // Money and warnings: a small pill that rises and fades.
        const t = f.t;
        const a = 1 - ease.smooth((t - 1.1) / 0.6);
        if (a <= 0) continue;
        const y = f.y - 10 * s - 14 * s * ease.out(Math.min(1, t / 0.9));
        ctx.font = `800 ${12 * s}px ${FONT}`;
        const tw = ctx.measureText(f.text).width;
        const ph = 18 * s, pw = tw + 14 * s;
        ctx.globalAlpha = a;
        ctx.fillStyle = P.stop;
        ctx.beginPath();
        rrect(ctx, f.x - pw / 2, y - ph / 2, pw, ph, ph / 2);
        ctx.fill();
        ctx.fillStyle = f.kind === 'money' ? '#1f9d63' : '#e0533d';
        ctx.fillText(f.text, f.x, y + 0.5 * s);
        ctx.globalAlpha = 1;
      }
    }
  }
}
