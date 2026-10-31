// Builds the starting city: a street grid split by a river, a downtown of offices and
// city parking, and houses and apartments around it.

import { C } from './config.js';
import {
  LANE_CAR, B_HOUSE, B_APARTMENT, B_OFFICE, B_PARKING,
  ZONE_RES, ZONE_MID, ZONE_CORE, ZONE_PARK, ZONE_WATER,
} from './model.js';

export const NX = 11;           // intersections across
export const NY = 7;            // intersections down
export const SX = 170;          // block spacing
export const SY = 150;

const RIVER_COL = 3;            // block column that is water
const BRIDGE_ROWS = [1, 3, 5];
const PARKS = [[1, 1], [5, 4], [6, 4]];
const REMOVED = [[[6, 4], [6, 5]]];   // joins the two central park blocks
const AVENUE_ROW = 3;
const AVENUE_COL = 5;
const CORE = { x: 5, y: 2, w: 3, h: 2 };
const CITY_PARKING = [[5, 2, 0, 0], [7, 2, 1, 0], [5, 3, 0, 1], [6, 3, 1, 1]];  // bx, by, cx, cy

const TWO_WAY = [[-1, LANE_CAR], [1, LANE_CAR]];
const AVENUE = [[-1, LANE_CAR], [-1, LANE_CAR], [1, LANE_CAR], [1, LANE_CAR]];

const isPark = (bx, by) => PARKS.some(([x, y]) => x === bx && y === by);
const isRemoved = (a, b) => REMOVED.some(([p, q]) =>
  (p[0] === a[0] && p[1] === a[1] && q[0] === b[0] && q[1] === b[1]) ||
  (p[0] === b[0] && p[1] === b[1] && q[0] === a[0] && q[1] === a[1]));

function zoneOf(bx, by) {
  if (bx === RIVER_COL) return ZONE_WATER;
  if (isPark(bx, by)) return ZONE_PARK;
  if (bx >= CORE.x && bx < CORE.x + CORE.w && by >= CORE.y && by < CORE.y + CORE.h) return ZONE_CORE;
  if (bx >= CORE.x - 1 && bx <= CORE.x + CORE.w && by >= CORE.y - 1 && by <= CORE.y + CORE.h) return ZONE_MID;
  return ZONE_RES;
}

export function buildMap(sim) {
  const net = sim.net;
  const rng = sim.rng;
  const id = (i, j) => j * NX + i;
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) net.addNode(i * SX, j * SY);

  for (let j = 0; j < NY; j++) {
    for (let i = 0; i < NX - 1; i++) {
      if (i === RIVER_COL && !BRIDGE_ROWS.includes(j)) continue;
      if (isRemoved([i, j], [i + 1, j])) continue;
      const sid = net.addSegment(id(i, j), id(i + 1, j), j === AVENUE_ROW ? AVENUE : TWO_WAY);
      if (i === RIVER_COL) net.segs[sid].bridge = true;
    }
  }
  for (let i = 0; i < NX; i++) {
    for (let j = 0; j < NY - 1; j++) {
      if (isRemoved([i, j], [i, j + 1])) continue;
      net.addSegment(id(i, j), id(i, j + 1), i === AVENUE_COL ? AVENUE : TWO_WAY);
    }
  }

  const map = {
    w: (NX - 1) * SX, h: (NY - 1) * SY, blocks: [], parks: [], trees: [], river: [],
  };
  sim.map = map;
  const inset = C.BLOCK_INSET;

  for (let by = 0; by < NY - 1; by++) {
    for (let bx = 0; bx < NX - 1; bx++) {
      const zone = zoneOf(bx, by);
      const rect = { x: bx * SX + inset, y: by * SY + inset, w: SX - 2 * inset, h: SY - 2 * inset };
      if (zone === ZONE_WATER) continue;
      if (zone === ZONE_PARK) {
        // Stretch over a missing road so neighbouring park blocks read as one park.
        if (isPark(bx + 1, by) && net.findSegment(id(bx + 1, by), id(bx + 1, by + 1)) < 0) {
          rect.w += 2 * inset;
        }
        map.parks.push(rect);
        const n = Math.round(rect.w * rect.h / 900);
        for (let k = 0; k < n; k++) {
          map.trees.push({
            x: rng.range(rect.x + 8, rect.x + rect.w - 8),
            y: rng.range(rect.y + 8, rect.y + rect.h - 8),
            r: rng.range(4, 7.5),
          });
        }
        continue;
      }
      map.blocks.push(rect);
      const lw = (rect.w - C.LOT_GAP) / 2, lh = (rect.h - C.LOT_GAP) / 2;
      for (let cy = 0; cy < 2; cy++) {
        for (let cx = 0; cx < 2; cx++) {
          const r = { x: rect.x + cx * (lw + C.LOT_GAP), y: rect.y + cy * (lh + C.LOT_GAP), w: lw, h: lh };
          const center = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
          const access = [];
          const vi = cx === 0 ? bx : bx + 1;
          const vseg = net.findSegment(id(vi, by), id(vi, by + 1));
          if (vseg >= 0) access.push({ seg: vseg, side: cx === 0 ? -1 : 1, edge: cx === 0 ? 'l' : 'r' });
          const hj = cy === 0 ? by : by + 1;
          const hseg = net.findSegment(id(bx, hj), id(bx + 1, hj));
          if (hseg >= 0) access.push({ seg: hseg, side: cy === 0 ? 1 : -1, edge: cy === 0 ? 't' : 'b' });
          sim.lots.push({
            id: sim.lots.length, rect: r, center, zone, bx, by, cx, cy, building: -1,
            cleared: false, access,
          });
        }
      }
    }
  }

  // A gently winding river down the water column.
  const cx = (RIVER_COL + 0.5) * SX;
  const half = SX / 2 - inset + 2;
  const left = [], right = [];
  for (let y = -260; y <= map.h + 260; y += 16) {
    const wob = Math.sin(y / 95) * 7 + Math.sin(y / 37 + 1.3) * 2.5;
    left.push({ x: cx - half + wob, y });
    right.push({ x: cx + half + wob * 0.7, y });
  }
  map.river = [...left, ...right.reverse()];

  // Offices and city parking first, so new residents have somewhere to work.
  for (const lot of sim.lots) {
    if (lot.zone === ZONE_CORE) {
      const parking = CITY_PARKING.some(([bx, by, cx2, cy2]) =>
        lot.bx === bx && lot.by === by && lot.cx === cx2 && lot.cy === cy2);
      if (parking) sim.addBuilding(lot, B_PARKING, 1);
      else if (rng.next() < 0.7) sim.addBuilding(lot, B_OFFICE, 1);
    } else if (lot.zone === ZONE_MID && rng.next() < 0.12) {
      sim.addBuilding(lot, B_OFFICE, 1);
    }
  }
  for (const lot of sim.lots) {
    if (lot.building >= 0) continue;
    const r = rng.next();
    if (lot.zone === ZONE_MID) {
      if (r < 0.18) sim.addBuilding(lot, B_APARTMENT, 1);
      else if (r < 0.28) sim.addBuilding(lot, B_HOUSE, 1);
    } else if (lot.zone === ZONE_RES) {
      if (r < 0.04) sim.addBuilding(lot, B_APARTMENT, 1);
      else if (r < 0.34) sim.addBuilding(lot, B_HOUSE, 1);
    }
  }
}
