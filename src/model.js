// Constants and small helpers shared by the simulation, the view and the UI.

export const LANE_CAR = 0;
export const LANE_BUS = 1;

export const B_HOUSE = 0;
export const B_APARTMENT = 1;
export const B_OFFICE = 2;
export const B_PARKING = 3;      // city-owned parking downtown
export const B_PARK_RIDE = 4;    // player-built park & ride

export const ZONE_RES = 0;
export const ZONE_MID = 1;
export const ZONE_CORE = 2;
export const ZONE_PARK = 3;
export const ZONE_WATER = 4;

export const V_CAR = 0;
export const V_BUS = 1;

// Vehicle states
export const VS_SPAWN = 0;       // inside a building, waiting for a gap in traffic
export const VS_LANE = 1;
export const VS_CROSS = 2;       // moving through an intersection
export const VS_PARK = 3;        // driving into a building
export const VS_GONE = 4;

// Person states
export const PS_HOME = 0;
export const PS_WORK = 1;
export const PS_WALK = 2;
export const PS_WAIT = 3;        // at a bus stop
export const PS_BOARD = 4;       // stepping onto a bus
export const PS_BUS = 5;
export const PS_CAR = 6;
export const PS_ENTER = 7;       // stepping into a building
export const PS_GONE = 8;

export const BUILDING_NAMES = ['House', 'Apartments', 'Offices', 'City parking', 'Park & ride'];

export function isLot(b) {
  return b && (b.type === B_PARKING || b.type === B_PARK_RIDE);
}

export function isHome(b) {
  return b && (b.type === B_HOUSE || b.type === B_APARTMENT);
}

// --- tiny vector helpers -----------------------------------------------------

export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
export const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
export const dist2 = (a, b) => (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
export const vlerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

export function bezier(p0, p1, p2, p3, t) {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

export function bezierTangent(p0, p1, p2, p3, t) {
  const u = 1 - t;
  const a = 3 * u * u, b = 6 * u * t, c = 3 * t * t;
  return {
    x: a * (p1.x - p0.x) + b * (p2.x - p1.x) + c * (p3.x - p2.x),
    y: a * (p1.y - p0.y) + b * (p2.y - p1.y) + c * (p3.y - p2.y),
  };
}

export function polyLength(pts) {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += dist(pts[i - 1], pts[i]);
  return d;
}

// Seeded random numbers so the starting city is the same every time.
export class Rng {
  constructor(seed) { this.s = seed >>> 0; }
  next() {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) { return a + (b - a) * this.next(); }
  int(a, b) { return a + Math.floor(this.next() * (b - a + 1)); }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  normal(mean, sd) {
    const u = 1 - this.next(), v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}
