import * as THREE from 'three';
import { rng } from '../core/noise.js';
import { patchMaterial } from '../core/shaders.js';
import { softDotTexture } from '../core/textures.js';
import { createLighting } from './lighting.js';
import {
  createTerrain, terrainColliderData, heightAt, streamDistance, TREE_POS, TREE_BASE_Y, SPAWN, WATER_Y,
} from './terrain.js';
import { createStream } from './water.js';
import { createGrass, createLeafFringe } from './vegetation.js';
import { createMaterialLibrary, prepareScene, place, collectHelpers, batchStatic } from './assetKit.js';

const BOUNDARY_RADIUS = 12.9; // ~26 m playable clearing; the bush ring sits just outside

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
  const { sun, envMap } = createLighting(scene, renderer);
  const lib = createMaterialLibrary();
  const r = rng(7);
  const blockers = [];
  const staticRoot = new THREE.Group();
  const toFace = (x, z, tx, tz) => Math.atan2(tx - x, tz - z);

  const stream = createStream(renderer, envMap, sun);
  scene.add(createTerrain(stream.bed), stream.mesh);

  // ---- ancient tree, facing the spawn point
  const tree = prepareScene(models.ancient_tree.scene, lib).getObjectByName('AncientTree');
  place(tree, staticRoot, { x: TREE_POS.x, y: TREE_BASE_Y, z: TREE_POS.z, yaw: toFace(TREE_POS.x, TREE_POS.z, SPAWN.x, SPAWN.z), fringe: true });
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

  // ---- background forest + bushes
  const kit = prepareScene(models.forest_kit.scene, lib);
  const treeA = kit.getObjectByName('tree_a'), treeB = kit.getObjectByName('tree_b');
  const bushes = ['bush_a', 'bush_b', 'bush_c'].map((n) => kit.getObjectByName(n));
  for (let i = 0; i < 120; i++) {
    const a = (i / 120) * Math.PI * 2 + r() * 0.06;
    const rad = 15.5 + r() * 22 + (i % 3) * 2;
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
    if (streamDistance(x, z) < 3.2) continue;
    place(r() < 0.55 ? treeA : treeB, staticRoot, { x, z, y: heightAt(x, z) - 0.2, yaw: r() * 6.28, scale: 0.85 + r() * 0.5 });
  }
  const bushObjects = [];
  for (let i = 0; i < 52; i++) {
    const a = (i / 52) * Math.PI * 2 + r() * 0.1;
    const rad = 12.4 + r() * 2.6;
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
    if (streamDistance(x, z) < 2.2) continue;
    bushObjects.push(place(bushes[i % 3], staticRoot, { x, z, y: heightAt(x, z) - 0.05, yaw: r() * 6.28, scale: 1.0 + r() * 0.7, fringe: true }));
  }
  for (const [x, z, s] of [[-9.9, -2.7, 1.2], [10.6, -6.4, 1.0], [-10.4, 6.9, 1.3], [6.2, 10.6, 0.9], [-7.9, -7.9, 1.1], [-3.4, -8.4, 0.9]]) {
    bushObjects.push(place(bushes[0], staticRoot, { x, z, y: heightAt(x, z) - 0.05, yaw: x * 7.1, scale: s, fringe: true }));
    blockers.push({ x, z, r: 1.2 * s });
  }

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

  // ---- helpers (colliders, lights, glows, interaction points) then batch statics
  const helpers = collectHelpers(staticRoot);
  hulls.push(...helpers.hulls);
  const fringe = createLeafFringe(helpers.canopies);
  scene.add(fringe);
  const batched = new THREE.Group();
  batched.name = 'StaticBatches';
  batchStatic(staticRoot, batched);
  scene.add(batched);

  scene.add(createGrass({ blockers }));

  // ---- lights and glow sprites from Blender empties
  const dot = softDotTexture();
  const lanternLights = [];
  for (const l of helpers.lights) {
    const cool = new THREE.Color(l.color ?? '#ffb45a').b > 0.6; // spirit (cyan) lights sit right on pale stone
    const light = new THREE.PointLight(l.color ?? '#ffb45a', (l.intensity ?? 5) * (cool ? 0.9 : 2.6), l.distance ?? 7, 2);
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

  // ---- collision: terrain, prop hulls, an invisible ring keeping Mori in the clearing
  const colliders = [{ type: 'trimesh', ...terrainColliderData() }];
  for (const h of hulls) colliders.push({ type: 'hull', points: h.points, bounce: h.bounce });
  // bushes: Mori brushes through them; the camera rises over them (FollowCamera)
  for (const b of bushObjects) colliders.push({ type: 'hull', points: meshPoints(b, 0.8), cameraOnly: true });
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    const x = Math.cos(a) * BOUNDARY_RADIUS, z = Math.sin(a) * BOUNDARY_RADIUS;
    colliders.push({ type: 'cuboid', center: new THREE.Vector3(x, heightAt(x, z) + 2, z), half: [0.4, 4, 1.4], yaw: -a, cameraIgnore: true });
  }

  const glowMats = { door: lib.LS_SpiritGlow, rune: lib.LS_Rune };
  const baseEmissive = { door: lib.LS_SpiritGlow.emissiveIntensity, rune: lib.LS_Rune.emissiveIntensity };

  function update(dt, t) {
    stream.update();
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
    sun, colliders, interactables, update, heightAt, stream,
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
