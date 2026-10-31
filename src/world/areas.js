import * as THREE from 'three';
import { rng } from '../core/noise.js';
import { heightAt, AREAS, WATER_Y, TREE_POS } from './terrain.js';
import { placeKit } from './megakit.js';

const toFace = (x, z, tx, tz) => Math.atan2(tx - x, tz - z);
const ground = (x, z) => heightAt(x, z);

/**
 * The places beyond the grove, each with a dormant spirit shrine (a rune stone whose eye wakes when Mori
 * touches it in her spirit form) and spots where wisps rest:
 * Mushroom Hollow (giant glowing mushrooms with bouncy caps), Windy Overlook (a ring of standing stones on
 * the plateau), Mirror Lake (stepping stones out to a flat rock), Whisper Falls (the pool under the falls)
 * and Sunny Meadow (flowers around the shrine). Wisp spots with `snap` sit on whatever is below them
 * (resolved against the physics world in main.js).
 */
export function buildAreas({ scene, models, staticRoot, place, rune, rocks, mushSrc, capHull, waterfall }) {
  const r = rng(23);
  const hulls = [];
  const shrines = [];
  const wisps = [];
  const glowParts = []; // extra things that brighten when their area wakes: { area, material, base }
  const addWisp = (area, x, y, z, snap = false) => wisps.push({ id: `${area}-${wisps.filter((w) => w.area === area).length}`, area, p: new THREE.Vector3(x, y, z), snap });

  // a rune stone without its own helpers (the grove's stone keeps those); COL_ hulls are kept
  function stone(x, z, yaw, scale, { into = staticRoot, shrine = null } = {}) {
    const obj = rune.clone(true);
    const drop = [];
    obj.traverse((o) => { if (/^(INTERACT_|LIGHT_|GLOW_)/.test(o.name)) drop.push(o); });
    drop.forEach((o) => o.removeFromParent());
    const mat = (shrine ? new THREE.MeshStandardMaterial({ color: '#8fb5b8', emissive: '#6ff2ff', emissiveIntensity: 0.15, roughness: 0.4 }) : null);
    obj.traverse((o) => { if (o.isMesh && o.material?.name === 'LS_Rune' && mat) o.material = mat; });
    const y = ground(x, z) - 0.05 * scale;
    return { obj: place(obj, into, { x, z, y, yaw, scale }), mat }; // place() clones again: use its copy
  }

  function shrine(area, x, z, label) {
    const a = AREAS[area];
    const group = new THREE.Group();
    scene.add(group);
    const { obj, mat } = stone(x, z, toFace(x, z, TREE_POS.x, TREE_POS.z), 1.15, { into: group, shrine: true });
    // its COL_ hulls are collected here (the group isn't part of the batched statics)
    obj.updateMatrixWorld(true);
    obj.traverse((o) => {
      if (!/^COL_/.test(o.name) || !o.isMesh) return;
      o.visible = false;
      const pos = o.geometry.attributes.position, v = new THREE.Vector3(), pts = [];
      for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); pts.push(v.x, v.y, v.z); }
      hulls.push({ points: new Float32Array(pts) });
    });
    const light = new THREE.PointLight('#7ff4ff', 0, 9, 2);
    light.position.set(x, ground(x, z) + 1.6, z);
    scene.add(light);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.9, 30, 16, 1, true).translate(0, 15, 0),
      new THREE.MeshBasicMaterial({ color: '#8ff3ff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }),
    );
    beam.position.set(x, ground(x, z), z);
    scene.add(beam);
    shrines.push({
      id: area, area, name: a.name, label, mat, light, beam, awake: 0,
      position: new THREE.Vector3(x, ground(x, z) + 0.6, z),
    });
  }

  // ---- Mushroom Hollow: giant clusters around the dell, small mushrooms everywhere
  const H = AREAS.hollow;
  const mushMat = mushSrc.material;
  const giants = new THREE.Group();
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + r() * 0.4, d = 6 + r() * 7;
    const x = H.x + Math.cos(a) * d, z = H.z + Math.sin(a) * d;
    const s = 2.2 + r() * 2.4;
    const m = new THREE.Group();
    const mesh = mushSrc.clone();
    mesh.material = mushMat;
    mesh.castShadow = mesh.receiveShadow = true;
    m.add(mesh);
    m.position.set(x, ground(x, z) - 0.05 * s, z);
    m.rotation.y = r() * Math.PI * 2;
    m.scale.setScalar(s);
    giants.add(m);
    m.updateMatrixWorld(true);
    hulls.push({ name: 'BOUNCE_mushroom', points: capHull(mesh, m.position.y, s), bounce: true });
    if (i % 3 === 0) addWisp('hollow', x, m.position.y + s * 1.3, z, true);
  }
  scene.add(giants);
  const small = [];
  for (let i = 0; i < 55; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 20;
    const x = H.x + Math.cos(a) * d, z = H.z + Math.sin(a) * d;
    small.push({ model: 'Mushroom_Common', x, z, y: ground(x, z) - 0.02, yaw: r() * 6.28, scale: 0.4 + r() * 0.5 });
  }
  placeKit(models.megakit, small, scene, { castShadow: false });
  const hollowLight = new THREE.PointLight('#62c8ff', 14, 26, 1.6);
  hollowLight.position.set(H.x, ground(H.x, H.z) + 5, H.z);
  scene.add(hollowLight);
  glowParts.push({ area: 'hollow', light: hollowLight, base: 14 });
  for (let i = 0; i < 4; i++) {
    const a = r() * Math.PI * 2, d = 2 + r() * 9;
    addWisp('hollow', H.x + Math.cos(a) * d, ground(H.x + Math.cos(a) * d, H.z + Math.sin(a) * d) + 0.7, H.z + Math.sin(a) * d);
  }
  shrine('hollow', H.x + 2, H.z + 1.5, 'Awaken the hollow shrine');

  // ---- Windy Overlook: a ring of standing stones around the shrine
  const O = AREAS.overlook;
  const circleMat = new THREE.MeshStandardMaterial({ color: '#8fb5b8', emissive: '#6ff2ff', emissiveIntensity: 0.1, roughness: 0.4 });
  glowParts.push({ area: 'overlook', material: circleMat, base: 0.1, awake: 2.4 });
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const x = O.x + Math.cos(a) * 6.5, z = O.z + Math.sin(a) * 6.5;
    const { obj } = stone(x, z, toFace(x, z, O.x, O.z), 1.0 + (i % 2) * 0.25);
    obj.traverse((o) => { if (o.isMesh && o.material?.name === 'LS_Rune') o.material = circleMat; });
    if (i % 2 === 0) addWisp('overlook', x, ground(x, z) + 4, z, true);
  }
  addWisp('overlook', O.x, ground(O.x, O.z) + 7, O.z); // high over the ring: wings
  addWisp('overlook', O.x + 9, ground(O.x + 9, O.z - 4) + 0.7, O.z - 4);
  shrine('overlook', O.x, O.z, 'Awaken the overlook shrine');

  // ---- Mirror Lake: stepping stones from the near shore out to a flat rock
  const L = AREAS.lake;
  const toGrove = new THREE.Vector2(-L.x, -L.z).normalize();
  const shore = { x: L.x + toGrove.x * (L.r + 2.5), z: L.z + toGrove.y * (L.r + 2.5) };
  for (let i = 0; i < 7; i++) {
    const t = (i + 1) / 7;
    const x = shore.x + (L.x - shore.x) * t + Math.sin(i * 1.7) * 0.6, z = shore.z + (L.z - shore.z) * t + Math.cos(i * 1.3) * 0.6;
    const big = i === 6;
    place(rocks.getObjectByName('rock_flat'), staticRoot, { x, z, y: Math.max(ground(x, z), WATER_Y - 0.45) - 0.05, yaw: i * 1.9, scale: big ? [1.2, 1.1, 1.2] : [0.55, 0.9, 0.5] });
    if (i === 3 || big) addWisp('lake', x, WATER_Y + 1.2, z, true);
  }
  for (let i = 0; i < 3; i++) {
    const a = 1 + i * 1.9, d = L.r * 0.6;
    addWisp('lake', L.x + Math.cos(a) * d, WATER_Y + (i === 2 ? 7 : 0.45), L.z + Math.sin(a) * d); // low enough to reach wading
  }
  addWisp('lake', L.x - toGrove.y * (L.r + 3), ground(L.x - toGrove.y * (L.r + 3), L.z + toGrove.x * (L.r + 3)) + 0.7, L.z + toGrove.x * (L.r + 3));
  shrine('lake', shore.x + toGrove.y * 2.5, shore.z - toGrove.x * 2.5, 'Awaken the lake shrine');

  // ---- Whisper Falls: shrine beside the pool, wisps up on the lip, behind the curtain and on the banks
  const F = AREAS.falls;
  const fdir = new THREE.Vector2(F.x, F.z).normalize();
  const fside = new THREE.Vector2(-fdir.y, fdir.x);
  addWisp('falls', waterfall.top.x + fdir.x * 1.5, waterfall.top.y + 0.8, waterfall.top.z + fdir.y * 1.5, true); // on the lip: wings
  addWisp('falls', F.x + fdir.x * 5.4, WATER_Y + 2.2, F.z + fdir.y * 5.4); // behind the curtain
  for (const s of [-1, 1]) {
    const x = F.x + fside.x * s * (F.r + 2), z = F.z + fside.y * s * (F.r + 2);
    place(rocks.getObjectByName('rock_big'), staticRoot, { x, z, y: ground(x, z) - 0.2, yaw: s, scale: 0.9 });
    addWisp('falls', x, ground(x, z) + 3, z, true);
  }
  addWisp('falls', F.x - fdir.x * 14, ground(F.x - fdir.x * 14, F.z - fdir.y * 14) + 0.7, F.z - fdir.y * 14);
  addWisp('falls', waterfall.top.x - fside.x * 8, waterfall.top.y + 6, waterfall.top.z - fside.y * 8); // over the cliff
  shrine('falls', F.x - fdir.x * 3 + fside.x * (F.r + 3.5), F.z - fdir.y * 3 + fside.y * (F.r + 3.5), 'Awaken the falls shrine');

  // ---- Sunny Meadow: shrine in a ring of flowers, wisps among the blooms
  const M = AREAS.meadow;
  const ring = [];
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2, d = 2.6 + r() * 0.8;
    const x = M.x + Math.cos(a) * d, z = M.z + Math.sin(a) * d;
    ring.push({ model: 'Flower_3_Group', x, z, y: ground(x, z) - 0.02, yaw: r() * 6.28, scale: 0.26 + r() * 0.06 });
  }
  placeKit(models.megakit, ring, scene, { castShadow: false });
  for (let i = 0; i < 5; i++) {
    const a = r() * Math.PI * 2, d = 6 + r() * 12;
    const x = M.x + Math.cos(a) * d, z = M.z + Math.sin(a) * d;
    addWisp('meadow', x, ground(x, z) + 0.55, z);
  }
  const bx = M.x + 11, bz = M.z - 6;
  place(rocks.getObjectByName('rock_tall'), staticRoot, { x: bx, z: bz, y: ground(bx, bz) - 0.1, yaw: 0.4, scale: 1.6 });
  addWisp('meadow', bx, ground(bx, bz) + 5, bz, true);
  shrine('meadow', M.x, M.z, 'Awaken the meadow shrine');

  // ---- along the trails and in the grove
  for (const [x, z] of [[-26, 6.5], [-5, 31], [-24, -30], [32, 30], [33, -31], [-40, 8]]) addWisp('trails', x, ground(x, z) + 0.6, z);
  addWisp('grove', TREE_POS.x, 14, TREE_POS.z, true); // on top of the ancient tree's crown
  addWisp('grove', -8.6, 3, -4.4, true); // on the big rock
  addWisp('grove', 7.05, WATER_Y + 0.75, 1.65); // over the stepping stones

  return { hulls, shrines, wisps, glowParts, giants };
}
