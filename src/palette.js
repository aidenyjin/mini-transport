// Colours for day and night, blended by how dark it is, plus easing curves.

const DAY = {
  bg: '#eee9df',
  block: '#e5dfd2',
  park: '#d3e2c0',
  tree: '#bcd3a3',
  water: '#bfd8e4',
  waterEdge: '#aecbd9',
  road: '#fbf9f5',
  roadEdge: '#d6cfc1',
  bridgeShadow: 'rgba(40, 60, 80, 0.16)',
  laneMark: '#e2dbcd',
  centerLine: '#ecc77e',
  busLane: '#f3c6b6',
  ped: '#e9e1d2',
  pedEdge: '#d8cfbe',
  house: '#e9a77d',
  house2: '#e3966c',
  apartment: '#d68a74',
  office: '#7f9dc0',
  office2: '#93acc9',
  window: 'rgba(255, 255, 255, 0.28)',
  parking: '#b7bfca',
  parkRide: '#9fb2cc',
  glyph: '#ffffff',
  shadow: 'rgba(60, 45, 20, 0.12)',
  person: '#33333b',
  stop: '#ffffff',
  stopEdge: '#33333b',
  ringTrack: 'rgba(255, 255, 255, 0.55)',
  ringFill: '#3e4350',
  stopRingTrack: 'rgba(51, 51, 59, 0.12)',
  warn: '#e8a33b',
  full: '#e0533d',
  select: '#2e86de',
  hover: 'rgba(46, 134, 222, 0.22)',
  text: '#33333b',
  glow: 0,
};

const NIGHT = {
  bg: '#1c2130',
  block: '#212838',
  park: '#1f2e2b',
  tree: '#253830',
  water: '#162a3b',
  waterEdge: '#1b3245',
  road: '#363d50',
  roadEdge: '#151923',
  bridgeShadow: 'rgba(0, 0, 0, 0.35)',
  laneMark: '#454d62',
  centerLine: '#7d6a43',
  busLane: '#5d4040',
  ped: '#2b3242',
  pedEdge: '#191d29',
  house: '#8f6650',
  house2: '#865e49',
  apartment: '#7e5a52',
  office: '#46607f',
  office2: '#4f6987',
  window: 'rgba(255, 214, 140, 0.75)',
  parking: '#4a5263',
  parkRide: '#4d5d78',
  glyph: '#dfe4ee',
  shadow: 'rgba(0, 0, 0, 0.25)',
  person: '#efe9de',
  stop: '#efe9de',
  stopEdge: '#11141c',
  ringTrack: 'rgba(255, 255, 255, 0.18)',
  ringFill: '#e8ecf3',
  stopRingTrack: 'rgba(239, 233, 222, 0.16)',
  warn: '#f0b24e',
  full: '#f0614a',
  select: '#5aa6f0',
  hover: 'rgba(90, 166, 240, 0.25)',
  text: '#efe9de',
  glow: 1,
};

export const CAR_COLORS = {
  day: ['#9aa3ae', '#b3aca2', '#8d97a3', '#a6ae9f', '#c0b6ab', '#7f8894'],
  night: ['#5f6878', '#6c675f', '#596372', '#646b5e', '#726a61', '#545c69'],
};

function parse(c) {
  if (c.startsWith('#')) {
    const n = parseInt(c.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const m = c.match(/rgba?\(([^)]+)\)/)[1].split(',').map((x) => parseFloat(x));
  return [m[0], m[1], m[2], m.length > 3 ? m[3] : 1];
}

export function mix(a, b, t) {
  const x = parse(a), y = parse(b);
  const r = Math.round(x[0] + (y[0] - x[0]) * t);
  const g = Math.round(x[1] + (y[1] - x[1]) * t);
  const bl = Math.round(x[2] + (y[2] - x[2]) * t);
  const al = x[3] + (y[3] - x[3]) * t;
  return `rgba(${r}, ${g}, ${bl}, ${al.toFixed(3)})`;
}

export function withAlpha(c, a) {
  const x = parse(c);
  return `rgba(${x[0]}, ${x[1]}, ${x[2]}, ${(x[3] * a).toFixed(3)})`;
}

let cacheKey = -1;
let cache = null;

// Palette for a given darkness (0 day .. 1 night), cached while it doesn't change.
export function palette(night) {
  const key = Math.round(night * 200);
  if (key === cacheKey) return cache;
  const t = key / 200;
  const out = {};
  for (const k of Object.keys(DAY)) {
    out[k] = k === 'glow' ? t : mix(DAY[k], NIGHT[k], t);
  }
  out.cars = CAR_COLORS.day.map((c, i) => mix(c, CAR_COLORS.night[i], t));
  cacheKey = key;
  cache = out;
  return out;
}

export const ease = {
  outBack(t) {
    t = Math.min(1, Math.max(0, t));
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
  },
  outCubic(t) { return 1 - (1 - Math.min(1, Math.max(0, t))) ** 3; },
  smooth(t) { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); },
};
