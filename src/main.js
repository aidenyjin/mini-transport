// Starts the game: wires the simulation, the canvas view and the interface together,
// and handles the camera, the mouse and the keyboard.

import { C } from './config.js';
import { clamp } from './model.js';
import { Sim } from './sim.js';
import { View } from './view.js';
import { Ui } from './ui.js';

class Game {
  constructor() {
    this.sim = new Sim(7);
    this.canvas = document.getElementById('world');
    this.view = new View(this.canvas, this.sim);
    this.speed = 1;
    this.paused = false;
    this.tool = 'select';
    this.wholeStreet = false;
    this.selSeg = -1;
    this.draft = null;
    this.drag = null;
    this.mouse = null;
    this.keys = new Set();
    this.zoomTarget = 1;
    this.zoomAnchor = null;
    this.ui = new Ui(this);
    this.sim.onChange = () => {
      this.ui.renderRoutes();
      this.ui.refreshCard();
    };
    this.sim.onDay = (s) => this.ui.showDay(s);
    this.resize();
    this.fit();
    this.bindInput();
    window.addEventListener('resize', () => this.resize());
    this.ui.syncSpeed();
    this.ui.syncTool();
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  resize() {
    this.view.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
  }

  fit() {
    // Leave room for the status bar above, the toolbar below and the routes list on the right.
    const m = this.sim.map;
    const left = 40, right = 290, top = 96, bottom = 96;
    const z = Math.min((this.view.W - left - right) / (m.w + 60), (this.view.H - top - bottom) / (m.h + 60));
    this.view.cam = {
      x: m.w / 2 + (right - left) / 2 / z,
      y: m.h / 2 + (bottom - top) / 2 / z,
      z,
    };
    this.zoomTarget = z;
  }

  frame(t) {
    const dt = Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    if (!this.paused) {
      const total = dt * this.speed;
      const n = Math.max(1, Math.ceil(total / C.MAX_STEP));
      for (let i = 0; i < n; i++) this.sim.step(total / n);
    }
    this.sim.animate(dt);
    this.updateCamera(dt);
    this.view.render(dt);
    this.ui.update(dt);
    requestAnimationFrame((t2) => this.frame(t2));
  }

  // --- Camera ----------------------------------------------------------------------------

  updateCamera(dt) {
    const cam = this.view.cam;
    const pan = (700 / cam.z) * dt;
    const k = this.keys;
    if (k.has('arrowup')) cam.y -= pan;
    if (k.has('arrowdown')) cam.y += pan;
    if (k.has('arrowleft')) cam.x -= pan;
    if (k.has('arrowright')) cam.x += pan;
    if (Math.abs(cam.z - this.zoomTarget) > 1e-4) {
      const a = this.zoomAnchor || { x: this.view.W / 2, y: this.view.H / 2 };
      const before = this.view.toWorld(a.x, a.y);
      cam.z += (this.zoomTarget - cam.z) * (1 - Math.exp(-dt * 14));
      const after = this.view.toWorld(a.x, a.y);
      cam.x += before.x - after.x;
      cam.y += before.y - after.y;
    }
    const m = this.sim.map;
    cam.x = clamp(cam.x, -150, m.w + 150);
    cam.y = clamp(cam.y, -150, m.h + 150);
  }

  zoomBy(f, anchor) {
    this.zoomTarget = clamp(this.zoomTarget * f, 0.45, 4);
    this.zoomAnchor = anchor;
  }

  // --- Input -------------------------------------------------------------------------------

  bindInput() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      const cam = this.view.cam;
      this.drag = { x: e.clientX, y: e.clientY, button: e.button, moved: false, camX: cam.x, camY: cam.y };
    });
    c.addEventListener('pointermove', (e) => {
      this.mouse = { x: e.clientX, y: e.clientY };
      const d = this.drag;
      if (d) {
        const dx = e.clientX - d.x, dy = e.clientY - d.y;
        if (!d.moved && Math.hypot(dx, dy) > 5) d.moved = true;
        if (d.moved) {
          const cam = this.view.cam;
          cam.x = d.camX - dx / cam.z;
          cam.y = d.camY - dy / cam.z;
          c.style.cursor = 'grabbing';
          return;
        }
      }
      this.hover();
    });
    c.addEventListener('pointerup', (e) => {
      const d = this.drag;
      this.drag = null;
      c.style.cursor = '';
      if (!d || d.moved) return;
      if (d.button === 0) this.click(this.view.toWorld(e.clientX, e.clientY), e);
      else if (d.button === 2) this.rightClick();
    });
    c.addEventListener('pointerleave', () => {
      this.mouse = null;
      this.hover();
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const at = { x: e.clientX, y: e.clientY };
      const cam = this.view.cam;
      if (e.ctrlKey) this.zoomBy(Math.exp(-e.deltaY * 0.012), at);
      else if (e.deltaMode === 1 || (Math.abs(e.deltaX) < 0.5 && Math.abs(e.deltaY) >= 40)) {
        this.zoomBy(e.deltaY < 0 ? 1.18 : 1 / 1.18, at);
      } else {
        cam.x += e.deltaX / cam.z;
        cam.y += e.deltaY / cam.z;
      }
    }, { passive: false });
    window.addEventListener('keydown', (e) => this.key(e));
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  key(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    this.keys.add(k);
    if (e.repeat) return;
    if (k === ' ') { this.setSpeed(this.paused ? this.speed : 0); e.preventDefault(); }
    else if (k === '1') this.setSpeed(1);
    else if (k === '2') this.setSpeed(2);
    else if (k === '3') this.setSpeed(4);
    else if (k === 'v') this.setTool('select');
    else if (k === 's') this.setTool('stop');
    else if (k === 'r') this.setTool('route');
    else if (k === 'enter' && this.draft && this.draft.stops.length >= 2) this.finishRoute(false);
    else if (k === '=' || k === '+') this.zoomBy(1.25);
    else if (k === '-' || k === '_') this.zoomBy(1 / 1.25);
    else if (k === 'escape') {
      if (this.draft) this.cancelDraft();
      else if (this.ui.cardKind) this.closeCard();
      else this.setTool('select');
    } else if ((k === 'delete' || k === 'backspace') && this.ui.cardKind === 'stop') {
      this.sim.removeStop(this.ui.cardData.id);
      this.closeCard();
    }
  }

  setSpeed(v) {
    if (v === 0) this.paused = true;
    else {
      this.paused = false;
      this.speed = v;
    }
    this.ui.syncSpeed();
  }

  setTool(t) {
    if (this.draft) this.cancelDraft();
    this.tool = t;
    this.view.tool = t;
    this.view.ghostStop = null;
    this.closeCard();
    this.ui.syncTool();
    this.hover();
  }

  // What's under the mouse, for highlights and the stop placement preview.
  hover() {
    const v = this.view, sim = this.sim;
    v.hoverSeg = -1;
    v.hoverBuilding = null;
    v.hoverStop = null;
    v.hoverLot = null;
    v.ghostStop = null;
    this.canvas.style.cursor = '';
    if (!this.mouse) return;
    const p = v.toWorld(this.mouse.x, this.mouse.y);
    if (this.draft) this.draft.mouse = p;
    if (this.tool === 'select') {
      const st = sim.stopAt(p);
      const b = st ? null : sim.buildingAt(p);
      const seg = st || b ? -1 : sim.net.segmentAt(p, 5);
      const lot = st || b || seg >= 0 ? null : sim.lotAt(p);
      v.hoverStop = st;
      v.hoverBuilding = b;
      v.hoverSeg = seg;
      v.hoverLot = lot && lot.building < 0 && lot.access.length ? lot : null;
      if (st || b || seg >= 0 || v.hoverLot) this.canvas.style.cursor = 'pointer';
    } else if (this.tool === 'stop') {
      const seg = sim.net.segmentAt(p, 16);
      if (seg >= 0) {
        const net = sim.net, s = net.segs[seg];
        const t = net.tOf(seg, p), side = net.sideOf(seg, p);
        const sp = net.sidewalk(seg, t, side);
        const ok = s.lanes.length > 0 && ![...sim.stops.values()].some((x) => x.seg === seg && !x.dying && Math.abs(x.t - t) * s.length < 26);
        v.ghostStop = { x: sp.x + s.rx * side * 1.5, y: sp.y + s.ry * side * 1.5, ok };
        this.canvas.style.cursor = 'crosshair';
      }
    } else if (this.tool === 'route') {
      v.hoverStop = sim.stopAt(p, 12);
      if (v.hoverStop) this.canvas.style.cursor = 'pointer';
    }
  }

  click(p, e) {
    const sim = this.sim;
    const screen = { x: e.clientX, y: e.clientY };
    if (this.tool === 'select') {
      const st = sim.stopAt(p);
      if (st) { this.openCard('stop', st, screen); return; }
      const b = sim.buildingAt(p);
      if (b) { this.openCard('building', b, screen); return; }
      const sid = sim.net.segmentAt(p, 5);
      if (sid >= 0) {
        this.selSeg = sid;
        const segs = this.wholeStreet ? sim.net.streetOf(sid) : [sid];
        this.view.selected = null;
        this.view.selSegs = segs;
        this.ui.openCard('road', segs, screen);
        return;
      }
      const lot = sim.lotAt(p);
      if (lot && lot.building < 0 && lot.access.length) { this.openCard('lot', lot, screen); return; }
      this.closeCard();
    } else if (this.tool === 'stop') {
      const sid = sim.net.segmentAt(p, 16);
      if (sid >= 0) sim.placeStop(sid, p);
      this.hover();
    } else if (this.tool === 'route') {
      const st = sim.stopAt(p, 12);
      if (!st) return;
      if (!this.draft) this.draft = { stops: [], color: sim.nextRouteColor(), legs: [], mouse: p };
      const d = this.draft;
      const n = d.stops.length;
      if (n >= 2 && st.id === d.stops[0]) this.finishRoute(true);
      else if (n >= 2 && st.id === d.stops[n - 1]) this.finishRoute(false);
      else if (!d.stops.includes(st.id)) {
        d.stops.push(st.id);
        this.updateDraft();
      }
      this.ui.syncHint();
    }
  }

  rightClick() {
    if (this.draft) {
      if (this.draft.stops.length >= 2) this.finishRoute(false);
      else this.cancelDraft();
    } else this.closeCard();
  }

  updateDraft() {
    const d = this.draft, net = this.sim.net;
    d.legs = [];
    for (let i = 0; i < d.stops.length - 1; i++) {
      const a = this.sim.stops.get(d.stops[i]), b = this.sim.stops.get(d.stops[i + 1]);
      const hops = net.drivePath(a.seg, a.t, b.seg, b.t, true);
      d.legs.push(hops.length ? net.hopsPoints(hops, a.t, b.t) : [a, b]);
    }
    this.view.draft = d;
  }

  finishRoute(loop) {
    this.sim.createRoute(this.draft.stops, loop);
    this.cancelDraft();
  }

  cancelDraft() {
    this.draft = null;
    this.view.draft = null;
    this.ui.syncHint();
  }

  openCard(kind, data, screen) {
    this.view.selSegs = [];
    this.view.selected = data;
    this.ui.openCard(kind, data, screen);
  }

  closeCard() {
    this.ui.closeCard();
    this.view.selSegs = [];
    this.view.selected = null;
  }

  toggleWholeStreet() {
    this.wholeStreet = !this.wholeStreet;
    if (this.selSeg < 0) return;
    const segs = this.wholeStreet ? this.sim.net.streetOf(this.selSeg) : [this.selSeg];
    this.view.selSegs = segs;
    this.ui.cardData = segs;
    this.ui.refreshCard();
  }
}

window.game = new Game();
