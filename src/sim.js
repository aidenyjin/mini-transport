// The whole simulation: clock, money, city growth, people's trips, cars, buses and
// parking. The view only reads from it; the UI changes it through the public methods
// near the bottom.

import { C } from './config.js';
import {
  LANE_CAR, LANE_BUS, B_HOUSE, B_APARTMENT, B_OFFICE, B_PARKING, B_PARK_RIDE,
  ZONE_RES, ZONE_MID, ZONE_CORE, V_CAR, V_BUS,
  VS_SPAWN, VS_LANE, VS_CROSS, VS_PARK, VS_GONE,
  PS_HOME, PS_WORK, PS_WALK, PS_WAIT, PS_BOARD, PS_BUS, PS_CAR, PS_ENTER, PS_GONE,
  isLot, isHome, clamp, dist, dist2, vlerp, bezier, bezierTangent, polyLength, Rng,
} from './model.js';
import { RoadNetwork } from './roads.js';
import { buildMap } from './mapgen.js';

export const VS_FADE = 5;          // vanishing in place (bus taken off a route, gridlock)

const ROUTE_COLORS = ['#e8483a', '#2e86de', '#f2a31b', '#22a06b', '#8e5cd9', '#e4639b', '#16a3b8'];

function freshStats() {
  return { car: 0, bus: 0, pr: 0, walk: 0, missed: 0, riders: 0, fares: 0 };
}

export class Sim {
  constructor(seed = 7) {
    this.rng = new Rng(seed);
    this.net = new RoadNetwork();
    this.lots = [];
    this.buildings = new Map();
    this.stops = new Map();
    this.routes = [];
    this.people = [];
    this.vehicles = [];
    this.crossing = new Map();     // node -> vehicles inside that intersection
    this.map = null;
    this.day = 1;
    this.minute = C.START_MINUTE;
    this.time = 0;
    this.money = C.START_MONEY;
    this.stats = freshStats();
    this.lastDay = null;
    this.carDelay = 1;             // how much slower driving is than free-flow, learned
    this.fx = [];
    this.onDay = null;
    this.onChange = null;
    this._queue = [];
    this._qi = 0;
    this._nextId = 1;
    this._growAcc = 0;
    this._routeVersion = -1;
    this._routeCount = 0;
    buildMap(this);
    this.net.update(0);
    for (const st of this.stops.values()) this._positionStop(st);
    this._scheduleDay();
  }

  _id() { return this._nextId++; }

  // --- Clock -----------------------------------------------------------------

  clockRate(m) {
    const keys = C.CLOCK_KEYS;
    for (let i = 0; i < keys.length - 1; i++) {
      const [m0, r0] = keys[i], [m1, r1] = keys[i + 1];
      if (m <= m1) return r0 + (r1 - r0) * ((m - m0) / (m1 - m0));
    }
    return keys[keys.length - 1][1];
  }

  // 0 in daylight, 1 at night, eased through dawn and dusk.
  night() {
    const m = this.minute;
    const ease = (t) => t * t * (3 - 2 * t);
    if (m < 270) return 1;
    if (m < 390) return 1 - ease((m - 270) / 120);
    if (m < 1050) return 0;
    if (m < 1230) return ease((m - 1050) / 180);
    return 1;
  }

  absMinute() { return this.day * 1440 + this.minute; }

  // --- Main loop ---------------------------------------------------------------

  step(dt) {
    this.time += dt;
    this.minute += dt * this.clockRate(this.minute);
    if (this.minute >= 1440) {
      this.minute -= 1440;
      this._endDay();
    }
    if (this._routeVersion !== this.net.version) this._rebuildRoutes();
    this._departures();
    this._updateLanes(dt);
    this._intersections();
    this._updateCrossing(dt);
    this._updateOtherVehicles(dt);
    this._updatePeople(dt);
    this._growth(dt);
    if (this.vehicles.some((v) => v.state === VS_GONE)) {
      this.vehicles = this.vehicles.filter((v) => v.state !== VS_GONE);
    }
    if (this.people.some((p) => p.state === PS_GONE)) {
      this.people = this.people.filter((p) => p.state !== PS_GONE);
    }
  }

  // Runs every frame, even when paused: lane widths, building pop-ins, rings, effects.
  animate(dt) {
    this.net.update(dt);
    const k = 1 - Math.exp(-dt * 6);
    for (const b of this.buildings.values()) {
      if (b.dying) {
        b.appear -= dt * 3.5;
        if (b.appear <= 0) this._removeBuilding(b);
      } else if (b.appear < 1) b.appear = Math.min(1, b.appear + dt * 2.2);
      if (isLot(b)) b.ring += (Math.min(1, b.parked / b.capacity) - b.ring) * k;
      b.flash = Math.max(0, b.flash - dt * 1.4);
      b.pulse = Math.max(0, b.pulse - dt * 4);
    }
    for (const st of [...this.stops.values()]) {
      this._positionStop(st);
      if (st.dying) {
        st.appear -= dt * 4;
        if (st.appear <= 0) this.stops.delete(st.id);
      } else st.appear = Math.min(1, st.appear + dt * 3);
      st.ring += (Math.min(1, st.waiting.length / C.STOP_CAP) - st.ring) * k;
    }
    for (const r of this.routes) r.appear = Math.min(1, r.appear + dt * 2.5);
    this._vehiclePositions(dt);
    for (const f of this.fx) f.t += dt;
    if (this.fx.length && this.fx[0].t > 2) this.fx = this.fx.filter((f) => f.t <= 2);
  }

  // --- Days and departures -------------------------------------------------------

  _scheduleDay() {
    this._queue = [];
    this._qi = 0;
    for (const p of this.people) {
      if (p.work < 0) continue;
      const am = clamp(this.rng.normal(C.AM_PEAK, C.AM_SPREAD), 340, 660);
      const pm = clamp(this.rng.normal(C.PM_PEAK, C.PM_SPREAD), 930, 1230);
      this._queue.push([am, p, true], [pm, p, false]);
    }
    this._queue.sort((a, b) => a[0] - b[0]);
  }

  _departures() {
    while (this._qi < this._queue.length && this._queue[this._qi][0] <= this.minute) {
      const [, p, morning] = this._queue[this._qi++];
      if (p.state === PS_GONE) continue;
      if (morning) this._leaveHome(p);
      else this._leaveWork(p);
    }
  }

  _endDay() {
    const buses = this.routes.reduce((n, r) => n + r.buses.length, 0);
    const upkeep = buses * C.BUS_UPKEEP;
    this.money += C.DAILY_GRANT - upkeep;
    const s = this.stats;
    const trips = s.car + s.bus + s.pr + s.walk + s.missed;
    this.lastDay = {
      day: this.day, ...s, trips, grant: C.DAILY_GRANT, upkeep,
      transit: trips ? (s.bus + s.pr) / trips : 0,
    };
    this.day++;
    this.stats = freshStats();
    for (const r of this.routes) r.ridersToday = 0;
    for (const p of this.people) if (p.work < 0 && p.state !== PS_GONE) this._assignJob(p);
    this._scheduleDay();
    if (this.onDay) this.onDay(this.lastDay);
  }

  transitShare() {
    const s = this.stats;
    const trips = s.car + s.bus + s.pr + s.walk + s.missed;
    return trips ? (s.bus + s.pr) / trips : 0;
  }

  // --- City ----------------------------------------------------------------------

  addBuilding(lot, type, appear = 0) {
    if (!lot.access.length || lot.building >= 0) return null;
    const acc = lot.access.length > 1 ? this.rng.pick(lot.access) : lot.access[0];
    const pad = [3, 5, 3, 4, 5][type];
    const r = { x: lot.rect.x + pad, y: lot.rect.y + pad, w: lot.rect.w - 2 * pad, h: lot.rect.h - 2 * pad };
    const door = {
      l: { x: r.x, y: r.y + r.h / 2 }, r: { x: r.x + r.w, y: r.y + r.h / 2 },
      t: { x: r.x + r.w / 2, y: r.y }, b: { x: r.x + r.w / 2, y: r.y + r.h },
    }[acc.edge];
    const t = this.net.tOf(acc.seg, door);
    let capacity;
    if (type === B_HOUSE) capacity = this.rng.int(...C.HOUSE_PEOPLE);
    else if (type === B_APARTMENT) capacity = this.rng.int(...C.APARTMENT_PEOPLE);
    else if (type === B_OFFICE) capacity = this.rng.int(...C.OFFICE_JOBS);
    else if (type === B_PARKING) capacity = C.CITY_PARKING_CAP;
    else capacity = C.PARK_RIDE_CAP;
    // Visual height: downtown towers rise above the rest.
    const rng = this.rng;
    const height = [6, rng.range(12, 17), lot.zone === ZONE_CORE ? rng.range(20, 32) : rng.range(13, 20), 8, 6][type];
    const b = {
      id: this._id(), type, lot: lot.id, rect: r, seg: acc.seg, t, side: acc.side, edge: acc.edge, door,
      place: { x: door.x, y: door.y, seg: acc.seg, t, side: acc.side },
      capacity, people: [], parked: 0, incoming: 0, appear, dying: false,
      ring: 0, flash: 0, pulse: 0, shade: rng.next(), height, layout: rng.int(0, 2),
    };
    this.buildings.set(b.id, b);
    lot.building = b.id;
    if (isHome(b)) {
      for (let i = 0; i < capacity; i++) this._newPerson(b);
    } else if (type === B_OFFICE) {
      for (const p of this.people) {
        if (b.people.length >= b.capacity) break;
        if (p.work < 0 && p.state !== PS_GONE) { p.work = b.id; b.people.push(p); }
      }
    }
    return b;
  }

  _newPerson(home) {
    const rng = this.rng;
    const p = {
      id: this._id(), home: home.id, work: -1, hasCar: rng.next() < C.CAR_OWNERSHIP,
      bias: rng.range(0.85, 1.4), state: PS_HOME, toWork: true, legs: [], legI: 0,
      mode: '', plan: null, carLot: -1, leaveAt: -1, leaveLate: false, missed: false,
      path: null, pathLen: 0, dist: 0, pathI: 0, pathD: 0,
      speed: rng.range(11.5, 14.5), jitter: rng.range(-1.3, 1.3),
      x: home.door.x, y: home.door.y, pop: 1, vanish: 0, anim: 0, from: null, to: null,
      after: '', stop: -1, waitSince: 0, vehicle: null,
    };
    home.people.push(p);
    this.people.push(p);
    this._assignJob(p);
    return p;
  }

  _assignJob(p) {
    const offices = [];
    for (const b of this.buildings.values()) {
      if (b.type === B_OFFICE && !b.dying && b.people.length < b.capacity) offices.push(b);
    }
    if (!offices.length) return;
    const o = this.rng.pick(offices);
    p.work = o.id;
    o.people.push(p);
  }

  _growth(dt) {
    if (this.minute < 360 || this.minute > 1200) return;
    this._growAcc += dt * this.clockRate(this.minute);
    if (this._growAcc < C.GROW_EVERY) return;
    this._growAcc = this.rng.range(-40, 40);
    let residents = 0, jobs = 0;
    for (const b of this.buildings.values()) {
      if (isHome(b)) residents += b.people.length;
      else if (b.type === B_OFFICE) jobs += b.capacity;
    }
    const office = jobs < residents * 1.05;
    const zones = office ? [ZONE_CORE, ZONE_MID] : [ZONE_RES, ZONE_MID];
    const free = this.lots.filter((l) => l.building < 0 && !l.cleared && l.access.length && zones.includes(l.zone));
    if (!free.length) return;
    let type = B_OFFICE;
    if (!office) type = this.rng.next() < 0.18 ? B_APARTMENT : B_HOUSE;
    this.addBuilding(this.rng.pick(free), type, 0);
    this._changed();
  }

  _removeBuilding(b) {
    this.buildings.delete(b.id);
    const lot = this.lots[b.lot];
    lot.building = -1;
    lot.cleared = true;
    this._changed();
  }

  _lots() {
    const out = [];
    for (const b of this.buildings.values()) if (isLot(b) && !b.dying) out.push(b);
    return out;
  }

  _lotHasRoom(b) { return b.parked + b.incoming < b.capacity; }

  _changed() { if (this.onChange) this.onChange(); }

  _fx(x, y, text, kind) { this.fx.push({ x, y, text, kind, t: 0 }); }

  // --- Trip planning ---------------------------------------------------------------

  _walkLeg(from, to) {
    return { type: 'walk', from: from.place || from, to: to.place || to, toB: to.place ? to.id : -1 };
  }

  _stopsNear(place, radius) {
    const out = [];
    for (const st of this.stops.values()) {
      if (st.dying) continue;
      const w = this.net.walkEstimate(place.seg, place.t, st.seg, st.t);
      if (w <= radius) out.push([st, w]);
    }
    return out;
  }

  _cycleTime(r) { return r.cycleLen / C.BUS_SPEED + r.seq.length * C.DWELL_EST; }

  _waitTime(r) { return this._cycleTime(r) / Math.max(1, r.buses.length) / 2; }

  // Steps from seq index i to the next visit of stop b, if a bus there would take you
  // to b the direct way (back-and-forth routes visit middle stops in both directions).
  _stepsTo(r, i, b) {
    const n = r.seq.length;
    for (let k = 1; k <= n; k++) {
      if (r.seq[(i + k) % n] === b) return r.loop || k <= r.stops.length - 1 ? k : -1;
    }
    return -1;
  }

  _rideTime(r, a, b) {
    if (r.broken || !r.buses.length || a === b) return Infinity;
    const n = r.seq.length;
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      if (r.seq[i] !== a) continue;
      const k = this._stepsTo(r, i, b);
      if (k < 0) continue;
      let d = 0;
      for (let j = 0; j < k; j++) d += r.legLen[(i + j) % n];
      best = Math.min(best, d / C.BUS_SPEED + k * C.DWELL_EST);
    }
    return best;
  }

  _bestTransit(from, to, bias, walkLimit = C.WALK_RADIUS) {
    const A = this._stopsNear(from, walkLimit);
    if (!A.length) return null;
    const B = this._stopsNear(to, C.WALK_RADIUS);
    if (!B.length) return null;
    let best = null;
    for (const r of this.routes) {
      if (r.broken || !r.buses.length || r.dying) continue;
      const wait = this._waitTime(r);
      for (const [sa, wa] of A) {
        if (!r.stops.includes(sa.id)) continue;
        for (const [sb, wb] of B) {
          if (sb === sa || !r.stops.includes(sb.id)) continue;
          const ride = this._rideTime(r, sa.id, sb.id);
          if (!isFinite(ride)) continue;
          const cost = ((wa + wb) / C.WALK_SPEED * C.WALK_FACTOR + wait * C.WAIT_FACTOR + ride) * bias;
          if (!best || cost < best.cost) best = { cost, route: r, sa, sb };
        }
      }
    }
    return best;
  }

  _planMorning(p) {
    const home = this.buildings.get(p.home), work = this.buildings.get(p.work);
    if (!home || !work || work.dying) return null;
    let best = null;
    const consider = (cost, plan) => { if (!best || cost < best.cost) best = { cost, ...plan }; };
    const net = this.net;

    const wd = net.walkEstimate(home.seg, home.t, work.seg, work.t);
    if (wd < C.WALK_RADIUS * 1.6) {
      consider(wd / C.WALK_SPEED * C.WALK_FACTOR, { mode: 'walk', legs: [this._walkLeg(home, work)] });
    }
    const lots = this._lots();
    if (p.hasCar) {
      for (const lot of lots) {
        if (!this._lotHasRoom(lot)) continue;
        const w = net.walkEstimate(lot.seg, lot.t, work.seg, work.t);
        if (w > C.WALK_RADIUS) continue;
        const d = net.driveEstimate(home.seg, home.t, lot.seg, lot.t, false);
        if (!isFinite(d)) continue;
        consider(d / C.CAR_SPEED * this.carDelay + C.PARK_TIME + w / C.WALK_SPEED * C.WALK_FACTOR, {
          mode: 'car', lot: lot.id,
          legs: [{ type: 'drive', fromB: home.id, toB: lot.id }, this._walkLeg(lot, work)],
        });
      }
    }
    const tr = this._bestTransit(home.place, work.place, p.bias);
    if (tr) {
      consider(tr.cost, {
        mode: 'bus', route: tr.route, sa: tr.sa, sb: tr.sb,
        legs: [this._walkLeg(home, tr.sa),
          { type: 'bus', route: tr.route, fromS: tr.sa.id, toS: tr.sb.id },
          this._walkLeg(tr.sb, work)],
      });
    }
    if (p.hasCar && this.routes.length) {
      for (const lot of lots) {
        if (!this._lotHasRoom(lot)) continue;
        const d = net.driveEstimate(home.seg, home.t, lot.seg, lot.t, false);
        if (!isFinite(d)) continue;
        const t2 = this._bestTransit(lot.place, work.place, p.bias, C.PR_WALK);
        if (!t2) continue;
        consider(d / C.CAR_SPEED * this.carDelay + C.PARK_TIME + t2.cost, {
          mode: 'pr', lot: lot.id, route: t2.route, sa: t2.sa, sb: t2.sb,
          legs: [{ type: 'drive', fromB: home.id, toB: lot.id }, this._walkLeg(lot, t2.sa),
            { type: 'bus', route: t2.route, fromS: t2.sa.id, toS: t2.sb.id },
            this._walkLeg(t2.sb, work)],
        });
      }
    }
    // Nothing sensible: drive to the nearest lot anyway and hope, or walk if it's not crazy.
    if (!best && p.hasCar) {
      let near = null, nd = Infinity;
      for (const lot of lots) {
        const w = net.walkEstimate(lot.seg, lot.t, work.seg, work.t);
        if (w < nd) { nd = w; near = lot; }
      }
      if (near) {
        best = {
          cost: 0, mode: 'car', lot: near.id,
          legs: [{ type: 'drive', fromB: home.id, toB: near.id }, this._walkLeg(near, work)],
        };
      }
    }
    if (!best && wd < C.WALK_RADIUS * 4) best = { cost: 0, mode: 'walk', legs: [this._walkLeg(home, work)] };
    return best;
  }

  _planEvening(p) {
    const work = this.buildings.get(p.work), home = this.buildings.get(p.home);
    if (!home) return [];
    const from = work ? work.place : this.net.nearestPlace(p);
    const plan = p.plan || { mode: 'walk' };
    const routeOk = plan.route && this.routes.includes(plan.route) && plan.route.buses.length &&
      this.stops.has(plan.sa.id) && this.stops.has(plan.sb.id) && !plan.sa.dying && !plan.sb.dying;
    const busLeg = () => ({ type: 'bus', route: plan.route, fromS: plan.sb.id, toS: plan.sa.id });
    if (p.carLot >= 0) {
      const lot = this.buildings.get(p.carLot);
      if (lot) {
        const drive = { type: 'drive', fromB: lot.id, toB: home.id };
        if (plan.mode === 'pr' && routeOk) {
          return [this._walkLeg(from, plan.sb), busLeg(), this._walkLeg(plan.sa, lot), drive];
        }
        return [this._walkLeg(from, lot), drive];
      }
      p.carLot = -1;
    }
    if (plan.mode === 'bus' && routeOk) {
      return [this._walkLeg(from, plan.sb), busLeg(), this._walkLeg(plan.sa, home)];
    }
    const tr = this._bestTransit(from, home.place, p.bias);
    if (tr) {
      return [this._walkLeg(from, tr.sb),
        { type: 'bus', route: tr.route, fromS: tr.sb.id, toS: tr.sa.id },
        this._walkLeg(tr.sa, home)];
    }
    return [this._walkLeg(from, home)];
  }

  _leaveHome(p) {
    if (p.state !== PS_HOME || p.work < 0) return;
    p.missed = false;
    const plan = this._planMorning(p);
    if (!plan) {
      p.missed = true;
      this.stats.missed++;
      return;
    }
    p.toWork = true;
    p.plan = plan;
    p.mode = plan.mode;
    p.legs = plan.legs;
    p.legI = 0;
    this.stats[plan.mode]++;
    const home = this.buildings.get(p.home);
    p.x = home.door.x;
    p.y = home.door.y;
    this._startLeg(p);
  }

  _leaveWork(p) {
    if (p.state === PS_WORK) {
      const work = this.buildings.get(p.work);
      if (work) { p.x = work.door.x; p.y = work.door.y; }
      p.toWork = false;
      p.legs = this._planEvening(p);
      p.legI = 0;
      if (!p.legs.length) { p.state = PS_HOME; return; }
      this._startLeg(p);
    } else if (p.toWork && p.state !== PS_HOME) {
      p.leaveLate = true;
    }
  }

  // --- Trip legs ---------------------------------------------------------------------

  _startLeg(p, at) {
    if (p.legI >= p.legs.length) { this._arrive(p); return; }
    const leg = p.legs[p.legI];
    if (leg.type === 'walk') {
      const path = this.net.walkPath(leg.from, leg.to);
      if (at) path.unshift({ x: at.x, y: at.y });
      this._setPath(p, path);
      p.state = PS_WALK;
      p.pop = 0;
      p.vanish = 0;
    } else if (leg.type === 'drive') {
      if (!this._spawnCar(p, leg.fromB, leg.toB)) this._fallback(p);
    } else if (leg.type === 'bus') {
      const st = this.stops.get(leg.fromS);
      if (!st || st.dying || !this.routes.includes(leg.route)) { this._fallback(p); return; }
      p.state = PS_WAIT;
      p.stop = st.id;
      p.waitSince = this.absMinute();
      p.pop = Math.min(p.pop, 1);
      st.waiting.push(p);
    }
  }

  _setPath(p, path) {
    p.path = path;
    p.pathLen = polyLength(path);
    p.dist = 0;
    p.pathI = 0;
    p.pathD = 0;
    p.x = path[0].x;
    p.y = path[0].y;
  }

  _endWalk(p) {
    const leg = p.legs[p.legI];
    const next = p.legs[p.legI + 1];
    if (!next) {
      this._enter(p, this.buildings.get(leg.toB), 'arrive');
    } else if (next.type === 'drive') {
      this._enter(p, this.buildings.get(next.fromB), 'drive');
    } else {
      p.legI++;
      this._startLeg(p);
    }
  }

  _enter(p, b, after) {
    p.state = PS_ENTER;
    p.anim = 0;
    p.from = { x: p.x, y: p.y };
    p.to = b ? { x: b.rect.x + b.rect.w / 2, y: b.rect.y + b.rect.h / 2 } : { x: p.x, y: p.y };
    p.after = after;
  }

  _arrive(p) {
    p.legs = [];
    p.legI = 0;
    if (p.toWork) {
      const work = this.buildings.get(p.work);
      if (!work || work.dying) {
        // Their office was knocked down while they were on the way: head back home.
        p.state = PS_WORK;
        p.toWork = false;
        p.legs = this._planEvening(p);
        if (p.legs.length) this._startLeg(p);
        else p.state = PS_HOME;
        return;
      }
      p.state = PS_WORK;
      if (p.leaveLate) {
        p.leaveLate = false;
        p.leaveAt = this.absMinute() + 30;
      }
    } else {
      p.state = PS_HOME;
    }
  }

  // Something went wrong mid-trip (a stop or route was removed): walk the rest.
  _fallback(p) {
    const dest = this.buildings.get(p.toWork ? p.work : p.home);
    if (p.carLot >= 0 && !p.toWork) {
      const lot = this.buildings.get(p.carLot);
      if (lot) lot.parked = Math.max(0, lot.parked - 1);
      p.carLot = -1;
    }
    p.vehicle = null;
    if (!dest) { p.state = PS_HOME; return; }
    const from = this.net.nearestPlace(p);
    p.legs = [this._walkLeg(from, dest)];
    p.legI = 0;
    this._startLeg(p);
  }

  _removePerson(p) {
    if (p.state === PS_GONE) return;
    if (p.state === PS_WALK || p.state === PS_WAIT || p.state === PS_ENTER) {
      this.fx.push({ x: p.x, y: p.y, kind: 'ghost', t: 0 });
    }
    if (p.state === PS_WAIT) {
      const st = this.stops.get(p.stop);
      if (st) st.waiting.splice(st.waiting.indexOf(p), 1);
    }
    const v = p.vehicle;
    if (v && v.kind === V_CAR) this._fadeVehicle(v);
    if (v && v.kind === V_BUS) v.passengers.splice(v.passengers.indexOf(p), 1);
    if (p.carLot >= 0) {
      const lot = this.buildings.get(p.carLot);
      if (lot) lot.parked = Math.max(0, lot.parked - 1);
    }
    for (const id of [p.home, p.work]) {
      const b = this.buildings.get(id);
      if (b) {
        const i = b.people.indexOf(p);
        if (i >= 0) b.people.splice(i, 1);
      }
    }
    p.state = PS_GONE;
  }

  // --- People movement ---------------------------------------------------------------

  _updatePeople(dt) {
    const now = this.absMinute();
    for (const p of this.people) {
      const st = p.state;
      if (st === PS_WALK) {
        p.pop = Math.min(1, p.pop + dt * 4);
        p.dist += p.speed * dt;
        if (p.dist >= p.pathLen) {
          const end = p.path[p.path.length - 1];
          p.x = end.x;
          p.y = end.y;
          this._endWalk(p);
        } else {
          this._walkPos(p);
        }
      } else if (st === PS_WAIT) {
        const stop = this.stops.get(p.stop);
        if (!stop) { this._fallback(p); continue; }
        p.pop = Math.min(1, p.pop + dt * 4);
        const i = stop.waiting.indexOf(p);
        const n = stop.waiting.length;
        const R = 2.45;
        const cx = stop.x + stop.ox * (4 + R * Math.sqrt(n)), cy = stop.y + stop.oy * (4 + R * Math.sqrt(n));
        const a = i * 2.39996, rr = R * Math.sqrt(i + 0.5);
        const tx = cx + Math.cos(a) * rr, ty = cy + Math.sin(a) * rr;
        const k = 1 - Math.exp(-dt * 7);
        p.x += (tx - p.x) * k;
        p.y += (ty - p.y) * k;
        if (now - p.waitSince > C.GIVE_UP_MIN) {
          stop.waiting.splice(i, 1);
          this._fallback(p);
        }
      } else if (st === PS_BOARD) {
        p.anim += dt / 0.25;
        const v = p.vehicle;
        const t = Math.min(1, p.anim);
        p.x = p.from.x + (v.x - p.from.x) * t;
        p.y = p.from.y + (v.y - p.from.y) * t;
        p.vanish = t;
        if (p.anim >= 1) p.state = PS_BUS;
      } else if (st === PS_BUS) {
        p.x = p.vehicle.x;
        p.y = p.vehicle.y;
      } else if (st === PS_ENTER) {
        p.anim += dt / 0.3;
        const t = Math.min(1, p.anim);
        p.x = p.from.x + (p.to.x - p.from.x) * t * 0.6;
        p.y = p.from.y + (p.to.y - p.from.y) * t * 0.6;
        p.vanish = t;
        if (p.anim >= 1) {
          p.vanish = 0;
          if (p.after === 'drive') {
            p.legI++;
            this._startLeg(p);
          } else this._arrive(p);
        }
      } else if (st === PS_WORK && p.leaveAt >= 0 && now >= p.leaveAt) {
        p.leaveAt = -1;
        this._leaveWork(p);
      }
    }
  }

  _walkPos(p) {
    const path = p.path;
    while (p.pathI < path.length - 2) {
      const len = dist(path[p.pathI], path[p.pathI + 1]);
      if (p.dist < p.pathD + len) break;
      p.pathD += len;
      p.pathI++;
    }
    const a = path[p.pathI], b = path[p.pathI + 1];
    const len = dist(a, b) || 1;
    const t = clamp((p.dist - p.pathD) / len, 0, 1);
    const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
    p.x = a.x + (b.x - a.x) * t + nx * p.jitter;
    p.y = a.y + (b.y - a.y) * t + ny * p.jitter;
  }

  // --- Vehicles ------------------------------------------------------------------------

  _newVehicle(kind) {
    const bus = kind === V_BUS;
    const v = {
      id: this._id(), kind, state: VS_SPAWN,
      length: bus ? C.BUS_LEN : C.CAR_LEN, width: bus ? C.BUS_W : C.CAR_W,
      vmax: (bus ? C.BUS_SPEED : C.CAR_SPEED) * this.rng.range(0.92, 1.06),
      accel: bus ? C.BUS_ACCEL : C.CAR_ACCEL,
      lane: null, s: 0, v: 0, hops: [], hopI: 0, target: { x: 0, y: 0 }, netVersion: -1,
      waitSince: -1, stuck: 0, node: -1, fromLane: null, outLane: null,
      c0: null, c1: null, c2: null, c3: null, cu: 0, clen: 1, cspeed: 1, samples: null,
      fromB: -1, toB: -1, anchor: null, anim: 0, parkFrom: null, fade: 0,
      x: 0, y: 0, ang: 0, visX: 0, visY: 0, pop: 0, shade: this.rng.int(0, 5),
      person: null, tripStart: 0, tripEst: 0,
      route: null, seqI: 0, passengers: [], dwelling: false, dwell: 0, dwellTick: 0,
      retiring: false, fareAcc: 0,
    };
    this.vehicles.push(v);
    return v;
  }

  _spawnCar(p, fromB, toB) {
    const fb = this.buildings.get(fromB), tb = this.buildings.get(toB);
    if (!fb || !tb) return false;
    const hops = this.net.drivePath(fb.seg, fb.t, tb.seg, tb.t, false);
    if (!hops.length) return false;
    const v = this._newVehicle(V_CAR);
    v.person = p;
    v.fromB = fromB;
    v.toB = toB;
    v.hops = hops;
    v.anchor = fb.place;
    v.target = this.net.segPoint(tb.seg, tb.t);
    v.x = fb.door.x;
    v.y = fb.door.y;
    v.tripStart = this.time;
    v.tripEst = this.net.driveEstimate(fb.seg, fb.t, tb.seg, tb.t, false) / C.CAR_SPEED;
    if (isLot(fb)) fb.parked = Math.max(0, fb.parked - 1);
    if (isLot(tb)) tb.incoming++;
    p.state = PS_CAR;
    p.vehicle = v;
    p.carLot = -1;
    return true;
  }

  _laneS(lane, p) { return (p.x - lane.p0.x) * lane.dx + (p.y - lane.p0.y) * lane.dy; }

  _laneP(lane, s) { return { x: lane.p0.x + lane.dx * s, y: lane.p0.y + lane.dy * s }; }

  _insertSorted(lane, v) {
    const vs = lane.vehicles;
    let i = 0;
    while (i < vs.length && vs[i].s >= v.s) i++;
    vs.splice(i, 0, v);
  }

  _gapAt(lane, s, len) {
    if (s - len - C.GAP < lane.reserved) return false;
    for (const u of lane.vehicles) {
      if (u.s >= s) {
        if (u.s - u.length - C.GAP < s) return false;
      } else if (s - len - C.GAP - 4 - u.v * 0.3 < u.s) return false;
    }
    return true;
  }

  _trySpawn(v) {
    const bus = v.kind === V_BUS;
    const [sid, dir] = v.hops[0];
    const s = this.net.segs[sid];
    const lanes = this.net.usableLanes(s, dir, bus);
    if (!lanes.length) {
      v.stuck += 1;
      if (v.stuck > 120) this._giveUp(v);
      return;
    }
    const a = v.anchor;
    const roadPt = this.net.segPoint(sid, a.t);
    lanes.sort((x, y) => (y.offset - x.offset) * a.side);
    for (const lane of lanes) {
      const s0 = clamp(this._laneS(lane, roadPt) + v.length / 2, v.length, lane.length - 0.5);
      if (!this._gapAt(lane, s0, v.length)) continue;
      v.lane = lane;
      v.s = s0;
      v.v = 0;
      v.state = VS_LANE;
      v.netVersion = this.net.version;
      this._insertSorted(lane, v);
      const lp = this._laneP(lane, s0 - v.length / 2);
      v.visX = a.x - lp.x;
      v.visY = a.y - lp.y;
      v.pop = 0;
      if (bus) {
        v.dwelling = true;
        v.dwell = 0;
        v.dwellTick = 0.3;
      }
      return;
    }
  }

  _updateLanes(dt) {
    for (const seg of this.net.segs) {
      for (const lane of seg.lanes) {
        const vs = lane.vehicles;
        let leader = null;
        let i = 0;
        while (i < vs.length) {
          const v = vs[i];
          this._drive(v, lane, leader, dt);
          if (v.lane === lane) {
            leader = v;
            i++;
          }
        }
      }
    }
  }

  _drive(v, lane, leader, dt) {
    if (v.dwelling) {
      v.v = 0;
      this._dwell(v, dt);
      return;
    }
    const last = v.hopI >= v.hops.length - 1;
    let stopS = lane.length;
    if (last) {
      stopS = clamp(this._laneS(lane, v.target), 0, lane.length);
      if (v.kind === V_BUS) stopS = Math.min(lane.length, stopS + v.length * 0.5);
    }
    let limit = stopS;
    if (leader) limit = Math.min(limit, leader.s - leader.length - C.GAP);
    const target = clamp((limit - v.s) * C.BRAKE_K, 0, v.vmax);
    v.braking = target < v.v - 0.5 || (v.v < 0.5 && target < 0.5);
    v.v = target < v.v ? target : Math.min(target, v.v + v.accel * dt);
    v.s = Math.max(v.s, Math.min(v.s + v.v * dt, limit));
    if (v.v < 2) v.stuck += dt;
    else v.stuck = 0;
    if (last) {
      if (v.s >= stopS - 0.8) {
        if (v.kind === V_CAR) this._carArrive(v, lane);
        else this._busArrive(v);
        return;
      }
    } else if (v.s >= lane.length - 0.8) {
      if (v.waitSince < 0) v.waitSince = this.time;
    }
    if (v.kind === V_CAR && v.stuck > C.GRIDLOCK_S) this._giveUp(v);
  }

  _intersections() {
    const req = new Map();
    for (const s of this.net.segs) {
      for (const lane of s.lanes) {
        const v = lane.vehicles[0];
        if (!v || v.dwelling || v.state !== VS_LANE) continue;
        if (v.hopI >= v.hops.length - 1) continue;
        if (v.s < lane.length - 0.8) continue;
        const node = lane.dir === 1 ? s.b : s.a;
        if (!req.has(node)) req.set(node, []);
        req.get(node).push(v);
      }
    }
    for (const [node, list] of req) {
      list.sort((a, b) => a.waitSince - b.waitSince);
      for (const v of list) this._tryCross(v, node);
    }
  }

  _entrySpace(l) {
    const back = l.vehicles[l.vehicles.length - 1];
    return (back ? back.s - back.length - C.GAP : l.length) - l.reserved;
  }

  _tryCross(v, node) {
    if (v.netVersion !== this.net.version && !this._reroute(v)) return;
    if (v.hopI >= v.hops.length - 1) return;
    const bus = v.kind === V_BUS;
    const [sid2, dir2] = v.hops[v.hopI + 1];
    const outs = this.net.usableLanes(this.net.segs[sid2], dir2, bus);
    if (!outs.length) { v.netVersion = -1; return; }
    const lane = v.lane;
    const need = v.length + C.GAP;
    let best = null, bestScore = -Infinity;
    for (const l of outs) {
      const space = this._entrySpace(l);
      if (space < need) continue;
      // Prefer roomy lanes, buses prefer bus lanes, and the last hop prefers the kerb.
      let score = Math.min(space, 60);
      if (bus && l.type === LANE_BUS) score += 1000;
      if (v.hopI + 1 === v.hops.length - 1) score += l.offset * dir2 * 2;
      if (score > bestScore) { bestScore = score; best = l; }
    }
    if (!best) return;
    const p0 = { x: lane.p1.x, y: lane.p1.y }, p3 = { x: best.p0.x, y: best.p0.y };
    const k = Math.max(6, dist(p0, p3) * 0.45);
    const p1 = { x: p0.x + lane.dx * k, y: p0.y + lane.dy * k };
    const p2 = { x: p3.x - best.dx * k, y: p3.y - best.dy * k };
    const samples = [];
    for (let i = 0; i <= 8; i++) samples.push(bezier(p0, p1, p2, p3, i / 8));
    const list = this.crossing.get(node) || [];
    for (const c of list) if (this._conflict(c, lane, best, samples)) return;

    lane.vehicles.shift();
    v.lane = null;
    v.fromLane = lane;
    v.outLane = best;
    v.node = node;
    v.state = VS_CROSS;
    v.c0 = p0; v.c1 = p1; v.c2 = p2; v.c3 = p3;
    v.cu = 0;
    v.clen = Math.max(1, polyLength(samples));
    v.samples = samples;
    const straight = lane.dx * best.dx + lane.dy * best.dy;
    v.cspeed = v.vmax * (0.5 + 0.5 * Math.max(0, straight));
    v.waitSince = -1;
    best.reserved += need;
    list.push(v);
    this.crossing.set(node, list);
  }

  _conflict(c, inLane, outLane, samples) {
    if (c.fromLane === inLane && c.outLane === outLane) return c.cu * c.clen < c.length + C.GAP + 1;
    const start = Math.floor(c.cu * (c.samples.length - 1));
    for (let i = start; i < c.samples.length; i++) {
      for (const q of samples) if (dist2(c.samples[i], q) < C.CONFLICT_D2) return true;
    }
    return false;
  }

  _updateCrossing(dt) {
    for (const list of this.crossing.values()) {
      for (let i = list.length - 1; i >= 0; i--) {
        const v = list[i];
        if (v.v > v.cspeed) v.v = Math.max(v.cspeed, v.v - v.accel * 3 * dt);
        else v.v = Math.min(v.cspeed, v.v + v.accel * dt);
        v.cu += Math.max(v.v, 6) * dt / v.clen;
        if (v.cu < 1) continue;
        list.splice(i, 1);
        const out = v.outLane;
        out.reserved = Math.max(0, out.reserved - (v.length + C.GAP));
        let s = (v.cu - 1) * v.clen;
        const back = out.vehicles[out.vehicles.length - 1];
        if (back && s > back.s - back.length - C.GAP) s = back.s - back.length - C.GAP;
        v.s = s;
        v.lane = out;
        v.state = VS_LANE;
        v.hopI++;
        v.outLane = null;
        v.fromLane = null;
        this._insertSorted(out, v);
      }
    }
  }

  // A vehicle at the end of its lane after the roads changed: plan again from here.
  _reroute(v) {
    const lane = v.lane;
    v.netVersion = this.net.version;
    let tseg, tt;
    const bus = v.kind === V_BUS;
    if (bus) {
      const st = this.stops.get(v.route.seq[v.seqI]);
      if (!st) return false;
      tseg = st.seg; tt = st.t;
    } else {
      const tb = this.buildings.get(v.toB);
      if (!tb) return false;
      tseg = tb.seg; tt = tb.t;
    }
    const hops = this.net.drivePath(lane.seg, lane.dir === 1 ? 1 : 0, tseg, tt, bus, lane.dir);
    if (!hops.length) return false;
    v.hops = hops;
    v.hopI = 0;
    return true;
  }

  _carArrive(v, lane) {
    const tb = this.buildings.get(v.toB);
    if (!tb || tb.dying) { this._retargetCar(v, -1); return; }
    if (isLot(tb)) {
      tb.incoming = Math.max(0, tb.incoming - 1);
      if (tb.parked >= tb.capacity) {
        tb.flash = 1;
        this._retargetCar(v, tb.id);
        return;
      }
      tb.parked++;
      tb.pulse = 1;
      const ratio = (this.time - v.tripStart) / Math.max(1, v.tripEst);
      this.carDelay = clamp(this.carDelay * 0.95 + ratio * 0.05, 1, 4);
    }
    lane.vehicles.splice(lane.vehicles.indexOf(v), 1);
    v.lane = null;
    v.state = VS_PARK;
    v.anim = 0;
    v.parkFrom = { x: v.x, y: v.y };
  }

  // The car's lot is full (or gone): find another one near work, or give up and go home.
  _retargetCar(v, excludeId) {
    const p = v.person;
    const work = this.buildings.get(p.work);
    let best = null, bd = Infinity;
    if (p.toWork && work && !work.dying) {
      for (const b of this._lots()) {
        if (b.id === excludeId || !this._lotHasRoom(b)) continue;
        const w = this.net.walkEstimate(b.seg, b.t, work.seg, work.t);
        if (w < C.WALK_RADIUS * 2.5 && w < bd) { bd = w; best = b; }
      }
    }
    if (best) {
      best.incoming++;
      v.toB = best.id;
      p.mode = 'car';
      p.plan = { mode: 'car', lot: best.id };
      p.legs = [{ type: 'drive', fromB: v.fromB, toB: best.id }, this._walkLeg(best, work)];
      p.legI = 0;
    } else {
      const home = this.buildings.get(p.home);
      if (!home) { this._fadeVehicle(v); p.state = PS_GONE; return; }
      v.toB = home.id;
      if (p.toWork && !p.missed) {
        p.missed = true;
        this.stats.missed++;
        if (this.stats[p.mode] > 0) this.stats[p.mode]--;
      }
      p.toWork = false;
      p.plan = { mode: 'car' };
      p.legs = [{ type: 'drive', fromB: v.fromB, toB: home.id }];
      p.legI = 0;
    }
    const tgt = this.buildings.get(v.toB);
    v.target = this.net.segPoint(tgt.seg, tgt.t);
    const lane = v.lane;
    const t = this.net.tOf(lane.seg, this._laneP(lane, v.s));
    const hops = this.net.drivePath(lane.seg, t, tgt.seg, tgt.t, false, lane.dir);
    if (!hops.length) { this._giveUp(v); return; }
    v.hops = hops;
    v.hopI = 0;
    v.netVersion = this.net.version;
  }

  // Hopelessly stuck: the car fades out and its driver is quietly put back home.
  _giveUp(v) {
    const p = v.person;
    if (p) {
      const tb = this.buildings.get(v.toB);
      if (tb && isLot(tb)) tb.incoming = Math.max(0, tb.incoming - 1);
      if (p.toWork && !p.missed) { p.missed = true; this.stats.missed++; }
      p.vehicle = null;
      p.carLot = -1;
      p.legs = [];
      p.toWork = false;
      if (p.state !== PS_GONE) p.state = PS_HOME;
    }
    this._fadeVehicle(v);
  }

  _fadeVehicle(v) {
    if (v.lane) {
      const i = v.lane.vehicles.indexOf(v);
      if (i >= 0) v.lane.vehicles.splice(i, 1);
      v.lane = null;
    }
    if (v.state === VS_CROSS) {
      const list = this.crossing.get(v.node);
      if (list) list.splice(list.indexOf(v), 1);
      v.outLane.reserved = Math.max(0, v.outLane.reserved - (v.length + C.GAP));
    }
    if (v.route) {
      const i = v.route.buses.indexOf(v);
      if (i >= 0) v.route.buses.splice(i, 1);
    }
    v.state = v.state === VS_SPAWN ? VS_GONE : VS_FADE;
    v.fade = 1;
  }

  _updateOtherVehicles(dt) {
    for (const v of this.vehicles) {
      if (v.state === VS_SPAWN) this._trySpawn(v);
      else if (v.state === VS_PARK) {
        v.anim += dt / C.PARK_ANIM;
        const tb = this.buildings.get(v.toB);
        if (!tb) { v.state = VS_GONE; continue; }
        const center = { x: tb.rect.x + tb.rect.w / 2, y: tb.rect.y + tb.rect.h / 2 };
        const t = Math.min(1, v.anim);
        const px = v.x, py = v.y;
        const pt = t < 0.55 ? vlerp(v.parkFrom, tb.door, t / 0.55) : vlerp(tb.door, center, (t - 0.55) / 0.45);
        v.x = pt.x;
        v.y = pt.y;
        if (Math.hypot(v.x - px, v.y - py) > 0.01) v.ang = Math.atan2(v.y - py, v.x - px);
        v.pop = 1 - clamp((t - 0.45) / 0.55, 0, 1);
        if (v.anim >= 1) {
          v.state = VS_GONE;
          this._carParked(v, tb);
        }
      } else if (v.state === VS_FADE) {
        v.fade -= dt * 2.5;
        if (v.fade <= 0) v.state = VS_GONE;
      }
    }
  }

  _carParked(v, tb) {
    const p = v.person;
    p.vehicle = null;
    if (isLot(tb)) {
      p.carLot = tb.id;
      p.x = tb.door.x;
      p.y = tb.door.y;
      p.legI++;
      this._startLeg(p);
    } else {
      p.carLot = -1;
      this._arrive(p);
    }
  }

  _vehiclePositions(dt) {
    const k = Math.exp(-dt * 6);
    for (const v of this.vehicles) {
      if (v.state === VS_LANE) {
        const lane = v.lane;
        const c = v.s - v.length / 2;
        v.x = lane.p0.x + lane.dx * c + v.visX;
        v.y = lane.p0.y + lane.dy * c + v.visY;
        v.ang = Math.atan2(lane.dy, lane.dx);
      } else if (v.state === VS_CROSS) {
        const t = clamp(v.cu, 0, 1);
        const p = bezier(v.c0, v.c1, v.c2, v.c3, t);
        const tg = bezierTangent(v.c0, v.c1, v.c2, v.c3, t);
        const tl = Math.hypot(tg.x, tg.y) || 1;
        v.x = p.x - (tg.x / tl) * v.length / 2;
        v.y = p.y - (tg.y / tl) * v.length / 2;
        v.ang = Math.atan2(tg.y, tg.x);
      }
      v.visX *= k;
      v.visY *= k;
      if (v.state === VS_LANE || v.state === VS_CROSS) v.pop = Math.min(1, v.pop + dt * 4);
    }
  }

  // --- Buses ---------------------------------------------------------------------------

  _rebuildRoutes() {
    this._routeVersion = this.net.version;
    for (const r of this.routes) this._buildRoute(r);
  }

  _buildRoute(r) {
    const s = r.stops;
    r.seq = r.loop || s.length <= 2 ? [...s] : [...s, ...s.slice(1, -1).reverse()];
    r.legLen = [];
    r.legPts = [];
    r.broken = false;
    r.cycleLen = 0;
    const n = r.seq.length;
    for (let i = 0; i < n; i++) {
      const a = this.stops.get(r.seq[i]), b = this.stops.get(r.seq[(i + 1) % n]);
      const hops = this.net.drivePath(a.seg, a.t, b.seg, b.t, true);
      if (!hops.length) {
        r.broken = true;
        r.legLen.push(Infinity);
        r.legPts.push(null);
        continue;
      }
      const pts = this.net.hopsPoints(hops, a.t, b.t);
      const len = polyLength(pts);
      r.legLen.push(len);
      r.legPts.push(pts);
      r.cycleLen += len;
    }
  }

  // New buses start at the stop furthest along the route from the existing ones, so they
  // spread out instead of travelling in a bunch.
  _spawnIndex(r) {
    const n = r.seq.length;
    if (!r.buses.length || !isFinite(r.cycleLen) || r.cycleLen <= 0) return 0;
    const at = [0];
    for (let i = 0; i < n - 1; i++) at.push(at[i] + r.legLen[i]);
    const taken = r.buses.map((b) => at[b.seqI]);
    let best = 0, bestGap = -1;
    for (let i = 0; i < n; i++) {
      let gap = Infinity;
      for (const t of taken) {
        const d = Math.abs(at[i] - t);
        gap = Math.min(gap, d, r.cycleLen - d);
      }
      if (gap > bestGap) { bestGap = gap; best = i; }
    }
    return best;
  }

  _spawnBus(r) {
    const i = this._spawnIndex(r);
    const st = this.stops.get(r.seq[i]), nx = this.stops.get(r.seq[(i + 1) % r.seq.length]);
    const hops = this.net.drivePath(st.seg, st.t, nx.seg, nx.t, true);
    if (!hops.length) return null;
    const v = this._newVehicle(V_BUS);
    v.route = r;
    v.seqI = i;
    v.hops = [hops[0]];
    v.hopI = 0;
    v.anchor = st.place;
    v.target = this.net.segPoint(st.seg, st.t);
    v.x = st.x;
    v.y = st.y;
    r.buses.push(v);
    return v;
  }

  _busArrive(v) {
    v.dwelling = true;
    v.dwell = 0;
    v.dwellTick = 0.25;
  }

  // Would a bus at seq index i take someone to stop `to` the direct way?
  _goesTo(v, to) { return this._stepsTo(v.route, v.seqI, to) > 0; }

  _dwell(v, dt) {
    v.dwell += dt;
    v.dwellTick -= dt;
    if (v.dwellTick > 0) return;
    const r = v.route;
    const stopId = r.seq[v.seqI];
    const st = this.stops.get(stopId);
    for (const p of v.passengers) {
      const leg = p.legs[p.legI];
      if (v.retiring || !st || st.dying || leg.toS === stopId) {
        this._alight(v, p, st);
        v.dwellTick = C.BOARD_T;
        return;
      }
    }
    if (st && !st.dying && !v.retiring && v.passengers.length < C.BUS_CAP) {
      for (const p of st.waiting) {
        if (p.state !== PS_WAIT) continue;
        const leg = p.legs[p.legI];
        if (leg.route === r && this._goesTo(v, leg.toS)) {
          this._board(v, p, st);
          v.dwellTick = C.BOARD_T;
          return;
        }
      }
    }
    if (v.dwell < C.DWELL_MIN) return;
    if (v.retiring) {
      if (v.fareAcc) this._fx(v.x, v.y - 10, `+$${v.fareAcc}`, 'money');
      this._fadeVehicle(v);
      return;
    }
    this._busDepart(v);
  }

  _alight(v, p, st) {
    v.passengers.splice(v.passengers.indexOf(p), 1);
    const leg = p.legs[p.legI];
    p.x = v.x;
    p.y = v.y;
    p.vehicle = null;
    p.vanish = 0;
    p.pop = 0;
    if (st && !st.dying && leg.toS === st.id) {
      p.legI++;
      this._startLeg(p, { x: v.x, y: v.y });
    } else if (st && !st.dying && this.routes.includes(leg.route)) {
      // Bus is going out of service: wait here for the next one.
      leg.fromS = st.id;
      p.state = PS_WAIT;
      p.stop = st.id;
      p.waitSince = this.absMinute();
      st.waiting.push(p);
    } else {
      this._fallback(p);
    }
  }

  _board(v, p, st) {
    st.waiting.splice(st.waiting.indexOf(p), 1);
    p.state = PS_BOARD;
    p.anim = 0;
    p.from = { x: p.x, y: p.y };
    p.vehicle = v;
    v.passengers.push(p);
    this.money += C.FARE;
    v.fareAcc += C.FARE;
    v.route.ridersToday++;
    this.stats.riders++;
    this.stats.fares += C.FARE;
  }

  _busDepart(v) {
    if (v.fareAcc) {
      this._fx(v.x, v.y - 10, `+$${v.fareAcc}`, 'money');
      v.fareAcc = 0;
    }
    const r = v.route;
    const nextI = (v.seqI + 1) % r.seq.length;
    const st = this.stops.get(r.seq[nextI]);
    const lane = v.lane;
    if (!st) { v.dwellTick = 1; return; }
    const t = this.net.tOf(lane.seg, this._laneP(lane, v.s));
    const hops = this.net.drivePath(lane.seg, t, st.seg, st.t, true, lane.dir);
    if (!hops.length) { v.dwellTick = 1; return; }
    v.seqI = nextI;
    v.hops = hops;
    v.hopI = 0;
    v.target = this.net.segPoint(st.seg, st.t);
    v.dwelling = false;
    v.netVersion = this.net.version;
  }

  _positionStop(st) {
    const s = this.net.segs[st.seg];
    const p = this.net.sidewalk(st.seg, st.t, st.side);
    st.ox = s.rx * st.side;
    st.oy = s.ry * st.side;
    st.x = p.x + st.ox * 1.5;
    st.y = p.y + st.oy * 1.5;
    st.place.x = st.x;
    st.place.y = st.y;
  }

  // --- Player actions --------------------------------------------------------------------

  spend(amount, at) {
    if (this.money < amount) {
      this._fx(at.x, at.y, 'Not enough money', 'warn');
      return false;
    }
    this.money -= amount;
    if (amount > 0) this._fx(at.x, at.y, `-$${amount}`, 'cost');
    return true;
  }

  // Lane edits apply to every selected segment, by on-screen lane position.
  editLanes(segIds, action, index, at) {
    const net = this.net;
    const costs = { addStart: C.COST_LANE_ADD, addEnd: C.COST_LANE_ADD, type: C.COST_LANE_TYPE,
      flip: C.COST_LANE_FLIP, remove: C.COST_LANE_REMOVE };
    const jobs = [];
    for (const sid of segIds) {
      const s = net.segs[sid];
      const { lanes, reversed } = net.displayLanes(sid);
      if (action === 'addStart' || action === 'addEnd') {
        if (lanes.length >= C.MAX_LANES) continue;
        jobs.push(() => {
          const atStart = (action === 'addStart') !== reversed;
          const edge = lanes.length ? (action === 'addStart' ? lanes[0] : lanes[lanes.length - 1]) : null;
          const lane = net.makeLane(s, edge ? edge.dir * (edge.flip ? -1 : 1) : 1, LANE_CAR);
          if (atStart) s.lanes.unshift(lane);
          else s.lanes.push(lane);
        });
      } else {
        const lane = lanes[index];
        if (!lane) continue;
        jobs.push(() => {
          if (action === 'type') lane.type = lane.type === LANE_CAR ? LANE_BUS : LANE_CAR;
          else if (action === 'flip') {
            if (lane.flip) lane.flip = false;
            else if (!lane.vehicles.length && lane.reserved <= 0.01) lane.dir = -lane.dir;
            else lane.flip = true;
          } else if (action === 'remove') lane.closing = true;
        });
      }
    }
    if (!jobs.length) return false;
    if (!this.spend(costs[action] * jobs.length, at)) return false;
    for (const job of jobs) job();
    net.version++;
    this._changed();
    return true;
  }

  placeStop(sid, p) {
    const s = this.net.segs[sid];
    if (!s.lanes.length) return null;
    const lo = (this.net.inset(s.a, sid) + 12) / s.length;
    const hi = 1 - (this.net.inset(s.b, sid) + 12) / s.length;
    const t = clamp(this.net.tOf(sid, p), lo, hi);
    for (const st of this.stops.values()) {
      if (st.seg === sid && Math.abs(st.t - t) * s.length < 26 && !st.dying) return null;
    }
    const at = this.net.segPoint(sid, t);
    if (!this.spend(C.COST_STOP, at)) return null;
    const side = this.net.sideOf(sid, p);
    const st = {
      id: this._id(), seg: sid, t, side, x: 0, y: 0, ox: 0, oy: 0,
      place: { x: 0, y: 0, seg: sid, t, side }, waiting: [], ring: 0, appear: 0, dying: false,
    };
    this._positionStop(st);
    this.stops.set(st.id, st);
    this.fx.push({ x: st.x, y: st.y, kind: 'ripple', t: 0 });
    this._changed();
    return st;
  }

  removeStop(id) {
    const st = this.stops.get(id);
    if (!st || st.dying) return;
    st.dying = true;
    for (const r of [...this.routes]) {
      if (!r.stops.includes(id)) continue;
      r.stops = r.stops.filter((x) => x !== id);
      if (r.stops.length < 2) this.deleteRoute(r);
      else {
        this._buildRoute(r);
        for (const v of r.buses) {
          v.seqI = Math.min(v.seqI, r.seq.length - 1);
          v.netVersion = -1;
        }
      }
    }
    for (const p of [...st.waiting]) this._fallback(p);
    st.waiting = [];
    this._changed();
  }

  nextRouteColor() {
    const used = new Set(this.routes.map((r) => r.color));
    return ROUTE_COLORS.find((c) => !used.has(c)) || ROUTE_COLORS[this.routes.length % ROUTE_COLORS.length];
  }

  createRoute(stopIds, loop) {
    if (stopIds.length < 2) return null;
    const first = this.stops.get(stopIds[0]);
    const r = {
      id: this._id(), name: `Route ${++this._routeCount}`, color: this.nextRouteColor(),
      stops: [...stopIds], loop, buses: [], seq: [], legLen: [], legPts: [], cycleLen: 0,
      broken: false, ridersToday: 0, appear: 0, dying: false,
    };
    this._buildRoute(r);
    if (r.broken) {
      this._fx(first.x, first.y, 'Buses can’t drive that way', 'warn');
      return null;
    }
    if (!this.spend(C.COST_ROUTE, first)) return null;
    this.routes.push(r);
    this._spawnBus(r);
    this._changed();
    return r;
  }

  addBus(r) {
    const st = this.stops.get(r.seq[this._spawnIndex(r)]);
    if (!this.spend(C.COST_BUS, st)) return;
    this._spawnBus(r);
    this._changed();
  }

  removeBus(r) {
    const v = [...r.buses].reverse().find((b) => !b.retiring);
    if (!v) return;
    v.retiring = true;
    if (v.state === VS_SPAWN) this._fadeVehicle(v);
    // Retiring buses still count until they leave, but people stop planning around them.
    r.buses.splice(r.buses.indexOf(v), 1);
    this._changed();
  }

  deleteRoute(r) {
    r.dying = true;
    this.routes = this.routes.filter((x) => x !== r);
    for (const v of [...r.buses]) {
      for (const p of [...v.passengers]) {
        v.passengers.splice(v.passengers.indexOf(p), 1);
        p.x = v.x;
        p.y = v.y;
        this._fallback(p);
      }
      this._fadeVehicle(v);
    }
    for (const st of this.stops.values()) {
      for (const p of [...st.waiting]) {
        const leg = p.legs[p.legI];
        if (leg && leg.route === r) {
          st.waiting.splice(st.waiting.indexOf(p), 1);
          this._fallback(p);
        }
      }
    }
    this._changed();
  }

  demolishCost(b) { return C.COST_DEMOLISH[b.type]; }

  demolish(id) {
    const b = this.buildings.get(id);
    if (!b || b.dying) return false;
    const center = { x: b.rect.x + b.rect.w / 2, y: b.rect.y + b.rect.h / 2 };
    if (!this.spend(this.demolishCost(b), center)) return false;
    b.dying = true;
    this.fx.push({ x: center.x, y: center.y, kind: 'dust', t: 0, w: b.rect.w, h: b.rect.h });
    if (isHome(b)) {
      for (const p of [...b.people]) this._removePerson(p);
    } else if (b.type === B_OFFICE) {
      for (const p of [...b.people]) {
        if (p.state === PS_WORK) this._leaveWork(p);
        p.work = -1;
      }
      b.people = [];
    } else if (isLot(b)) {
      // Tow any parked cars to the nearest other lot.
      for (const p of this.people) {
        if (p.carLot !== b.id) continue;
        let near = null, nd = Infinity;
        for (const o of this._lots()) {
          if (o === b) continue;
          const d = dist(o.door, b.door);
          if (d < nd) { nd = d; near = o; }
        }
        p.carLot = near ? near.id : -1;
        if (near) near.parked++;
      }
      b.parked = 0;
    }
    this._changed();
    return true;
  }

  buildParkRide(lotId) {
    const lot = this.lots[lotId];
    if (!lot || lot.building >= 0 || !lot.access.length) return null;
    if (!this.spend(C.COST_PARK_RIDE, lot.center)) return null;
    const b = this.addBuilding(lot, B_PARK_RIDE, 0);
    this._changed();
    return b;
  }

  // --- Hit testing ----------------------------------------------------------------------

  buildingAt(p) {
    // Roofs are drawn raised by half the building's height, so include that in the hit area.
    // Check front buildings first, since they're drawn over the ones behind.
    let best = null;
    for (const b of this.buildings.values()) {
      const r = b.rect;
      const top = r.y - b.height / 2 - 2;
      if (!b.dying && p.x >= r.x - 2 && p.x <= r.x + r.w + 2 && p.y >= top && p.y <= r.y + r.h + 2) {
        if (!best || r.y > best.rect.y) best = b;
      }
    }
    return best;
  }

  lotAt(p) {
    for (const l of this.lots) {
      const r = l.rect;
      if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return l;
    }
    return null;
  }

  stopAt(p, radius = 9) {
    let best = null, bd = radius;
    for (const st of this.stops.values()) {
      if (st.dying) continue;
      const d = dist(st, p);
      if (d < bd) { bd = d; best = st; }
    }
    return best;
  }

  stopRoutes(st) { return this.routes.filter((r) => r.stops.includes(st.id)); }

  // Counts for the HUD.
  census() {
    let residents = 0, jobs = 0, parked = 0, spaces = 0;
    for (const b of this.buildings.values()) {
      if (isHome(b)) residents += b.people.length;
      else if (b.type === B_OFFICE) jobs += b.capacity;
      else if (isLot(b)) { parked += b.parked; spaces += b.capacity; }
    }
    return { residents, jobs, parked, spaces };
  }
}
