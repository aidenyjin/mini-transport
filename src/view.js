// Draws the world onto the canvas. Reads the simulation; never changes it.

import { C } from './config.js';
import {
  LANE_BUS, B_HOUSE, B_APARTMENT, B_OFFICE, B_PARKING, B_PARK_RIDE, V_BUS,
  VS_SPAWN, VS_GONE, VS_LANE, PS_WALK, PS_WAIT, PS_BOARD, PS_ENTER, PS_HOME, isLot,
} from './model.js';
import { VS_FADE } from './sim.js';
import { palette, withAlpha, mix, ease } from './palette.js';

export const FONT = 'ui-rounded, "SF Pro Rounded", "Nunito", "Varela Round", system-ui, -apple-system, "Segoe UI", sans-serif';

function rrect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Shift a polyline sideways, keeping corners mitred.
function offsetPoly(pts, off) {
  if (!off) return pts;
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[i], c = pts[Math.min(pts.length - 1, i + 1)];
    let n1x = 0, n1y = 0, n2x = 0, n2y = 0;
    if (i > 0) { const l = Math.hypot(b.x - a.x, b.y - a.y) || 1; n1x = -(b.y - a.y) / l; n1y = (b.x - a.x) / l; }
    if (i < pts.length - 1) { const l = Math.hypot(c.x - b.x, c.y - b.y) || 1; n2x = -(c.y - b.y) / l; n2y = (c.x - b.x) / l; }
    if (i === 0) { n1x = n2x; n1y = n2y; }
    if (i === pts.length - 1) { n2x = n1x; n2y = n1y; }
    let mx = n1x + n2x, my = n1y + n2y;
    const ml = Math.hypot(mx, my) || 1;
    mx /= ml; my /= ml;
    const scale = off / Math.max(0.35, mx * n1x + my * n1y);
    out.push({ x: b.x + mx * scale, y: b.y + my * scale });
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
    // Interaction state, set by main.js
    this.tool = 'select';
    this.hoverSeg = -1;
    this.selSegs = [];
    this.hoverBuilding = null;
    this.hoverStop = null;
    this.hoverLot = null;
    this.selected = null;          // building, lot or stop with an open card
    this.ghostStop = null;
    this.draft = null;             // { stops, color, legs: [pts], mouse }
    this.highlightRoute = null;
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
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = P.bg;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(dpr * cam.z, 0, 0, dpr * cam.z, dpr * (this.W / 2 - cam.x * cam.z), dpr * (this.H / 2 - cam.y * cam.z));

    this.drawGround(P);
    this.drawRoads(P);
    this.drawRoutes(P);
    this.drawSelection(P);
    this.drawBuildings(P);
    this.drawStops(P);
    this.drawVehicles(P);
    this.drawPeople(P);
    this.drawRings(P);
    this.drawTools(P);
    this.drawFx(P);
  }

  drawGround(P) {
    const { ctx, sim } = this;
    const map = sim.map;
    ctx.beginPath();
    map.river.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.fillStyle = P.water;
    ctx.fill();
    ctx.strokeStyle = P.waterEdge;
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.fillStyle = P.block;
    ctx.beginPath();
    for (const r of map.blocks) rrect(ctx, r.x - 6, r.y - 6, r.w + 12, r.h + 12, 8);
    ctx.fill();

    ctx.fillStyle = P.park;
    ctx.beginPath();
    for (const r of map.parks) rrect(ctx, r.x - 6, r.y - 6, r.w + 12, r.h + 12, 10);
    ctx.fill();
    ctx.fillStyle = P.tree;
    ctx.beginPath();
    for (const t of map.trees) {
      ctx.moveTo(t.x + t.r, t.y);
      ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  drawRoads(P) {
    const { ctx, sim } = this;
    const net = sim.net;
    const line = (s, w, color, dy = 0) => {
      const A = net.nodes[s.a], B = net.nodes[s.b];
      ctx.strokeStyle = color;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(A.x, A.y + dy);
      ctx.lineTo(B.x, B.y + dy);
      ctx.stroke();
    };
    ctx.lineCap = 'round';
    for (const s of net.segs) if (s.bridge) line(s, s.width + 6, P.bridgeShadow, 3.5);
    for (const s of net.segs) {
      if (s.lanes.length) line(s, s.width + 3, P.roadEdge);
      else line(s, C.PED_W + 2.5, P.pedEdge);
    }
    for (const s of net.segs) {
      if (s.lanes.length) line(s, s.width, P.road);
      else line(s, C.PED_W, P.ped);
    }

    // Bus lanes and lane markings.
    ctx.lineCap = 'butt';
    for (const s of net.segs) {
      const n = s.lanes.length;
      if (!n) continue;
      const A = net.nodes[s.a], B = net.nodes[s.b];
      const ia = net.inset(s.a, s.id), ib = net.inset(s.b, s.id);
      for (const l of s.lanes) {
        if (l.type !== LANE_BUS && !l.closing && !l.flip) continue;
        ctx.strokeStyle = l.type === LANE_BUS ? P.busLane : P.laneMark;
        if (l.closing || l.flip) ctx.setLineDash([3, 3]);
        ctx.lineWidth = Math.max(0, l.w - 0.6);
        ctx.beginPath();
        ctx.moveTo(l.p0.x, l.p0.y);
        ctx.lineTo(l.p1.x, l.p1.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      for (let i = 0; i < n - 1; i++) {
        const l1 = s.lanes[i], l2 = s.lanes[i + 1];
        const off = l1.offset + l1.w / 2;
        const ax = A.x + s.dx * ia + s.rx * off, ay = A.y + s.dy * ia + s.ry * off;
        const bx = B.x - s.dx * ib + s.rx * off, by = B.y - s.dy * ib + s.ry * off;
        const opposite = l1.dir !== l2.dir;
        ctx.strokeStyle = opposite ? P.centerLine : P.laneMark;
        ctx.lineWidth = opposite ? 1.1 : 0.9;
        ctx.setLineDash(opposite ? [] : [4, 4]);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
  }

  drawRoutes(P) {
    const { ctx, sim } = this;
    const routes = sim.routes;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    routes.forEach((r, ri) => {
      const off = (ri - (routes.length - 1) / 2) * 3.4;
      const hl = this.highlightRoute === r;
      const legs = r.legPts.filter(Boolean).map((pts) => offsetPoly(pts, off));
      const path = () => {
        ctx.beginPath();
        for (const pts of legs) pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      };
      ctx.globalAlpha = r.appear;
      if (P.glow > 0.01 || hl) {
        path();
        ctx.strokeStyle = withAlpha(r.color, hl ? 0.3 : 0.22 * P.glow);
        ctx.lineWidth = hl ? 10 : 9;
        ctx.stroke();
      }
      path();
      ctx.strokeStyle = withAlpha(r.color, 0.92);
      ctx.lineWidth = hl ? 4 : 3;
      ctx.stroke();
      if (r.broken) {
        ctx.setLineDash([3, 4]);
        ctx.strokeStyle = P.full;
        ctx.lineWidth = 2;
        ctx.beginPath();
        r.legPts.forEach((pts, i) => {
          if (pts) return;
          const a = sim.stops.get(r.seq[i]), b = sim.stops.get(r.seq[(i + 1) % r.seq.length]);
          if (!a || !b) return;
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
        });
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.globalAlpha = 1;
    });
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
    if (this.hoverSeg >= 0 && !this.selSegs.includes(this.hoverSeg)) glow([this.hoverSeg], P.hover, 7);
    glow(this.selSegs, withAlpha(P.select, 0.24), 9);
    // Direction chevrons on the selected roads' lanes.
    ctx.strokeStyle = withAlpha(P.select, 0.75);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (const sid of this.selSegs) {
      for (const l of net.segs[sid].lanes) {
        if (l.closing || l.length < 14) continue;
        const dir = l.flip ? -1 : 1;
        const dx = l.dx * dir, dy = l.dy * dir;
        const px = -dy, py = dx;
        for (let s = 12; s < l.length - 6; s += 26) {
          const x = l.p0.x + l.dx * s, y = l.p0.y + l.dy * s;
          ctx.moveTo(x - dx * 2 + px * 1.8, y - dy * 2 + py * 1.8);
          ctx.lineTo(x + dx * 1, y + dy * 1);
          ctx.lineTo(x - dx * 2 - px * 1.8, y - dy * 2 - py * 1.8);
        }
      }
    }
    ctx.stroke();
  }

  buildingColor(P, b) {
    switch (b.type) {
      case B_HOUSE: return mix(P.house, P.house2, b.shade);
      case B_APARTMENT: return P.apartment;
      case B_OFFICE: return mix(P.office, P.office2, b.shade);
      case B_PARKING: return P.parking;
      default: return P.parkRide;
    }
  }

  drawBuildings(P) {
    const { ctx, sim } = this;
    for (const b of sim.buildings.values()) {
      const k = (b.dying ? ease.smooth(b.appear) : ease.outBack(b.appear)) * (1 + b.pulse * 0.035);
      if (k < 0.02) continue;
      const r = b.rect;
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      const w = r.w * k, h = r.h * k, x = cx - w / 2, y = cy - h / 2;
      const rad = b.type === B_HOUSE ? 4 : 3.5;
      ctx.fillStyle = P.shadow;
      ctx.beginPath();
      rrect(ctx, x + 0.5, y + 2.5, w, h, rad);
      ctx.fill();
      ctx.fillStyle = this.buildingColor(P, b);
      ctx.beginPath();
      rrect(ctx, x, y, w, h, rad);
      ctx.fill();

      ctx.fillStyle = P.window;
      if (b.type === B_HOUSE) {
        const home = b.people.filter((p) => p.state === PS_HOME).length / Math.max(1, b.people.length);
        if (P.glow > 0.05 && home > 0) {
          ctx.globalAlpha = Math.min(1, P.glow * (0.4 + home));
          ctx.beginPath();
          rrect(ctx, cx - w * 0.16, cy - h * 0.16, w * 0.32, h * 0.32, 1.5);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      } else if (b.type === B_APARTMENT) {
        ctx.beginPath();
        const ww = w * 0.16, wh = h * 0.13;
        for (let i = 0; i < 3; i++) {
          for (let j = 0; j < 3; j++) {
            rrect(ctx, x + w * (0.25 + i * 0.25) - ww / 2, y + h * (0.22 + j * 0.25), ww, wh, 1);
          }
        }
        ctx.fill();
      } else if (b.type === B_OFFICE) {
        ctx.beginPath();
        for (let j = 0; j < 3; j++) rrect(ctx, x + w * 0.14, y + h * (0.2 + j * 0.24), w * 0.72, h * 0.1, 1);
        ctx.fill();
      } else if (isLot(b)) {
        ctx.fillStyle = P.glyph;
        ctx.font = `800 ${b.type === B_PARKING ? 12 : 9.5}px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(b.type === B_PARKING ? 'P' : 'P+R', cx, cy + 0.5);
      }

      const sel = this.selected === b;
      if (this.hoverBuilding === b || sel) {
        ctx.strokeStyle = sel ? P.select : withAlpha(P.text, 0.45);
        ctx.lineWidth = sel ? 2 : 1.5;
        ctx.beginPath();
        rrect(ctx, x - 2, y - 2, w + 4, h + 4, rad + 2);
        ctx.stroke();
      }
      if (b.flash > 0) {
        ctx.strokeStyle = withAlpha(P.full, b.flash);
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        rrect(ctx, x - 3, y - 3, w + 6, h + 6, rad + 3);
        ctx.stroke();
      }
    }

    // Empty lots show up while hovered, so they can be built on.
    const lot = this.hoverLot || (this.selected && this.selected.access ? this.selected : null);
    if (lot && lot.building < 0) {
      const r = lot.rect;
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = withAlpha(P.text, 0.4);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      rrect(ctx, r.x + 3, r.y + 3, r.w - 6, r.h - 6, 4);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  ring(cx, cy, radius, frac, width, track, fill) {
    const { ctx } = this;
    ctx.lineCap = 'round';
    ctx.lineWidth = width;
    ctx.strokeStyle = track;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
    if (frac > 0.005) {
      ctx.strokeStyle = fill;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, frac));
      ctx.stroke();
    }
  }

  ringColor(P, frac) {
    if (frac >= 0.995) return P.full;
    if (frac > 0.75) return mix(P.ringFill, P.warn, (frac - 0.75) / 0.25);
    return P.ringFill;
  }

  drawRings(P) {
    const { sim } = this;
    for (const b of sim.buildings.values()) {
      if (!isLot(b) || b.appear < 0.05) continue;
      const r = b.rect;
      const k = b.dying ? ease.smooth(b.appear) : ease.outBack(b.appear);
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      const radius = Math.min(13.5, Math.min(r.w, r.h) / 2 - 4) * k;
      const full = b.parked >= b.capacity;
      const width = 3 + (full ? Math.sin(this.time * 7) * 0.7 + 0.7 : 0) + b.flash * 1.5;
      this.ring(cx, cy, radius, b.ring, width, P.ringTrack, b.flash > 0.05 ? P.full : this.ringColor(P, b.ring));
    }
  }

  drawStops(P) {
    const { ctx, sim } = this;
    for (const st of sim.stops.values()) {
      const k = st.dying ? ease.smooth(st.appear) : ease.outBack(st.appear);
      if (k < 0.02) continue;
      const routes = sim.stopRoutes(st);
      if (st.waiting.length || st.ring > 0.01) {
        this.ring(st.x, st.y, 8.5 * k, st.ring, 2.2, P.stopRingTrack, this.ringColor(P, st.ring));
      }
      if (routes.length) {
        const seg = (Math.PI * 2) / routes.length;
        ctx.lineWidth = 2.6;
        ctx.lineCap = 'butt';
        routes.forEach((r, i) => {
          ctx.strokeStyle = r.color;
          ctx.beginPath();
          ctx.arc(st.x, st.y, 5.6 * k, -Math.PI / 2 + i * seg, -Math.PI / 2 + (i + 1) * seg);
          ctx.stroke();
        });
      }
      ctx.fillStyle = P.stop;
      ctx.strokeStyle = P.stopEdge;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(st.x, st.y, 3.9 * k, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (this.hoverStop === st || this.selected === st) {
        ctx.strokeStyle = P.select;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(st.x, st.y, 8.5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  drawVehicles(P) {
    const { ctx, sim } = this;
    ctx.lineCap = 'round';
    for (const v of sim.vehicles) {
      if (v.state === VS_SPAWN || v.state === VS_GONE) continue;
      const alpha = v.state === VS_FADE ? Math.max(0, v.fade) : 1;
      const k = v.state === VS_LANE || v.state === VS_FADE ? ease.outBack(v.pop) : v.pop;
      if (k < 0.03 || alpha < 0.02) continue;
      const cos = Math.cos(v.ang), sin = Math.sin(v.ang);
      ctx.globalAlpha = alpha;
      if (v.kind === V_BUS) {
        ctx.save();
        ctx.translate(v.x, v.y);
        ctx.rotate(v.ang);
        ctx.scale(k, k);
        if (P.glow > 0.05) {
          ctx.fillStyle = withAlpha('#ffe7a8', 0.18 * P.glow);
          ctx.beginPath();
          ctx.ellipse(v.length / 2 + 6, 0, 8, 5, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = v.route.color;
        ctx.beginPath();
        rrect(ctx, -v.length / 2, -v.width / 2, v.length, v.width, 2.2);
        ctx.fill();
        const n = Math.ceil((v.passengers.length / C.BUS_CAP) * 10);
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const col = Math.floor(i / 2), row = i % 2;
          const px = -v.length / 2 + 3 + col * 3.1, py = row ? 1.2 : -1.2;
          ctx.moveTo(px + 0.85, py);
          ctx.arc(px, py, 0.85, 0, Math.PI * 2);
        }
        ctx.fill();
        ctx.restore();
      } else {
        const half = ((v.length - v.width) / 2) * k;
        ctx.strokeStyle = P.cars[v.shade];
        ctx.lineWidth = v.width * k;
        ctx.beginPath();
        ctx.moveTo(v.x - cos * half, v.y - sin * half);
        ctx.lineTo(v.x + cos * half, v.y + sin * half);
        ctx.stroke();
        if (P.glow > 0.05) {
          ctx.fillStyle = withAlpha('#ffe9b0', 0.85 * P.glow);
          const fx = v.x + cos * (v.length / 2 - 0.6) * k, fy = v.y + sin * (v.length / 2 - 0.6) * k;
          ctx.beginPath();
          ctx.arc(fx - sin * 1.3, fy + cos * 1.3, 0.75, 0, Math.PI * 2);
          ctx.arc(fx + sin * 1.3, fy - cos * 1.3, 0.75, 0, Math.PI * 2);
          ctx.fill();
        }
      }
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
      const r = C.DOT_R * ease.outBack(p.pop) * (1 - p.vanish);
      if (r < 0.05) continue;
      ctx.moveTo(p.x + r, p.y);
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  drawTools(P) {
    const { ctx } = this;
    const g = this.ghostStop;
    if (g) {
      ctx.fillStyle = withAlpha(P.select, 0.06);
      ctx.strokeStyle = withAlpha(P.select, 0.35);
      ctx.lineWidth = 1.2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.arc(g.x, g.y, C.WALK_RADIUS * 0.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = g.ok ? 0.85 : 0.35;
      ctx.fillStyle = P.stop;
      ctx.strokeStyle = g.ok ? P.stopEdge : P.full;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(g.x, g.y, 3.9, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    const d = this.draft;
    if (d) {
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeStyle = withAlpha(d.color, 0.75);
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (const pts of d.legs) pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
      const last = d.stops.length ? this.sim.stops.get(d.stops[d.stops.length - 1]) : null;
      if (last && d.mouse) {
        ctx.setLineDash([4, 5]);
        ctx.strokeStyle = withAlpha(d.color, 0.5);
        ctx.lineWidth = 2;
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
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(st.x, st.y, 7.5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  drawFx(P) {
    const { ctx, sim, cam } = this;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const size = 12.5 / Math.max(0.6, cam.z);
    for (const f of sim.fx) {
      const a = 1 - ease.smooth((f.t - 1.1) / 0.9);
      if (f.kind === 'ghost') {
        ctx.fillStyle = withAlpha(P.person, Math.max(0, 1 - f.t * 2));
        ctx.beginPath();
        ctx.arc(f.x, f.y - f.t * 6, C.DOT_R, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      const y = f.y - 16 * ease.outCubic(f.t / 1.4) / Math.max(0.6, cam.z);
      const color = f.kind === 'money' ? '#1f9d63' : '#e0533d';
      ctx.font = `800 ${size}px ${FONT}`;
      ctx.lineWidth = 3 / Math.max(0.6, cam.z);
      ctx.strokeStyle = withAlpha(P.bg, a * 0.9);
      ctx.strokeText(f.text, f.x, y);
      ctx.fillStyle = withAlpha(color, a);
      ctx.fillText(f.text, f.x, y);
    }
  }
}
