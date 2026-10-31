import { rng, fbm2 } from '../core/noise.js';
import {
  heightAt, slopeAt, forestDensity, grassDensity, riverDistance, streamDistance, pathDistance, AREAS, WORLD_RADIUS, WATER_Y,
} from './terrain.js';

const COMMON = ['CommonTree_1', 'CommonTree_2', 'CommonTree_3', 'CommonTree_4', 'CommonTree_5'];
const PINES = ['Pine_1', 'Pine_2', 'Pine_3', 'Pine_5'];
export const TREE_MODELS = [...COMMON, ...PINES, 'TwistedTree_1', 'TwistedTree_3'];

const dist = (a, x, z) => Math.hypot(x - a.x, z - a.z);

/**
 * Placements for the world outside the grove (MegaKit models, src/world/megakit.js KitLOD):
 * trees on a jittered grid weighted by forestDensity (pines up the slopes, old twisted giants over the
 * hollow and here and there), undergrowth on the forest floor, flowers and tufts in the open places,
 * boulders on the hillsides and pebbles along the river. Deterministic (seeded).
 */
export function generateForest(seed = 11) {
  const r = rng(seed);
  const pick = (list) => list[Math.floor(r() * list.length)];
  const trees = [], ground = [];
  const outside = (x, z) => Math.hypot(x, z) < WORLD_RADIUS + 60;

  // ---- trees: 7 m cells, one candidate each
  const CELL = 7;
  for (let gx = -150; gx < 150; gx += CELL) {
    for (let gz = -150; gz < 150; gz += CELL) {
      const x = gx + r() * CELL, z = gz + r() * CELL;
      if (!outside(x, z)) continue;
      const d = forestDensity(x, z);
      if (r() > d) continue;
      const h = heightAt(x, z);
      const pine = h > 9 || r() < 0.18 + smooth(h, 3, 9) * 0.5;
      const giant = dist(AREAS.hollow, x, z) < 24 ? r() < 0.3 : r() < 0.025;
      const model = giant ? pick(['TwistedTree_1', 'TwistedTree_3']) : pick(pine ? PINES : COMMON);
      const scale = giant ? 0.75 + r() * 0.3 : 1.1 + r() * 0.55;
      const trunk = (giant ? 0.95 : pine ? 0.28 : 0.34) * scale; // collider radius at the base
      trees.push({ model, x, z, y: h - 0.15, yaw: r() * Math.PI * 2, scale, near: giant ? 60 : 40, far: 260, trunk });
    }
  }

  // ---- forest floor: ferns, bushes and leafy plants, thicker where the trees are
  for (let gx = -120; gx < 120; gx += 3.2) {
    for (let gz = -120; gz < 120; gz += 3.2) {
      const x = gx + r() * 3.2, z = gz + r() * 3.2;
      if (Math.hypot(x, z) < 17 || Math.hypot(x, z) > WORLD_RADIUS + 10) continue;
      const f = forestDensity(x, z);
      if (r() > f * 0.7 + 0.05) continue;
      if (pathDistance(x, z) < 1.6 || streamDistance(x, z) < 1.6 || heightAt(x, z) < WATER_Y + 0.15 || slopeAt(x, z) > 1.1) continue;
      const u = r();
      const [model, s0, s1] = u < 0.38 ? ['Fern_1', 0.8, 1.3] : u < 0.58 ? ['Bush_Common', 0.65, 1.0]
        : u < 0.7 ? ['Bush_Common_Flowers', 0.55, 0.85] : u < 0.85 ? ['Plant_1_Big', 0.55, 0.9] : ['Plant_1', 0.7, 1.1];
      ground.push({ model, x, z, y: heightAt(x, z) - 0.04, yaw: r() * 6.28, scale: s0 + r() * (s1 - s0), near: model.startsWith('Bush') ? 42 : 30 });
    }
  }

  // ---- open places: flower clumps, clover and wispy tufts (the meadow is the showpiece)
  for (let i = 0; i < 2600; i++) {
    const x = (r() - 0.5) * 2 * WORLD_RADIUS, z = (r() - 0.5) * 2 * WORLD_RADIUS;
    if (Math.hypot(x, z) < 17 || Math.hypot(x, z) > WORLD_RADIUS) continue;
    const g = grassDensity(x, z);
    if (g < 0.45 || r() > g * 0.6 || pathDistance(x, z) < 1.2) continue;
    const meadow = dist(AREAS.meadow, x, z) < 28;
    const u = r();
    const flower = meadow ? u < 0.55 : u < 0.25;
    const model = flower ? 'Flower_3_Group' : u < 0.75 ? 'Clover_2' : 'Grass_Wispy_Tall'; // Flower_4 is 4x heavier
    const scale = flower ? 0.22 + r() * 0.1 : model === 'Clover_2' ? 0.3 + r() * 0.12 : 0.3 + r() * 0.18;
    ground.push({ model, x, z, y: heightAt(x, z) - 0.02, yaw: r() * 6.28, scale, near: 24 });
  }

  // ---- the meadow in bloom
  const M = AREAS.meadow;
  for (let i = 0; i < 240; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 27;
    const x = M.x + Math.cos(a) * d, z = M.z + Math.sin(a) * d;
    if (pathDistance(x, z) < 1.2 || Math.hypot(x - M.x, z - M.z) < 3.8) continue;
    const kind = fbm2(x * 0.09, z * 0.09);
    ground.push({ model: kind > 0.42 ? 'Flower_3_Group' : 'Clover_2', x, z, y: heightAt(x, z) - 0.02, yaw: r() * 6.28, scale: 0.2 + r() * 0.12, near: 28 });
  }

  // ---- boulders on the hillsides and mountain feet, pebbles along the river
  for (let i = 0; i < 260; i++) {
    const a = r() * Math.PI * 2, rad = 20 + Math.sqrt(r()) * (WORLD_RADIUS + 30 - 20);
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
    if (riverDistance(x, z) < 4 || pathDistance(x, z) < 2.5 || heightAt(x, z) < WATER_Y + 0.2) continue;
    const sl = slopeAt(x, z);
    if (sl > 0.8 || r() > 0.3 + sl * 0.6) continue; // steep ground would leave them hanging in the air
    ground.push({ model: pick(['Rock_Medium_1', 'Rock_Medium_2', 'Rock_Medium_3']), x, z, y: heightAt(x, z) - 0.25, yaw: r() * 6.28, scale: 0.4 + r() * 0.8, near: 70 });
  }
  for (let i = 0; i < 1800; i++) {
    const x = (r() - 0.5) * 240, z = (r() - 0.5) * 240;
    if (Math.hypot(x, z) < 16) continue;
    const d = streamDistance(x, z);
    if (d < 1.0 || d > 2.0) continue;
    ground.push({ model: pick(['Pebble_Round_1', 'Pebble_Round_2', 'Pebble_Round_3']), x, z, y: heightAt(x, z) - 0.02, yaw: r() * 6.28, scale: 0.5 + r() * 0.6, near: 22 });
  }
  return { trees, ground };
}

function smooth(v, a, b) {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
