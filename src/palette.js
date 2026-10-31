// Colours for day and night, blended by how dark it is, plus easing curves.
// One warm light source from the top left: every raised thing casts its shadow down-right.

const DAY = {
  ground: '#ebe4d6',
  outskirts: '#e3dbca',
  grass: '#cfdcb4',
  tree: '#a3bd84',
  treeLight: '#b9cf98',
  treeDark: '#8aa66d',
  water: '#a3c8d6',
  waterDeep: '#93bccd',
  shore: '#c4dbe2',
  wave: 'rgba(255, 255, 255, 0.45)',
  road: '#aaa49a',
  roadDeck: '#958f85',
  paint: 'rgba(255, 255, 255, 0.7)',
  busLane: '#c97f6b',
  ped: '#d9cfbc',
  pedDot: 'rgba(120, 104, 80, 0.25)',
  driveway: '#c2bbaf',
  shadow: 'rgba(96, 76, 44, 0.17)',
  house: '#e8916b',
  house2: '#eba273',
  house3: '#dd8366',
  apartment: '#d7816f',
  office: '#7397bd',
  office2: '#82a5c8',
  office3: '#678cb3',
  parking: '#cdc7bd',
  parkRide: '#b9c8d8',
  glass: 'rgba(235, 244, 252, 0.55)',
  window: 'rgba(255, 255, 255, 0.0)',
  person: '#3b3734',
  car: '#fbf8f1',
  carRoof: '#e4ded3',
  stop: '#ffffff',
  ink: '#3b3734',
  ringTrack: 'rgba(59, 55, 52, 0.14)',
  warn: '#e9a23b',
  full: '#e0533d',
  accent: '#2f7fe0',
  glow: 0,
};

const NIGHT = {
  ground: '#1c2131',
  outskirts: '#181c2a',
  grass: '#1f2c2b',
  tree: '#2b3d35',
  treeLight: '#35493f',
  treeDark: '#22322b',
  water: '#15283a',
  waterDeep: '#122334',
  shore: '#1b3144',
  wave: 'rgba(255, 255, 255, 0.08)',
  road: '#3b4255',
  roadDeck: '#2c3243',
  paint: 'rgba(255, 255, 255, 0.22)',
  busLane: '#6a4542',
  ped: '#2b3142',
  pedDot: 'rgba(255, 255, 255, 0.08)',
  driveway: '#353c4e',
  shadow: 'rgba(0, 0, 0, 0.3)',
  house: '#8f6450',
  house2: '#94694f',
  house3: '#875c4c',
  apartment: '#835a52',
  office: '#3e597a',
  office2: '#46617f',
  office3: '#38526f',
  parking: '#4a4f5e',
  parkRide: '#45556c',
  glass: 'rgba(110, 140, 180, 0.35)',
  window: 'rgba(255, 210, 140, 0.9)',
  person: '#f1ebe0',
  car: '#d9d4cb',
  carRoof: '#bfb9af',
  stop: '#f1ebe0',
  ink: '#f1ebe0',
  ringTrack: 'rgba(255, 255, 255, 0.16)',
  warn: '#f0b24e',
  full: '#f0614a',
  accent: '#5aa6f0',
  glow: 1,
};

// Raised surfaces get a darker side and a lighter lit face.
const SHADED = ['house', 'house2', 'house3', 'apartment', 'office', 'office2', 'office3', 'parking', 'parkRide'];

function parse(c) {
  if (c.startsWith('#')) {
    const n = parseInt(c.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const m = c.match(/rgba?\(([^)]+)\)/)[1].split(',').map((x) => parseFloat(x));
  return [m[0], m[1], m[2], m.length > 3 ? m[3] : 1];
}

const fmt = (x) => `rgba(${Math.round(x[0])}, ${Math.round(x[1])}, ${Math.round(x[2])}, ${x[3].toFixed(3)})`;

export function mix(a, b, t) {
  const x = parse(a), y = parse(b);
  return fmt([0, 1, 2, 3].map((i) => x[i] + (y[i] - x[i]) * t));
}

export function withAlpha(c, a) {
  const x = parse(c);
  return fmt([x[0], x[1], x[2], x[3] * a]);
}

let cacheKey = -1;
let cache = null;

// Palette for a given darkness (0 day .. 1 night), cached while it doesn't change.
export function palette(night) {
  const key = Math.round(night * 120);
  if (key === cacheKey) return cache;
  const t = key / 120;
  const out = {};
  for (const k of Object.keys(DAY)) out[k] = k === 'glow' ? t : mix(DAY[k], NIGHT[k], t);
  for (const k of SHADED) {
    out[`${k}Side`] = mix(out[k], '#2a1f14', 0.22);
    out[`${k}Lit`] = mix(out[k], '#ffffff', 0.12);
  }
  cacheKey = key;
  cache = out;
  return out;
}

export const ease = {
  // Gentle overshoot for things settling into place.
  outBack(t, s = 1.4) {
    t = Math.min(1, Math.max(0, t));
    return 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2;
  },
  // Same feel as cubic-bezier(0.23, 1, 0.32, 1): fast start, long soft landing.
  out(t) { t = Math.min(1, Math.max(0, t)); return 1 - (1 - t) ** 4; },
  inOut(t) { t = Math.min(1, Math.max(0, t)); return t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2; },
  smooth(t) { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); },
};
