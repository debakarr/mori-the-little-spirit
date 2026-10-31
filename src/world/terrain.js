import * as THREE from 'three';
import { fbm2, noise2, smoothstep, clamp, lerp } from '../core/noise.js';
import { patchMaterial } from '../core/shaders.js';

// ---------------------------------------------------------------- layout
// The grove (the first clearing, ~25 m across) sits at the origin. Around it: forested hills, a river
// from Whisper Falls at the foot of the mountains down through the grove into Mirror Lake, Mushroom
// Hollow in a dell to the west, a windy plateau overlook to the north-west and a sunny meadow to the
// south, all linked by trails, inside a ring of mountains.
export const CLEARING_RADIUS = 12.5;
export const TREE_POS = new THREE.Vector3(-1, 0, -5.5);
export const TREE_BASE_Y = 0.12;
export const SPAWN = new THREE.Vector3(0.6, 0, 8.2);
export const WATER_Y = -0.26;
export const WORLD_RADIUS = 118; // walkable; mountains rise past ~85 m
const GROVE_BLEND = [20, 30]; // the grove's own height formula hands over to the landscape here

export const AREAS = {
  hollow: { x: -58, z: 8, r: 15, name: 'Mushroom Hollow' },
  overlook: { x: -40, z: -62, r: 10, name: 'Windy Overlook', height: 15 },
  lake: { x: 62, z: 58, r: 17, name: 'Mirror Lake' },
  falls: { x: 58, z: -80, r: 6, name: 'Whisper Falls', height: 16 },
  meadow: { x: -12, z: 50, r: 17, name: 'Sunny Meadow' },
};
const FALLS_DIR = new THREE.Vector2(AREAS.falls.x, AREAS.falls.z).normalize(); // away from the grove

export const streamCurve = new THREE.CatmullRomCurve3(
  [
    [58, -80], [55, -66], [48, -50], [40, -33],
    [30, -16], [17, -7], [10.5, -4.2], [7.2, -0.6], [7.0, 3.8], [9.2, 8.2], [13.5, 13.5], [26, 26],
    [36, 36], [47, 46], [62, 58],
  ].map(([x, z]) => new THREE.Vector3(x, 0, z)),
  false, 'catmullrom', 0.5,
);
export const STREAM_SAMPLES = streamCurve.getSpacedPoints(1800);

// Trodden trails: the grove path from the spawn point to the tree's doorway, then out to each area.
const PATHS = [
  [[0.6, 10.5], [0.5, 7.5], [0.0, 4.5], [-0.6, 1.5], [-0.9, -2.2]],
  [[-1.5, 2.5], [-12, 4], [-26, 6.5], [-40, 8], [-50, 8]],
  [[0.5, 10], [-1.5, 19], [-5, 31], [-10, 42]],
  [[-6, -3], [-15, -16], [-24, -30], [-31, -44], [-36, -54]],
  [[11, 11], [20, 22], [32, 30], [43, 40], [50, 47]],
  [[12, -9], [22, -18], [33, -31], [42, -47], [50, -62], [53, -72]],
].map((line) => line.map(([x, z]) => new THREE.Vector2(x, z)));

// Spatial hash of stream samples for fast distance queries near the water.
const CELL = 4;
const buckets = new Map();
STREAM_SAMPLES.forEach((p, i) => {
  const k = `${Math.floor(p.x / CELL)},${Math.floor(p.z / CELL)}`;
  if (!buckets.has(k)) buckets.set(k, []);
  buckets.get(k).push(i);
});

/** Distance (m) from (x, z) to the stream centre line, capped at ~8 m. */
export function streamDistance(x, z) {
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  let best = 64;
  for (let i = -2; i <= 2; i++) {
    for (let j = -2; j <= 2; j++) {
      const b = buckets.get(`${cx + i},${cz + j}`);
      if (!b) continue;
      for (const idx of b) {
        const p = STREAM_SAMPLES[idx];
        const d = (p.x - x) ** 2 + (p.z - z) ** 2;
        if (d < best) best = d;
      }
    }
  }
  return Math.sqrt(best);
}

export function pathDistance(x, z) {
  let best = Infinity;
  for (const line of PATHS) {
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i], b = line[i + 1];
      const abx = b.x - a.x, abz = b.y - a.y;
      const t = clamp(((x - a.x) * abx + (z - a.y) * abz) / (abx * abx + abz * abz), 0, 1);
      best = Math.min(best, Math.hypot(x - (a.x + abx * t), z - (a.y + abz * t)));
    }
  }
  return best;
}

// Coarse distance to the river for shaping its valley (exact distance is only kept within 8 m).
const RD_STEP = 2, RD_HALF = 150, RD_N = (RD_HALF * 2) / RD_STEP + 1;
const riverGrid = (() => {
  const g = new Float32Array(RD_N * RD_N);
  const pts = STREAM_SAMPLES.filter((_, i) => i % 3 === 0);
  for (let j = 0; j < RD_N; j++) {
    for (let i = 0; i < RD_N; i++) {
      const x = -RD_HALF + i * RD_STEP, z = -RD_HALF + j * RD_STEP;
      let best = Infinity;
      for (const p of pts) {
        const d = (p.x - x) ** 2 + (p.z - z) ** 2;
        if (d < best) best = d;
      }
      g[j * RD_N + i] = Math.sqrt(best);
    }
  }
  return g;
})();

function sampleGrid(grid, n, half, step, x, z) {
  const fx = clamp((x + half) / step, 0, n - 1.001), fz = clamp((z + half) / step, 0, n - 1.001);
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
  const a = grid[j * n + i], b = grid[j * n + i + 1], c = grid[(j + 1) * n + i], d = grid[(j + 1) * n + i + 1];
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

/** Distance to the river's centre line (coarse; for valleys and placement). */
export const riverDistance = (x, z) => sampleGrid(riverGrid, RD_N, RD_HALF, RD_STEP, x, z);

const areaDist = (a, x, z) => Math.hypot(x - a.x, z - a.z);

/** The first clearing's own shape: gentle meadow, flattened under the tree, a rising rim. */
function groveHeight(x, z, pd, ds) {
  const r = Math.hypot(x, z);
  let h = 0.06 + (fbm2(x * 0.11 + 3.1, z * 0.11 - 7.3) - 0.5) * 0.5 + (noise2(x * 0.55, z * 0.55) - 0.5) * 0.06;
  const dt = Math.hypot(x - TREE_POS.x, z - TREE_POS.z);
  h = lerp(h, TREE_BASE_Y, 1 - smoothstep(4.5, 8, dt));
  // the rim: wooded banks around the clearing, with gaps where the trails lead out
  const rim = smoothstep(12.5, 26, r) * (0.35 + 0.65 * smoothstep(1.5, 5, pd));
  h += rim * rim * 5 * smoothstep(1.5, 8, ds) + rim * 0.5;
  return h;
}

/** Everything outside the grove: rolling hills, the mountain ring and each area's landform. */
function landHeight(x, z) {
  const r = Math.hypot(x, z);
  let h = 2.2 + (fbm2(x * 0.016 + 11, z * 0.016 - 4) - 0.5) * 12 + (fbm2(x * 0.05, z * 0.05) - 0.5) * 3;
  // mountains: foothills at the walkable edge, ridged peaks rising well beyond it
  const m = smoothstep(85, 250, r);
  const ridge = 1 - Math.abs(2 * fbm2(x * 0.011 + 40, z * 0.011 + 40) - 1);
  h += m * m * (70 + 70 * ridge) + smoothstep(220, 330, r) * 30;
  // Mushroom Hollow: a mossy dell
  const dh = areaDist(AREAS.hollow, x, z);
  h = lerp(h, 0.35 + (fbm2(x * 0.2, z * 0.2) - 0.5) * 0.5, 1 - smoothstep(12, 24, dh));
  // Windy Overlook: a plateau with walkable flanks
  const dovl = areaDist(AREAS.overlook, x, z);
  h = lerp(h, AREAS.overlook.height + (noise2(x * 0.3, z * 0.3) - 0.5) * 0.6, 1 - smoothstep(9, 48, dovl)); // flanks stay walkable (~30°)
  // Sunny Meadow: open, gently sloping ground
  const dm = areaDist(AREAS.meadow, x, z);
  h = lerp(h, 1.4 + (fbm2(x * 0.06, z * 0.06) - 0.5) * 1.6, 1 - smoothstep(14, 30, dm));
  return h;
}

/** Ground height before the grid cache (see heightAt). */
function heightRaw(x, z) {
  const r = Math.hypot(x, z);
  const pd = pathDistance(x, z);
  const ds = streamDistance(x, z);
  const blend = smoothstep(GROVE_BLEND[0], GROVE_BLEND[1], r);
  let h = blend < 1 ? groveHeight(x, z, pd, ds) : 0;
  if (blend > 0) h = lerp(h, landHeight(x, z), blend);
  // trails stay walkable: soften bumps along them
  h = lerp(h, h * 0.85 + 0.15 * (h - (noise2(x * 0.4, z * 0.4) - 0.5)), 1 - smoothstep(1, 3, pd));
  // the river's valley (outside the grove, which shapes its own banks)
  const dr = riverDistance(x, z);
  h = lerp(h, Math.min(h, 0.45 + dr * 0.05), (1 - smoothstep(4, 18, dr)) * blend);
  // Whisper Falls: a cliff shelf behind the falls pool
  const fx = x - AREAS.falls.x, fz = z - AREAS.falls.z;
  const along = fx * FALLS_DIR.x + fz * FALLS_DIR.y, lat = Math.abs(-fx * FALLS_DIR.y + fz * FALLS_DIR.x);
  const cliff = AREAS.falls.height * smoothstep(4.5, 7.5, along) * (1 - smoothstep(10, 26, lat));
  h = Math.max(h, cliff + (noise2(x * 0.5, z * 0.5) - 0.5) * 0.8 * smoothstep(4.5, 7.5, along));
  // Mirror Lake: a bowl below the water line, sandy shelving shore
  const dl = areaDist(AREAS.lake, x, z) + (noise2(x * 0.12, z * 0.12) - 0.5) * 4;
  const R = AREAS.lake.r;
  const bowl = WATER_Y - 0.12 - 0.5 * (1 - clamp(dl / R, 0, 1) ** 2); // shallow enough to wade
  h = lerp(h, Math.min(h, bowl), 1 - smoothstep(R - 1, R + 9, dl));
  // the stream bed itself, with a wider pool under the falls
  const pool = 1 - smoothstep(AREAS.falls.r - 1, AREAS.falls.r + 1.5, areaDist(AREAS.falls, x, z));
  const w = Math.max(1 - smoothstep(0.8, 2.0, ds), pool);
  const bed = WATER_Y - 0.32 - pool * 0.2 + (noise2(x * 0.9, z * 0.9) - 0.5) * 0.1;
  return h * (1 - w) + Math.min(h, bed) * w;
}

// Height cache over the walkable world: the terrain mesh, the physics heightfield, the GPU grass and
// every placement all read this one grid, so they agree to the millimetre.
export const GRID_HALF = 128, GRID_STEP = 0.5, GRID_N = (GRID_HALF * 2) / GRID_STEP + 1;
export const heightGrid = (() => {
  const g = new Float32Array(GRID_N * GRID_N);
  for (let j = 0; j < GRID_N; j++) {
    const z = -GRID_HALF + j * GRID_STEP;
    for (let i = 0; i < GRID_N; i++) g[j * GRID_N + i] = heightRaw(-GRID_HALF + i * GRID_STEP, z);
  }
  return g;
})();

/** Ground height at (x, z). */
export function heightAt(x, z) {
  if (Math.abs(x) < GRID_HALF - 0.01 && Math.abs(z) < GRID_HALF - 0.01) return sampleGrid(heightGrid, GRID_N, GRID_HALF, GRID_STEP, x, z);
  return heightRaw(x, z);
}

/** Ground slope (rise per metre) at (x, z). */
export function slopeAt(x, z) {
  const e = 0.6;
  return Math.hypot(heightAt(x + e, z) - heightAt(x - e, z), heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
}

const C = (hex) => new THREE.Color(hex);
const GRASS_DARK = C('#3d6a22');
const GRASS_LIGHT = C('#74a137');
const GRASS_DRY = C('#a2a94b');
const MOSS = C('#3f6328');
const DIRT = C('#8a6a48');
const MUD = C('#4a3e2b');
const PEBBLE = C('#7c7564');
const FOREST = C('#2f4621');
const ROCK = C('#7f8388');
const ROCK_DARK = C('#5d6268');
const SNOW = C('#e8ecef');
const SAND = C('#b9a77c');
const HOLLOW = C('#2c4a2c');

function groundColor(x, z, out) {
  const ds = streamDistance(x, z);
  const pd = pathDistance(x, z);
  const r = Math.hypot(x, z);
  const h = heightAt(x, z);
  const dt = Math.hypot(x - TREE_POS.x, z - TREE_POS.z);
  const n = fbm2(x * 0.18, z * 0.18);
  out.copy(GRASS_DARK).lerp(GRASS_LIGHT, smoothstep(0.3, 0.7, n));
  out.lerp(GRASS_DRY, smoothstep(0.58, 0.75, fbm2(x * 0.07 + 10, z * 0.07)) * 0.6);
  out.lerp(MOSS, (1 - smoothstep(3, 7, dt)) * 0.6);
  // forest floor away from the open places
  const open = Math.max(1 - smoothstep(12, 20, r), 1 - smoothstep(16, 28, areaDist(AREAS.meadow, x, z)),
    1 - smoothstep(10, 18, areaDist(AREAS.overlook, x, z)));
  out.lerp(FOREST, (1 - open) * 0.85);
  out.lerp(HOLLOW, (1 - smoothstep(10, 22, areaDist(AREAS.hollow, x, z))) * 0.7);
  const pathEdge = pd + (noise2(x * 1.7, z * 1.7) - 0.5) * 0.5;
  out.lerp(DIRT, (1 - smoothstep(0.35, 0.95, pathEdge)) * (r < 15 ? 1 : 0.85));
  out.lerp(SAND, (1 - smoothstep(0.2, 1.6, h - WATER_Y)) * (1 - smoothstep(AREAS.lake.r + 6, AREAS.lake.r + 12, areaDist(AREAS.lake, x, z))));
  out.lerp(MUD, 1 - smoothstep(1.0, 2.1, ds + (noise2(x * 2, z * 2) - 0.5) * 0.4));
  out.lerp(PEBBLE, (1 - smoothstep(0.4, 1.1, ds)) * smoothstep(0.35, 0.7, noise2(x * 4, z * 4)));
  // bare rock on steep ground and high up, snow on the peaks
  const steep = smoothstep(0.75, 1.2, slopeAt(x, z));
  // rock in broad patches (the far mesh is coarse: fine noise would turn into blotches)
  out.lerp(ROCK.clone().lerp(ROCK_DARK, smoothstep(0.35, 0.65, fbm2(x * 0.03, z * 0.03))), Math.max(steep, smoothstep(34, 52, h)));
  out.lerp(SNOW, smoothstep(68, 80, h + (noise2(x * 0.08, z * 0.08) - 0.5) * 10));
  return out;
}

/** Grass density 0..1 for the grass field: lush in the clearings, thin under trees, none on water or rock. */
export function grassDensity(x, z) {
  const ds = streamDistance(x, z);
  const pd = pathDistance(x, z);
  const r = Math.hypot(x, z);
  const dt = Math.hypot(x - TREE_POS.x, z - TREE_POS.z);
  const h = heightAt(x, z);
  let d = smoothstep(1.15, 1.7, ds) * smoothstep(0.45, 1.1, pd);
  d *= smoothstep(2.6, 3.6, dt) * 0.7 + 0.3 * smoothstep(1.8, 2.4, dt);
  const open = Math.max(1 - smoothstep(14, 18, r), 1 - smoothstep(16, 28, areaDist(AREAS.meadow, x, z)),
    1 - smoothstep(9, 16, areaDist(AREAS.overlook, x, z)));
  d *= 0.3 + 0.7 * open; // the forest floor keeps a thin cover
  d *= smoothstep(0.15, 0.5, h - WATER_Y); // no grass under water
  d *= 1 - smoothstep(0.7, 1.0, slopeAt(x, z)) * 0.9;
  d *= 1 - smoothstep(26, 36, h);
  return d * (0.55 + 0.45 * smoothstep(0.25, 0.6, fbm2(x * 0.2 + 4, z * 0.2)));
}

/** Tree cover 0..1 (none in the clearings, on the water, on trails, on bare rock or the peaks). */
export function forestDensity(x, z) {
  const r = Math.hypot(x, z);
  const h = heightAt(x, z);
  let d = smoothstep(15, 19, r);
  d *= smoothstep(3.5, 6, riverDistance(x, z));
  d *= smoothstep(2.5, 4.5, pathDistance(x, z));
  d *= smoothstep(18, 26, areaDist(AREAS.meadow, x, z));
  d *= smoothstep(11, 16, areaDist(AREAS.overlook, x, z));
  d *= smoothstep(AREAS.lake.r + 3, AREAS.lake.r + 7, areaDist(AREAS.lake, x, z));
  d *= smoothstep(9, 14, areaDist(AREAS.falls, x, z));
  d *= 0.08 + 0.92 * smoothstep(14, 21, areaDist(AREAS.hollow, x, z)); // the dell itself is the mushrooms'
  d *= 1 - smoothstep(42, 58, h);
  d *= 1 - smoothstep(0.85, 1.2, slopeAt(x, z));
  return d * (0.45 + 0.55 * smoothstep(0.3, 0.6, fbm2(x * 0.035 + 20, z * 0.035 - 9))); // glades
}

/**
 * The visible ground: one mesh, densest around the grove (0.4 m) and coarser outward (~6 m on the far
 * mountains), so there are no seams between detail levels.
 * inject: extra shading for the stream bed (water.js createStream().bed).
 */
export function createTerrain(inject) {
  const n = 340, half = 330;
  const warp = (u) => Math.sign(u) * half * (0.28 * Math.abs(u) + 0.72 * Math.abs(u) ** 3); // u in [-1, 1]
  const xs = Array.from({ length: n + 1 }, (_, i) => warp((i / n) * 2 - 1));
  const pos = new Float32Array((n + 1) ** 2 * 3);
  const colors = new Float32Array((n + 1) ** 2 * 3);
  const c = new THREE.Color();
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const k = j * (n + 1) + i, x = xs[i], z = xs[j];
      pos.set([x, heightAt(x, z), z], k * 3);
      groundColor(x, z, c);
      colors.set([c.r, c.g, c.b], k * 3);
    }
  }
  const idx = new Uint32Array(n * n * 6);
  let t = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i, b = a + 1, d = a + n + 1, e = d + 1;
      idx.set([a, d, b, b, d, e], t);
      t += 6;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96 });
  patchMaterial(mat, { detail: [1.6, 1.6, 1.6, 0.22], inject });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'Terrain';
  return mesh;
}

/** Rapier heightfield over the walkable world, straight from the height grid. */
export function terrainColliderData() {
  // Rapier stores heightfields column-major: heights[col * nrows + row], rows along z
  const heights = new Float32Array(GRID_N * GRID_N);
  for (let i = 0; i < GRID_N; i++) {
    for (let j = 0; j < GRID_N; j++) heights[i * GRID_N + j] = heightGrid[j * GRID_N + i];
  }
  return { rows: GRID_N - 1, cols: GRID_N - 1, heights, size: GRID_HALF * 2 };
}
