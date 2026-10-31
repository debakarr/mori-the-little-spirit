import * as THREE from 'three';
import { fbm2, noise2, smoothstep, clamp, lerp } from '../core/noise.js';
import { patchMaterial } from '../core/shaders.js';

// ---------------------------------------------------------------- layout
export const CLEARING_RADIUS = 12.5;
export const TREE_POS = new THREE.Vector3(-1, 0, -5.5);
export const TREE_BASE_Y = 0.12;
export const SPAWN = new THREE.Vector3(0.6, 0, 8.2);
export const WATER_Y = -0.26;

export const streamCurve = new THREE.CatmullRomCurve3(
  [
    [30, -16], [17, -7], [10.5, -4.2], [7.2, -0.6], [7.0, 3.8], [9.2, 8.2], [13.5, 13.5], [26, 26],
  ].map(([x, z]) => new THREE.Vector3(x, 0, z)),
  false, 'catmullrom', 0.5,
);
export const STREAM_SAMPLES = streamCurve.getSpacedPoints(500);

// Path of trodden earth from the spawn point to the tree's doorway.
const PATH = [
  [0.6, 10.5], [0.5, 7.5], [0.0, 4.5], [-0.6, 1.5], [-0.9, -2.2],
].map(([x, z]) => new THREE.Vector2(x, z));

// Spatial hash of stream samples for fast distance queries.
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
  for (let i = 0; i < PATH.length - 1; i++) {
    const a = PATH[i], b = PATH[i + 1];
    const abx = b.x - a.x, abz = b.y - a.y;
    const t = clamp(((x - a.x) * abx + (z - a.y) * abz) / (abx * abx + abz * abz), 0, 1);
    best = Math.min(best, Math.hypot(x - (a.x + abx * t), z - (a.y + abz * t)));
  }
  return best;
}

/** Ground height at (x, z). Gentle meadow, flattened under the tree, a carved stream and a rising rim. */
export function heightAt(x, z) {
  const r = Math.hypot(x, z);
  const ds = streamDistance(x, z);
  let h = 0.06 + (fbm2(x * 0.11 + 3.1, z * 0.11 - 7.3) - 0.5) * 0.5 + (noise2(x * 0.55, z * 0.55) - 0.5) * 0.06;
  const dt = Math.hypot(x - TREE_POS.x, z - TREE_POS.z);
  h = lerp(h, TREE_BASE_Y, 1 - smoothstep(4.5, 8, dt));
  const rim = smoothstep(12.5, 26, r);
  h += rim * rim * 7 * smoothstep(1.5, 8, ds) + rim * 0.5;
  const w = 1 - smoothstep(0.8, 2.0, ds);
  const bed = WATER_Y - 0.32 + (noise2(x * 0.9, z * 0.9) - 0.5) * 0.1;
  h = h * (1 - w) + Math.min(h, bed) * w;
  return h;
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

function groundColor(x, z, out) {
  const ds = streamDistance(x, z);
  const pd = pathDistance(x, z);
  const r = Math.hypot(x, z);
  const dt = Math.hypot(x - TREE_POS.x, z - TREE_POS.z);
  const n = fbm2(x * 0.18, z * 0.18);
  out.copy(GRASS_DARK).lerp(GRASS_LIGHT, smoothstep(0.3, 0.7, n));
  out.lerp(GRASS_DRY, smoothstep(0.58, 0.75, fbm2(x * 0.07 + 10, z * 0.07)) * 0.6);
  out.lerp(MOSS, (1 - smoothstep(3, 7, dt)) * 0.6);
  const pathEdge = pd + (noise2(x * 1.7, z * 1.7) - 0.5) * 0.5;
  out.lerp(DIRT, 1 - smoothstep(0.35, 0.95, pathEdge));
  out.lerp(MUD, 1 - smoothstep(1.0, 2.1, ds + (noise2(x * 2, z * 2) - 0.5) * 0.4));
  out.lerp(PEBBLE, (1 - smoothstep(0.4, 1.1, ds)) * smoothstep(0.35, 0.7, noise2(x * 4, z * 4)));
  out.lerp(FOREST, smoothstep(13, 20, r) * 0.85);
  return out;
}

/** Grass density 0..1 used when scattering blades. */
export function grassDensity(x, z) {
  const ds = streamDistance(x, z);
  const pd = pathDistance(x, z);
  const r = Math.hypot(x, z);
  const dt = Math.hypot(x - TREE_POS.x, z - TREE_POS.z);
  let d = smoothstep(1.15, 1.7, ds) * smoothstep(0.45, 1.1, pd) * (1 - smoothstep(14, 18, r));
  d *= smoothstep(2.6, 3.6, dt) * 0.7 + 0.3 * smoothstep(1.8, 2.4, dt);
  return d * (0.55 + 0.45 * smoothstep(0.25, 0.6, fbm2(x * 0.2 + 4, z * 0.2)));
}

/** inject: extra shading for the stream bed (water.js createStream().bed). */
export function createTerrain(inject) {
  const size = 120, seg = 240;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, heightAt(x, z));
    groundColor(x, z, c);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96 });
  patchMaterial(mat, { detail: [1.6, 1.6, 1.6, 0.22], inject });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'Terrain';
  return mesh;
}

/** Trimesh collision data for the playable area (finer than needed visually). */
export function terrainColliderData(size = 44, seg = 176) {
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
  return { vertices: new Float32Array(pos.array), indices: new Uint32Array(geo.index.array) };
}
