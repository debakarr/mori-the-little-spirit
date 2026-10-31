import * as THREE from 'three';
import { rng, fbm2 } from '../core/noise.js';
import { patchMaterial } from '../core/shaders.js';
import { softDotTexture } from '../core/textures.js';
import { createLighting } from './lighting.js';
import {
  createTerrain, terrainColliderData, heightAt, streamDistance, pathDistance, grassDensity, TREE_POS, TREE_BASE_Y, SPAWN, WATER_Y,
  WORLD_RADIUS, AREAS,
} from './terrain.js';
import { createStream, createWaterfall } from './water.js';
import { createGrass, createGrassField, createLeafFringe } from './vegetation.js';
import { createMaterialLibrary, prepareScene, place, collectHelpers, batchStatic } from './assetKit.js';
import { placeKit, KitLOD, bakeImpostors } from './megakit.js';
import { generateForest, TREE_MODELS } from './forest.js';
import { buildAreas } from './areas.js';

const CROWN_SOLID_ABOVE = 6.4; // metres over the tree's base: the crown's collider starts above the lantern ropes

// [node, x, z, yaw, scale, grass-clear radius]
const ROCKS = [
  ['rock_big', -8.6, -4.4, 0.6, 1.35, 1.9],
  ['rock_tall', -6.9, -6.9, 2.2, 1.15, 1.0],
  ['rock_big', 9.8, -8.6, 2.0, 1.05, 1.5],
  ['rock_flat', -8.4, 5.0, 0.3, 0.9, 1.2],
  ['rock_small', 4.9, -3.4, 1.0, 1.3, 0.6],
  ['rock_small', -3.9, 9.9, 2.5, 1.0, 0.5],
  ['rock_small', 11.2, 2.4, 0.2, 1.4, 0.7],
  ['rock_tall', 4.4, 11.4, 1.1, 0.85, 0.8],
  ['rock_flat', 2.4, -10.6, 1.2, 0.75, 1.0],
  ['rock_small', -11.2, -0.8, 0.8, 1.1, 0.5],
];
const STEPPING_STONES = [[6.1, 1.4], [7.05, 1.65], [8.0, 1.45]];
// painted pool (tools/blender/prepare_stream_pool.py) on the stream's bend: its inflow faces upstream
const POOL = { x: 7.2, z: 4.7, yaw: 1.4, scale: 3.8 };
// painted grass/flower patches (tools/blender/prepare_grass_patch.py): [x, z, scale, yaw]
const GRASS_PATCHES = [[-3.6, 3.2, 2.8, 0.4], [4.2, 7.4, 2.4, 2.1], [-9.0, 2.8, 2.6, 4.2], [1.4, -8.6, 2.5, 1.0], [-4.6, -6.6, 2.2, 5.3], [9.6, -3.0, 2.0, 3.3]];
const LILY_PATCHES = [[-4.4, 5.6, 7], [3.4, 8.6, 6], [-9.6, 0.9, 5], [3.9, -2.1, 5], [-5.3, -2.4, 4], [6.0, -8.0, 5], [-2.7, -2.3, 3], [1.4, -2.6, 3], [-1.8, 11.2, 4]];
const MUSHROOMS = [[-6.5, -1.3, 1.7, 0.3], [-5.0, -0.1, 0.8, 2.2], [-7.4, -2.8, 0.6, 4.0]]; // each is a 3-mushroom cluster

export function createWorld({ scene, renderer, models }) {
  const { sun, envMap, followShadow } = createLighting(scene, renderer);
  const lib = createMaterialLibrary();
  const r = rng(7);
  const blockers = [];
  const staticRoot = new THREE.Group();
  const toFace = (x, z, tx, tz) => Math.atan2(tx - x, tz - z);

  const stream = createStream(renderer, envMap, sun);
  scene.add(createTerrain(stream.bed), stream.mesh);
  const waterfall = createWaterfall();
  scene.add(waterfall.group);

  // ---- ancient tree, facing the spawn point
  const tree = prepareScene(models.ancient_tree.scene, lib).getObjectByName('AncientTree');
  const treeObj = place(tree, staticRoot, { x: TREE_POS.x, y: TREE_BASE_Y, z: TREE_POS.z, yaw: toFace(TREE_POS.x, TREE_POS.z, SPAWN.x, SPAWN.z), fringe: true });
  const treeRoofs = [];
  treeObj.traverse((o) => { if (/^Lantern_\d+_Roof$/.test(o.name)) treeRoofs.push(o); });
  blockers.push({ x: TREE_POS.x, z: TREE_POS.z + 2.4, r: 1.0 });

  // ---- rocks + stepping stones
  const rocks = prepareScene(models.moss_rocks.scene, lib);
  for (const [name, x, z, yaw, scale, clear] of ROCKS) {
    place(rocks.getObjectByName(name), staticRoot, { x, z, y: heightAt(x, z) - 0.08 * scale, yaw, scale });
    blockers.push({ x, z, r: clear });
  }
  STEPPING_STONES.forEach(([x, z], i) => {
    place(rocks.getObjectByName('rock_flat'), staticRoot, { x, z, y: WATER_Y - 0.2, yaw: i * 1.7, scale: [0.42, 0.62, 0.38] });
  });

  // ---- props
  const post = prepareScene(models.lantern_post.scene, lib).getObjectByName('LanternPost');
  place(post, staticRoot, { x: 1.9, z: 4.1, y: heightAt(1.9, 4.1), yaw: Math.PI });
  blockers.push({ x: 1.9, z: 4.1, r: 0.35 });
  const fence = prepareScene(models.fence.scene, lib).getObjectByName('Fence');
  for (const [x, z, yaw] of [[-6.6, 9.7, -0.55], [-4.3, 10.9, -0.25]]) {
    place(fence, staticRoot, { x, z, y: heightAt(x, z) - 0.03, yaw });
    blockers.push({ x, z, r: 0.5 });
  }
  const rune = prepareScene(models.rune_stone.scene, lib).getObjectByName('RuneStone');
  place(rune, staticRoot, { x: 5.2, z: -9.8, y: heightAt(5.2, -9.8) - 0.05, yaw: toFace(5.2, -9.8, 0, 0) });
  blockers.push({ x: 5.2, z: -9.8, r: 1.5 });

  // painted water sits just under the live surface, which adds ripples, glints and reflections on top
  const pool = prepareScene(models.stream_pool.scene, lib).getObjectByName('StreamPool');
  place(pool, staticRoot, { x: POOL.x, z: POOL.z, y: WATER_Y - 0.03, yaw: POOL.yaw, scale: POOL.scale });
  blockers.push({ x: POOL.x, z: POOL.z, r: POOL.scale * 0.5 });

  const patch = prepareScene(models.grass_patch.scene, lib).getObjectByProperty('isMesh', true);
  for (const [x, z, s, yaw] of GRASS_PATCHES) {
    if (streamDistance(x, z) < 1.2 + s * 0.5) continue;
    const g = new THREE.Group();
    g.add(patch.clone());
    place(g, staticRoot, { x, z, y: heightAt(x, z) - 0.02, yaw, scale: s });
    blockers.push({ x, z, r: 0.42 * s });
  }

  const lily = prepareScene(models.lily.scene, lib).getObjectByName('Lily');
  for (const [cx, cz, n] of LILY_PATCHES) {
    for (let i = 0; i < n; i++) {
      const x = cx + (r() - 0.5) * 1.8, z = cz + (r() - 0.5) * 1.8;
      if (streamDistance(x, z) < 1.4) continue;
      place(lily, staticRoot, { x, z, y: heightAt(x, z) - 0.02, yaw: r() * 6.28, scale: 1.3 + r() * 0.6 });
    }
  }

  // ---- the Blender bush ring around the clearing (open where the trails lead out); the wider world's
  //      forest is MegaKit trees and undergrowth with distance-based detail (forest.js, megakit.js)
  const kit = prepareScene(models.forest_kit.scene, lib);
  const bushes = ['bush_a', 'bush_b', 'bush_c'].map((n) => kit.getObjectByName(n));
  const pick = (list) => list[Math.floor(r() * list.length)];
  const { trees, ground } = generateForest();
  const impostors = bakeImpostors(renderer, models.megakit, TREE_MODELS);
  const lod = new KitLOD(models.megakit, [...trees, ...ground], scene, { impostors });
  const bushObjects = [];
  for (let i = 0; i < 52; i++) {
    const a = (i / 52) * Math.PI * 2 + r() * 0.1;
    const rad = 12.4 + r() * 2.6;
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
    if (streamDistance(x, z) < 2.2 || pathDistance(x, z) < 2.4) continue;
    bushObjects.push(place(bushes[i % 3], staticRoot, { x, z, y: heightAt(x, z) - 0.05, yaw: r() * 6.28, scale: 1.0 + r() * 0.7, fringe: true }));
  }
  for (const [x, z, s] of [[-9.9, -2.7, 1.2], [10.6, -6.4, 1.0], [-10.4, 6.9, 1.3], [6.2, 10.6, 0.9], [-7.9, -7.9, 1.1], [-3.4, -8.4, 0.9]]) {
    bushObjects.push(place(bushes[0], staticRoot, { x, z, y: heightAt(x, z) - 0.05, yaw: x * 7.1, scale: s, fringe: true }));
    blockers.push({ x, z, r: 1.2 * s });
  }

  // ---- clearing dressing from the MegaKit: ferns at rock feet, flower clumps, clover, bank plants,
  //      pebbles along the water and tall tufts toward the rim. Mori brushes through all of it.
  const free = (x, z, pad = 0) => !blockers.some((b) => (x - b.x) ** 2 + (z - b.z) ** 2 < (b.r + pad) ** 2)
    && Math.hypot(x - SPAWN.x, z - SPAWN.z) > 2.2 && pathDistance(x, z) > 0.9 && Math.hypot(x, z) < 12.4;
  const dressing = [];
  const scatter = (n, tries, test, make) => {
    for (let i = 0, k = 0; i < tries && k < n; i++) {
      const x = (r() - 0.5) * 25, z = (r() - 0.5) * 25;
      if (!test(x, z)) continue;
      dressing.push({ x, z, yaw: r() * 6.28, ...make(x, z) });
      k++;
    }
  };
  for (const [, rx, rz, , , clear] of ROCKS) {
    for (let i = 0; i < 2; i++) {
      const a = r() * 6.28, d = clear + 0.25 + r() * 0.5;
      const x = rx + Math.cos(a) * d, z = rz + Math.sin(a) * d;
      if (streamDistance(x, z) > 1.6 && free(x, z)) dressing.push({ model: 'Fern_1', x, z, yaw: r() * 6.28, scale: 0.38 + r() * 0.14 });
    }
  }
  scatter(16, 600, (x, z) => grassDensity(x, z) > 0.5 && free(x, z, 0.4) && fbm2(x * 0.3, z * 0.3) > 0.5,
    () => ({ model: r() < 0.5 ? 'Flower_3_Group' : 'Flower_4_Group', scale: 0.2 + r() * 0.07 }));
  scatter(22, 600, (x, z) => grassDensity(x, z) > 0.35 && free(x, z, 0.2), () => ({ model: 'Clover_2', scale: 0.3 + r() * 0.12 }));
  scatter(12, 900, (x, z) => { const d = streamDistance(x, z); return d > 1.5 && d < 2.3 && free(x, z, 0.3); },
    () => ({ model: r() < 0.6 ? 'Plant_7_Big' : 'Plant_1', scale: 0.4 + r() * 0.15 }));
  scatter(26, 1200, (x, z) => { const d = streamDistance(x, z); return d > 0.9 && d < 1.6 && free(x, z); },
    () => ({ model: pick(['Pebble_Round_1', 'Pebble_Round_2', 'Pebble_Round_3']), scale: 0.5 + r() * 0.5 }));
  scatter(36, 1500, (x, z) => Math.hypot(x, z) > 10 && streamDistance(x, z) > 1.8 && free(x, z),
    () => ({ model: 'Grass_Wispy_Tall', scale: 0.3 + r() * 0.15 }));
  scatter(7, 900, (x, z) => Math.hypot(x - TREE_POS.x, z - TREE_POS.z) < 4.2 && free(x, z),
    () => ({ model: 'Mushroom_Common', scale: 0.35 + r() * 0.2 }));
  for (const d of dressing) {
    d.y = heightAt(d.x, d.z) - 0.02;
    if (d.model === 'Fern_1') blockers.push({ x: d.x, z: d.z, r: 0.5 * d.scale });
  }
  placeKit(models.megakit, dressing, scene, { castShadow: false });

  // ---- glow mushrooms (painted model, tools/blender/prepare_mushroom_new.py; kept unbatched so
  //      the emissive glow can pulse). Clone the node: meshopt stores dequantization on it.
  const mushSrc = models.glow_mushroom.scene.getObjectByProperty('isMesh', true);
  const mushMat = mushSrc.material;
  mushMat.emissive.set('#ffffff');
  patchMaterial(mushMat, { rim: { color: '#7fd8ff', strength: 0.2, power: 3 } });
  const mushrooms = new THREE.Group();
  const hulls = [];
  for (const [x, z, s, yaw] of MUSHROOMS) {
    const m = new THREE.Group();
    const mesh = mushSrc.clone();
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    m.add(mesh);
    m.position.set(x, heightAt(x, z) - 0.03 * s, z);
    m.rotation.y = yaw;
    m.scale.setScalar(s);
    mushrooms.add(m);
    blockers.push({ x, z, r: 0.4 * s });
    if (s > 1.5) hulls.push({ name: 'BOUNCE_mushroom', points: capHull(mesh, m.position.y, s), bounce: true });
  }
  scene.add(mushrooms);

  // ---- the places beyond the grove (areas.js): shrines, stone circle, giant mushrooms, wisp spots
  const areas = buildAreas({ scene, models, staticRoot, place, rune, rocks, mushSrc, capHull, waterfall });
  hulls.push(...areas.hulls);

  // ---- helpers (colliders, lights, glows, interaction points) then batch statics
  const helpers = collectHelpers(staticRoot);
  hulls.push(...helpers.hulls);
  const fringe = createLeafFringe(helpers.canopies);
  scene.add(fringe);
  const batched = new THREE.Group();
  batched.name = 'StaticBatches';
  batchStatic(staticRoot, batched);
  scene.add(batched);

  scene.add(createGrass({ count: 0, blockers })); // the grove's wildflowers
  const grass = createGrassField({ blockers });
  scene.add(grass.mesh);

  // ---- lights and glow sprites from Blender empties
  const dot = softDotTexture();
  const lanternLights = [];
  for (const l of helpers.lights) {
    const cool = new THREE.Color(l.color ?? '#ffb45a').b > 0.6; // spirit (cyan) lights sit right on pale stone
    const light = new THREE.PointLight(l.color ?? '#ffb45a', (l.intensity ?? 5) * (cool ? 0.9 : 1.3), l.distance ?? 7, 2);
    light.position.copy(l.position);
    light.userData.base = light.intensity;
    scene.add(light);
    lanternLights.push(light);
  }
  const mushLight = new THREE.PointLight('#62c8ff', 6, 6, 2);
  mushLight.position.set(-5.4, 2.1, 0.3); // outside the caps: inside a pale stem it blows out
  mushLight.userData.base = mushLight.intensity;
  scene.add(mushLight);

  const glows = [];
  for (const g of helpers.glows) {
    const base = new THREE.Color(g.color ?? '#ffb45a');
    const mat = new THREE.SpriteMaterial({ map: dot, color: base.clone().multiplyScalar(base.b > 0.6 ? 0.7 : 2.2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    const sp = new THREE.Sprite(mat);
    sp.position.copy(g.position);
    sp.scale.setScalar((g.size ?? 1) * (base.b > 0.6 ? 0.5 : 1.1));
    sp.userData.base = sp.scale.x;
    scene.add(sp);
    glows.push(sp);
  }

  // ---- interactions
  const pulses = { door: 0, rune: 0, mushrooms: 0 };
  const interactables = helpers.interact.map((it) => ({
    position: it.position,
    label: it.label,
    key: it.name.includes('door') ? 'door' : 'rune',
  }));
  interactables.push({ position: new THREE.Vector3(-6.0, heightAt(-6, -0.6) + 0.5, -0.6), label: 'Wake the mushrooms', key: 'mushrooms' });
  // places to sit: flat rock tops (their height comes from the physics ground, main.js) and a nook by
  // the ancient tree's roots, beside the door, looking out over the clearing
  const door = new THREE.Vector2(SPAWN.x - TREE_POS.x, SPAWN.z - TREE_POS.z).normalize();
  const nook = { x: TREE_POS.x + door.x * 2.0 + door.y * 1.3, z: TREE_POS.z + door.y * 2.0 - door.x * 1.3 };
  for (const s of [
    { x: -8.4, z: 5.0, label: 'Sit on the rock' },
    { x: 2.4, z: -10.6, label: 'Sit on the rock' },
    { x: nook.x, z: nook.z, label: 'Rest by the old tree' },
  ]) {
    interactables.push({ position: new THREE.Vector3(s.x, heightAt(s.x, s.z), s.z), label: s.label, key: 'seat', seat: true, yaw: toFace(s.x, s.z, 0, 2) });
  }
  for (const sh of areas.shrines) interactables.push({ position: sh.position, label: sh.label, key: 'shrine', shrine: sh });

  // ---- collision: terrain, prop hulls, an invisible ring at the mountains' feet
  const colliders = [{ type: 'heightfield', ...terrainColliderData() }];
  for (const h of hulls) colliders.push({ type: 'hull', points: h.points, bounce: h.bounce });
  for (const t of trees) colliders.push({ type: 'cylinder', center: new THREE.Vector3(t.x, t.y + 1.6, t.z), halfHeight: 1.6, radius: t.trunk });
  // bushes: Mori brushes through them; the camera rises over them (FollowCamera)
  for (const b of bushObjects) colliders.push({ type: 'hull', points: meshPoints(b, 0.8), cameraOnly: true });
  // the ancient tree's crown is solid above the lantern branches: the bird flies under it or lands on
  // top (inside the leaves the camera would see nothing but leaves), and the lantern roofs are perches
  for (const c of helpers.canopies) {
    if (new THREE.Box3().setFromObject(c).min.y > 2) colliders.push({ type: 'hull', points: crownPoints(c, TREE_BASE_Y + CROWN_SOLID_ABOVE) });
  }
  const perches = [];
  for (const roof of treeRoofs) {
    const top = new THREE.Box3().setFromObject(roof);
    const p = top.getCenter(new THREE.Vector3()).setY(top.max.y);
    colliders.push({ type: 'cuboid', center: p.clone().add({ x: 0, y: -0.05, z: 0 }), half: [0.2, 0.05, 0.2], yaw: 0, cameraIgnore: true });
    perches.push(p);
  }
  for (let i = 0; i < 120; i++) {
    const a = (i / 120) * Math.PI * 2;
    const x = Math.cos(a) * WORLD_RADIUS, z = Math.sin(a) * WORLD_RADIUS;
    // tall enough that the bird can't fly over (PlayerController's ceiling is lower)
    colliders.push({ type: 'cuboid', center: new THREE.Vector3(x, heightAt(x, z) + 40, z), half: [0.5, 60, 3.4], yaw: -a, cameraIgnore: true });
  }

  const glowMats = { door: lib.LS_SpiritGlow, rune: lib.LS_Rune };
  const baseEmissive = { door: lib.LS_SpiritGlow.emissiveIntensity, rune: lib.LS_Rune.emissiveIntensity };

  function update(dt, t, camera, player) {
    stream.update();
    lod.update(dt, camera.position);
    grass.update(player);
    followShadow(player);
    waterfall.update(t);
    // the hollow's giant mushrooms are heavy meshes: only drawn when Mori could see them
    for (const m of areas.giants.children) m.visible = m.position.distanceToSquared(camera.position) < 90 * 90;
    for (const sh of areas.shrines) { // awake goes 0 -> 1 when Mori wakes the shrine (Spirits.js)
      sh.mat.emissiveIntensity = 0.15 + sh.awake * (2.6 + 0.4 * Math.sin(t * 1.6));
      sh.light.intensity = sh.awake * 6;
      sh.beam.material.opacity = sh.awake * (0.07 + 0.03 * Math.sin(t * 1.1 + sh.position.x));
    }
    for (const gp of areas.glowParts) {
      const awake = areas.shrines.find((sh) => sh.area === gp.area)?.awake ?? 0;
      if (gp.light) gp.light.intensity = gp.base * (0.5 + awake * 0.8) * (0.9 + 0.1 * Math.sin(t * 1.3));
      if (gp.material) gp.material.emissiveIntensity = gp.base + awake * gp.awake;
    }
    for (const k in pulses) pulses[k] = Math.max(0, pulses[k] - dt * 0.6);
    for (const k of ['door', 'rune']) {
      glowMats[k].emissiveIntensity = baseEmissive[k] * (0.85 + 0.15 * Math.sin(t * 1.7 + (k === 'rune' ? 1 : 0))) * (1 + pulses[k] * 2.5);
    }
    mushMat.emissiveIntensity = 0.8 + 0.15 * Math.sin(t * 1.3) + pulses.mushrooms * 1.6;
    mushLight.intensity = mushLight.userData.base * (0.9 + 0.1 * Math.sin(t * 1.3)) * (1 + pulses.mushrooms * 2);
    lanternLights.forEach((l, i) => {
      const flicker = 0.92 + 0.05 * Math.sin(t * 9.1 + i * 2.3) + 0.03 * Math.sin(t * 23.7 + i);
      const isSpirit = l.color.b > l.color.r;
      l.intensity = l.userData.base * flicker * (1 + (isSpirit ? Math.max(pulses.door, pulses.rune) * 1.5 : 0));
    });
    glows.forEach((g, i) => g.scale.setScalar(g.userData.base * (0.94 + 0.06 * Math.sin(t * 2.2 + i))));
  }

  return {
    sun, colliders, interactables, update, heightAt, stream, perches, areas, waterfall,
    flowerSpots: LILY_PATCHES.map(([x, z]) => new THREE.Vector3(x, heightAt(x, z), z)),
    mushroomCenter: new THREE.Vector3(-6.3, heightAt(-6.3, -1.2) + 0.6, -1.2),
    trigger(key) { pulses[key] = 1; },
  };
}

/** World-space vertex positions of every mesh under `root`, shrunk toward its centre. */
function meshPoints(root, shrink = 1) {
  root.updateMatrixWorld(true);
  const pts = [];
  const v = new THREE.Vector3();
  const c = new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3());
  root.traverse((o) => {
    if (!o.isMesh || o.userData.collider) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i += 4) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).sub(c).multiplyScalar(shrink).add(c);
      pts.push(v.x, v.y, v.z);
    }
  });
  return new Float32Array(pts);
}

/** World-space points of a crown mesh above `minY`, pulled in a little so the hull hugs the leaves. */
function crownPoints(mesh, minY) {
  mesh.updateMatrixWorld(true);
  const pos = mesh.geometry.attributes.position;
  const c = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
  const pts = [];
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 2) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    if (v.y < minY) continue;
    v.x = c.x + (v.x - c.x) * 0.9;
    v.z = c.z + (v.z - c.z) * 0.9;
    pts.push(v.x, v.y, v.z);
  }
  return new Float32Array(pts);
}

/** World-space convex hull points of the big cap: the upper half of a mushroom cluster of scale s. */
function capHull(mesh, baseY, s) {
  mesh.updateMatrixWorld(true);
  const pos = mesh.geometry.attributes.position;
  const pts = [];
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 2) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    if (v.y - baseY > 0.58 * s) pts.push(v.x, v.y, v.z);
  }
  return new Float32Array(pts);
}
