// The HTML interface around the map: status bar, speed and tool buttons, the routes
// list, and the pop-up cards (road editor, buildings, empty lots, stops).

import { C } from './config.js';
import {
  LANE_BUS, B_OFFICE, BUILDING_NAMES, PS_WORK, isLot, isHome,
} from './model.js';

const svg = (body, vb = '0 0 20 20') =>
  `<svg viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const ICONS = {
  pause: svg('<rect x="5" y="4" width="3.2" height="12" rx="1.4" fill="currentColor" stroke="none"/><rect x="11.8" y="4" width="3.2" height="12" rx="1.4" fill="currentColor" stroke="none"/>'),
  play1: svg('<path d="M7 4.5 L15 10 L7 15.5 Z" fill="currentColor"/>'),
  play2: svg('<path d="M3.5 5 L10 10 L3.5 15 Z M10.5 5 L17 10 L10.5 15 Z" fill="currentColor"/>'),
  play3: svg('<path d="M1.5 6 L6.5 10 L1.5 14 Z M7.5 6 L12.5 10 L7.5 14 Z M13.5 6 L18.5 10 L13.5 14 Z" fill="currentColor" stroke-width="1.4"/>'),
  select: svg('<path d="M5 3 L15.5 11 L10.6 11.8 L13.2 17 L11 18 L8.4 12.8 L5 16 Z" fill="currentColor" stroke-width="1.2"/>'),
  stop: svg('<circle cx="10" cy="10" r="6.2" stroke-width="2.4"/><circle cx="10" cy="10" r="2" fill="currentColor" stroke="none"/>'),
  route: svg('<path d="M4 15 L4 9 Q4 6 7 6 L13 6 Q16 6 16 9 L16 11" stroke-width="2.4"/><circle cx="4" cy="15" r="2.4" fill="currentColor" stroke="none"/><circle cx="16" cy="13" r="2.4" fill="currentColor" stroke="none"/>'),
  close: svg('<path d="M5 5 L15 15 M15 5 L5 15" stroke-width="2.4"/>'),
  flip: svg('<path d="M4 7 H15 M12 4 L15 7 L12 10 M16 13 H5 M8 10 L5 13 L8 16"/>'),
  trash: svg('<path d="M4 6 H16 M8 6 V4.5 H12 V6 M6 6 L7 16 H13 L14 6"/>'),
};

// Used inside a double-quoted style attribute, so no double quotes, and single quotes escaped.
const chevron = (d) => `url('data:image/svg+xml,${encodeURIComponent(d).replace(/'/g, '%27')}')`;
const CHEVRONS = {
  right: chevron("<svg xmlns='http://www.w3.org/2000/svg' width='22' height='34'><path d='M9 13 L13 17 L9 21' fill='none' stroke='#8a8478' stroke-opacity='0.5' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/></svg>"),
  left: chevron("<svg xmlns='http://www.w3.org/2000/svg' width='22' height='34'><path d='M13 13 L9 17 L13 21' fill='none' stroke='#8a8478' stroke-opacity='0.5' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/></svg>"),
  down: chevron("<svg xmlns='http://www.w3.org/2000/svg' width='40' height='22'><path d='M16 9 L20 13 L24 9' fill='none' stroke='#8a8478' stroke-opacity='0.5' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/></svg>"),
  up: chevron("<svg xmlns='http://www.w3.org/2000/svg' width='40' height='22'><path d='M16 13 L20 9 L24 13' fill='none' stroke='#8a8478' stroke-opacity='0.5' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/></svg>"),
};

const MODE_NAMES = { car: 'drive', bus: 'bus', pr: 'park & ride', walk: 'walk' };

export const money = (n) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export class Ui {
  constructor(game) {
    this.game = game;
    this.sim = game.sim;
    this.$ = (id) => document.getElementById(id);
    this.card = this.$('card');
    this.cardKind = null;
    this.cardData = null;
    this._liveT = 0;
    this._lastMoney = null;
    this._toastTimer = 0;
    this.buildSpeed();
    this.buildToolbar();
    this.renderRoutes();
    this.bindCard();
    this.bindRoutes();
  }

  // --- Per-frame updates ---------------------------------------------------------------

  update(dt) {
    const sim = this.sim;
    const m = Math.floor(sim.minute);
    this.$('time').textContent = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    this.$('day').textContent = `Day ${sim.day}`;
    const mEl = this.$('money');
    if (this._lastMoney !== sim.money) {
      mEl.textContent = money(sim.money);
      mEl.style.color = sim.money < 0 ? 'var(--danger)' : '';
      if (this._lastMoney !== null && Math.abs(sim.money - this._lastMoney) >= 50) {
        mEl.classList.remove('bump');
        void mEl.offsetWidth;
        mEl.classList.add('bump');
      }
      this._lastMoney = sim.money;
    }
    this.$('share').textContent = `${Math.round(sim.transitShare() * 100)}%`;
    this.$('missed').textContent = String(sim.stats.missed);

    const p = sim.minute / 1440;
    const a = -Math.PI / 2 + p * Math.PI * 2;
    const x = 22 + Math.cos(a) * 17, y = 22 + Math.sin(a) * 17;
    this.$('clock-arc').setAttribute('d', p > 0.001 ? `M 22 5 A 17 17 0 ${p > 0.5 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)}` : '');
    this.$('clock-sun').setAttribute('cx', x.toFixed(2));
    this.$('clock-sun').setAttribute('cy', y.toFixed(2));
    document.body.classList.toggle('night', sim.night() > 0.5);

    this._liveT -= dt;
    if (this._liveT <= 0) {
      this._liveT = 0.25;
      this.updateLive();
    }
    if (this._toastTimer > 0) {
      this._toastTimer -= dt;
      if (this._toastTimer <= 0) this.$('toast').classList.remove('show');
    }
  }

  updateLive() {
    for (const el of document.querySelectorAll('[data-live]')) {
      const fn = this._live && this._live[el.dataset.live];
      if (fn) el.textContent = fn();
    }
  }

  // --- Speed and tools -------------------------------------------------------------------

  buildSpeed() {
    const speeds = [['pause', 0, 'Pause (Space)'], ['play1', 1, 'Normal speed (1)'], ['play2', 2, 'Fast (2)'], ['play3', 4, 'Fastest (3)']];
    const el = this.$('speed');
    el.innerHTML = speeds.map(([icon, v, title]) =>
      `<button class="icon-btn" data-speed="${v}" title="${title}">${ICONS[icon]}</button>`).join('');
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-speed]');
      if (b) this.game.setSpeed(Number(b.dataset.speed));
    });
  }

  syncSpeed() {
    const g = this.game;
    for (const b of this.$('speed').children) {
      const v = Number(b.dataset.speed);
      b.classList.toggle('on', g.paused ? v === 0 : v === g.speed);
    }
  }

  buildToolbar() {
    const tools = [['select', 'Select', 'V'], ['stop', 'Bus stop', 'S'], ['route', 'Bus route', 'R']];
    const el = this.$('toolbar');
    el.innerHTML = tools.map(([id, label, key]) =>
      `<button class="tool-btn" data-tool="${id}">${ICONS[id]}<span>${label}</span><kbd>${key}</kbd></button>`).join('');
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-tool]');
      if (b) this.game.setTool(b.dataset.tool);
    });
  }

  syncTool() {
    for (const b of this.$('toolbar').children) b.classList.toggle('on', b.dataset.tool === this.game.tool);
    this.syncHint();
  }

  syncHint() {
    const g = this.game;
    let text = '';
    if (g.tool === 'stop') text = `Click beside a road to place a stop · ${money(C.COST_STOP)}`;
    else if (g.tool === 'route') {
      const n = g.draft ? g.draft.stops.length : 0;
      if (n === 0) text = 'Click a bus stop to start a route';
      else if (n === 1) text = 'Click the next stop · Esc to cancel';
      else text = `Click the last stop again to finish (${money(C.COST_ROUTE)}) · the first stop makes a loop`;
    }
    const el = this.$('hint');
    if (text) el.textContent = text;
    el.classList.toggle('show', !!text);
  }

  // --- Routes list -------------------------------------------------------------------------

  renderRoutes() {
    const routes = this.sim.routes;
    const el = this.$('routes');
    if (!routes.length) {
      el.innerHTML = '<h3>Routes</h3><div class="empty">Place a few <b>bus stops</b> with S, then draw a <b>bus route</b> through them with R.</div>';
      return;
    }
    el.innerHTML = '<h3>Routes</h3>' + routes.map((r) => `
      <div class="route-row" data-route="${r.id}">
        <div class="route-dot" style="background:${r.color}"></div>
        <div class="route-name">${r.name}</div>
        <div class="route-actions">
          <button class="mini" data-act="busMinus" title="Take a bus off this route">−</button>
          <span class="count">${r.buses.length}</span>
          <button class="mini" data-act="busPlus" title="Add a bus (${money(C.COST_BUS)})">+</button>
          <button class="mini" data-act="delete" title="Delete route">${ICONS.trash}</button>
        </div>
        <div class="route-meta">${r.buses.length} ${r.buses.length === 1 ? 'bus' : 'buses'} ·${r.stops.length} stops${r.loop ? ' · loop' : ''}${r.broken ? ' · <span style="color:var(--danger)">no road</span>' : ''} · <span data-live="riders-${r.id}">${r.ridersToday}</span> riders today</div>
      </div>`).join('');
    this._live = this._live || {};
    for (const r of routes) this._live[`riders-${r.id}`] = () => String(r.ridersToday);
  }

  bindRoutes() {
    const el = this.$('routes');
    const routeOf = (e) => {
      const row = e.target.closest('[data-route]');
      return row ? this.sim.routes.find((r) => r.id === Number(row.dataset.route)) : null;
    };
    el.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      const r = routeOf(e);
      if (!btn || !r) return;
      const act = btn.dataset.act;
      if (act === 'busPlus') this.sim.addBus(r);
      else if (act === 'busMinus') this.sim.removeBus(r);
      else if (act === 'delete') this.sim.deleteRoute(r);
    });
    el.addEventListener('mouseover', (e) => { this.game.view.highlightRoute = routeOf(e); });
    el.addEventListener('mouseleave', () => { this.game.view.highlightRoute = null; });
  }

  // --- Cards ---------------------------------------------------------------------------------

  openCard(kind, data, screen) {
    this.cardKind = kind;
    this.cardData = data;
    this._live = this._live || {};
    this.card.innerHTML = this.cardHtml();
    const vw = window.innerWidth, vh = window.innerHeight;
    const w = this.card.offsetWidth, h = this.card.offsetHeight;
    let x = screen.x + 22, y = screen.y - 24;
    if (x + w > vw - 16) x = screen.x - w - 22;
    x = Math.max(16, Math.min(x, vw - w - 16));
    y = Math.max(76, Math.min(y, vh - h - 90));
    this.card.style.left = `${x}px`;
    this.card.style.top = `${y}px`;
    this.card.style.transformOrigin = `${screen.x - x}px ${screen.y - y}px`;
    this.card.classList.add('hidden');
    void this.card.offsetWidth;
    this.card.classList.remove('hidden');
  }

  closeCard() {
    this.cardKind = null;
    this.cardData = null;
    this.card.classList.add('hidden');
  }

  refreshCard() {
    if (!this.cardKind) return;
    const d = this.cardData;
    if ((this.cardKind === 'building' && (!this.sim.buildings.has(d.id) || d.dying)) ||
        (this.cardKind === 'stop' && (!this.sim.stops.has(d.id) || d.dying)) ||
        (this.cardKind === 'lot' && d.building >= 0)) {
      this.game.closeCard();
      return;
    }
    this.card.innerHTML = this.cardHtml();
  }

  cardHtml() {
    switch (this.cardKind) {
      case 'road': return this.roadHtml(this.cardData);
      case 'building': return this.buildingHtml(this.cardData);
      case 'lot': return this.lotHtml(this.cardData);
      case 'stop': return this.stopHtml(this.cardData);
      default: return '';
    }
  }

  head(title, sub) {
    return `<div class="card-head"><div class="titles"><div class="card-title">${title}</div>` +
      `<div class="card-sub">${sub}</div></div><button class="card-close" data-act="close" title="Close (Esc)">${ICONS.close}</button></div>`;
  }

  roadHtml(segs) {
    const net = this.sim.net;
    const sid = segs[0];
    const s = net.segs[sid];
    const { horiz, lanes } = net.displayLanes(sid);
    const lanesHtml = lanes.map((l, i) => {
      const d = l.flip ? -l.dir : l.dir;
      const arrow = horiz ? (s.dx * d > 0 ? 'right' : 'left') : (s.dy * d > 0 ? 'down' : 'up');
      const bus = l.type === LANE_BUS;
      return `<div class="lane${bus ? ' bus' : ''}" data-i="${i}" style="background-image:${CHEVRONS[arrow]}" title="Click to make this a ${bus ? 'car' : 'bus'} lane">
        <span class="lane-label">${bus ? 'Bus' : 'Car'}</span>
        <div class="lane-tools">
          <button data-act="flip" data-i="${i}" title="Reverse direction (${money(C.COST_LANE_FLIP)})">${ICONS.flip}</button>
          <button data-act="remove" data-i="${i}" title="Remove lane (${money(C.COST_LANE_REMOVE)})">${ICONS.close}</button>
        </div></div>`;
    }).join('');
    const full = lanes.length >= C.MAX_LANES ? 'disabled' : '';
    const title = lanes.length ? (segs.length > 1 ? 'Street' : 'Road') : 'Pedestrian street';
    const sub = `${plural(lanes.length, 'lane')} · ${plural(segs.length, 'block')}`;
    const per = segs.length > 1 ? ` (× ${segs.length})` : '';
    const empty = lanes.length ? '' : '<div class="no-lanes">People only</div>';
    return `${this.head(title, sub)}
      <div class="xsec ${horiz ? 'horiz' : 'vert'}">
        <button class="add-lane" data-act="addStart" ${full} title="Add a lane (${money(C.COST_LANE_ADD)})">+</button>
        <div class="lanes">${lanesHtml}${empty}</div>
        <button class="add-lane" data-act="addEnd" ${full} title="Add a lane (${money(C.COST_LANE_ADD)})">+</button>
      </div>
      <div class="card-foot">
        <span class="costs">Add ${money(C.COST_LANE_ADD)} · Bus lane ${money(C.COST_LANE_TYPE)}${per}<br>Reverse ${money(C.COST_LANE_FLIP)} · Remove ${money(C.COST_LANE_REMOVE)}</span>
        <button class="pill${this.game.wholeStreet ? ' on' : ''}" data-act="street" title="Edit every block of this street at once">Whole street</button>
      </div>`;
  }

  buildingHtml(b) {
    const sim = this.sim;
    const name = BUILDING_NAMES[b.type];
    let sub = '', lines = '';
    if (isHome(b)) {
      sub = plural(b.people.length, 'resident');
      this._live.homeModes = () => this.modeSummary(b.people);
      lines = `<div class="card-lines"><span class="k">Today:</span> <span data-live="homeModes">${this.modeSummary(b.people)}</span></div>`;
    } else if (b.type === B_OFFICE) {
      sub = `${b.people.length} of ${plural(b.capacity, 'job')} filled`;
      this._live.atWork = () => `${b.people.filter((p) => p.state === PS_WORK).length} at work now`;
      lines = `<div class="card-lines"><span data-live="atWork">${this._live.atWork()}</span><br><span class="k">Arrived by:</span> ${this.modeSummary(b.people)}</div>`;
    } else if (isLot(b)) {
      this._live.parked = () => `${b.parked} of ${b.capacity} spaces taken`;
      sub = `<span data-live="parked">${this._live.parked()}</span>`;
      lines = '<div class="card-lines">Cars drive in, people walk out.</div>';
    }
    const cost = sim.demolishCost(b);
    return `${this.head(name, sub)}${lines}
      <button class="action danger" data-act="demolish"><span>Demolish</span><span class="price">${money(cost)}</span></button>`;
  }

  modeSummary(people) {
    const counts = {};
    for (const p of people) {
      if (p.missed) counts.missed = (counts.missed || 0) + 1;
      else if (p.mode) counts[p.mode] = (counts[p.mode] || 0) + 1;
    }
    const parts = Object.entries(counts).map(([k, n]) => `${n} ${k === 'missed' ? 'missed work' : MODE_NAMES[k]}`);
    return parts.length ? parts.join(' · ') : 'nobody has left yet';
  }

  lotHtml(lot) {
    const sub = lot.cleared ? 'Cleared' : 'The city may build here';
    return `${this.head('Empty lot', sub)}
      <div class="card-lines">A park &amp; ride lets drivers leave their car<br>here and finish their trip by bus.</div>
      <button class="action primary" data-act="parkride"><span>Build park &amp; ride</span><span class="price">${money(C.COST_PARK_RIDE)}</span></button>`;
  }

  stopHtml(st) {
    const routes = this.sim.stopRoutes(st);
    this._live.waiting = () => `${st.waiting.length} waiting`;
    const chips = routes.map((r) => `<span class="chip" style="background:${r.color}">${r.name}</span>`).join('');
    return `${this.head('Bus stop', `<span data-live="waiting">${this._live.waiting()}</span>`)}
      ${routes.length ? `<div class="chips">${chips}</div>` : '<div class="card-lines">No routes stop here yet.</div>'}
      <button class="action danger" data-act="removeStop"><span>Remove stop</span><span class="price">free</span></button>`;
  }

  bindCard() {
    this.card.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.card.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      const lane = e.target.closest('.lane');
      if (btn) this.cardAction(btn.dataset.act, Number(btn.dataset.i), e);
      else if (lane) this.cardAction('type', Number(lane.dataset.i), e);
    });
  }

  cardAction(act, i, e) {
    const g = this.game, sim = this.sim, d = this.cardData;
    if (act === 'close') { g.closeCard(); return; }
    const at = g.view.toWorld(e.clientX, e.clientY);
    if (this.cardKind === 'road') {
      if (act === 'street') g.toggleWholeStreet();
      else sim.editLanes(d, act, i, at);
    } else if (act === 'demolish') {
      if (sim.demolish(d.id)) g.closeCard();
    } else if (act === 'parkride') {
      if (sim.buildParkRide(d.id)) g.closeCard();
    } else if (act === 'removeStop') {
      sim.removeStop(d.id);
      g.closeCard();
    }
  }

  // --- Toast ---------------------------------------------------------------------------------

  showDay(s) {
    const net = s.grant - s.upkeep + s.fares;
    const el = this.$('toast');
    el.innerHTML = `Day ${s.day} done<span class="sep">|</span><b>${Math.round(s.transit * 100)}%</b>&nbsp;by transit` +
      `<span class="sep">|</span><b>${s.missed}</b>&nbsp;missed work<span class="sep">|</span><b>${money(net)}</b>&nbsp;earned`;
    el.classList.add('show');
    this._toastTimer = 6;
  }
}
