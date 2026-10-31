import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { patchMaterial } from '../core/shaders.js';

const MODEL_URL = `${import.meta.env.BASE_URL}models/`;
export const MODEL_NAMES = [
  'mori', 'fox', 'bird', 'deer', 'stag', 'glow_mushroom', 'grass_patch', 'stream_pool', 'ancient_tree', 'moss_rocks', 'lantern_post', 'fence', 'lily', 'rune_stone', 'forest_kit', 'megakit',
];

export async function loadModels(onProgress) {
  const manager = new THREE.LoadingManager();
  manager.onProgress = (_url, loaded, total) => onProgress?.(loaded / total);
  const loader = new GLTFLoader(manager);
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltfs = await Promise.all(MODEL_NAMES.map((n) => loader.loadAsync(`${MODEL_URL}${n}.glb`)));
  return Object.fromEntries(MODEL_NAMES.map((n, i) => [n, gltfs[i]]));
}

/**
 * Runtime materials for the Blender-built kit, keyed by the Blender material name.
 * Colour lives in vertex colours; these add roughness, world-space breakup, wind and glow.
 */
export function createMaterialLibrary() {
  const std = (params, patch) => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, ...params });
    m.userData.uniforms = patch ? patchMaterial(m, patch) : null;
    return m;
  };
  const lib = {
    LS_Bark: std({ roughness: 0.93 }, { detail: [3.2, 0.55, 3.2, 0.3] }),
    LS_Stone: std({ roughness: 0.88 }, { detail: [2.4, 2.4, 2.4, 0.24] }),
    LS_Moss: std({ roughness: 0.97 }, { detail: [7, 7, 7, 0.26] }),
    LS_Wood: std({ roughness: 0.82 }, { detail: [7, 0.7, 7, 0.22] }),
    LS_Canopy: std({ roughness: 0.9 }, { wind: 'clamp(lsW.y * 0.011, 0.0, 0.12)', flutter: 0.012, detail: [1.3, 1.3, 1.3, 0.2] }),
    LS_Foliage: std({ roughness: 0.8, side: THREE.DoubleSide }, { wind: '0.035', flutter: 0.008, noFlip: true }),
    LS_Iron: std({ roughness: 0.5, metalness: 0.55 }),
    // background trunks: 512px bakes read as mosaic at distance; plain bark + world-space breakup instead
    BgBark: (() => { const m = new THREE.MeshStandardMaterial({ color: '#5b4331', roughness: 0.95 }); patchMaterial(m, { detail: [4, 0.5, 4, 0.35] }); return m; })(),
    LS_LilyBell: std({ roughness: 0.5, emissive: new THREE.Color('#fff2d2'), emissiveIntensity: 0.25 }, { wind: '0.035', flutter: 0.006 }),
    LS_LanternGlass: new THREE.MeshStandardMaterial({ color: '#ffd79a', emissive: '#ffae4a', emissiveIntensity: 5.5, roughness: 0.3 }),
    LS_SpiritGlow: new THREE.MeshStandardMaterial({ color: '#c6fbff', emissive: '#7ff4ff', emissiveIntensity: 7, roughness: 0.3 }),
    LS_Rune: new THREE.MeshStandardMaterial({ color: '#b5f7ff', emissive: '#6ff2ff', emissiveIntensity: 2.2, roughness: 0.3 }),
  };
  for (const [k, m] of Object.entries(lib)) m.name = k;
  return lib;
}

// near-camera dither fade lets the camera pass through soft foliage without a wall of leaves
const WIND_CANOPY = { wind: 'clamp(lsW.y * 0.011, 0.0, 0.12)', flutter: 0.012, nearFade: [0.5, 1.5] };

/**
 * Swap vertex-coloured glTF materials for the runtime library, add wind to the baked
 * canopy materials, and flag special helper nodes.
 */
export function prepareScene(root, lib) {
  root.traverse((o) => {
    if (/^(COL_|BOUNCE_)/.test(o.name)) {
      o.visible = false;
      o.userData.collider = true;
      return;
    }
    if (o.isMesh) {
      const name = o.material?.name;
      if (lib[name]) o.material = lib[name];
      else if (/^M_Bg_tree_.*bark/.test(name)) o.material = lib.BgBark;
      else if (/Canopy|bush/i.test(name) && !o.material.userData.windPatched) {
        o.material.userData.windPatched = true;
        o.material.userData.uniforms = patchMaterial(o.material, WIND_CANOPY);
      }
      const canopy = /Canopy|bush/i.test(name);
      const small = name === 'LS_Foliage' || name === 'LS_LilyBell';
      o.castShadow = !small;
      o.receiveShadow = true;
      o.userData.canopy = canopy;
    }
  });
  return root;
}

/** Clone a (sub)node from a prepared glTF scene and drop it into `parent`. */
export function place(source, parent, { x = 0, y = 0, z = 0, yaw = 0, scale = 1, fringe = false } = {}) {
  const obj = source.clone(true);
  obj.position.set(x, y, z);
  obj.rotation.set(0, yaw, 0);
  obj.scale.setScalar(1);
  if (Array.isArray(scale)) obj.scale.set(...scale);
  else obj.scale.setScalar(scale);
  obj.userData.fringe = fringe;
  parent.add(obj);
  return obj;
}

/**
 * Walk placed objects and pull out gameplay helpers in world space:
 * convex collider point clouds, light anchors, glow anchors and interaction points.
 */
export function collectHelpers(root) {
  root.updateMatrixWorld(true);
  const out = { hulls: [], lights: [], glows: [], interact: [], canopies: [] };
  const v = new THREE.Vector3();
  root.traverse((o) => {
    const n = o.name;
    if (o.userData.collider && o.isMesh) {
      const pos = o.geometry.attributes.position;
      const pts = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        pts.set([v.x, v.y, v.z], i * 3);
      }
      out.hulls.push({ name: n, points: pts, bounce: n.startsWith('BOUNCE_') });
    } else if (n.startsWith('LIGHT_')) {
      out.lights.push({ name: n, position: o.getWorldPosition(new THREE.Vector3()), ...o.userData });
    } else if (n.startsWith('GLOW_')) {
      out.glows.push({ name: n, position: o.getWorldPosition(new THREE.Vector3()), scale: o.getWorldScale(new THREE.Vector3()).x, ...o.userData });
    } else if (n.startsWith('INTERACT_')) {
      out.interact.push({ name: n, position: o.getWorldPosition(new THREE.Vector3()), label: o.userData.label ?? 'Interact' });
    } else if (o.isMesh && o.userData.canopy) {
      let p = o;
      while (p && !p.userData.fringe) p = p.parent;
      if (p) out.canopies.push(o);
    }
  });
  return out;
}

function toFloat32(attr, size) {
  const out = new Float32Array(attr.count * size);
  for (let i = 0; i < attr.count; i++) for (let k = 0; k < size; k++) out[i * size + k] = attr.getComponent(i, k);
  return new THREE.BufferAttribute(out, size);
}

/**
 * Merge every static mesh under `root` into one mesh per material (world space),
 * turning hundreds of prop parts into a handful of draw calls.
 */
export function batchStatic(root, target) {
  root.updateMatrixWorld(true);
  const groups = new Map();
  root.traverse((o) => {
    if (!o.isMesh || !o.visible || o.userData.collider || o.userData.noBatch) return;
    let hidden = false;
    for (let p = o; p; p = p.parent) if (p.visible === false) hidden = true;
    if (hidden) return;
    const src = o.geometry;
    const g = new THREE.BufferGeometry();
    // meshopt/KHR_mesh_quantization stores positions/normals as normalized ints with the
    // dequantization scale on the node; expand to float32 before baking world matrices in,
    // or out-of-range values clamp and the mesh shatters.
    g.setAttribute('position', toFloat32(src.attributes.position, 3));
    g.setAttribute('normal', toFloat32(src.attributes.normal, 3));
    const count = src.attributes.position.count;
    const col = new Float32Array(count * 3).fill(1);
    const sc = src.attributes.color;
    if (sc) for (let i = 0; i < count; i++) col.set([sc.getX(i), sc.getY(i), sc.getZ(i)], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const uv = src.attributes.uv;
    g.setAttribute('uv', uv ? new THREE.BufferAttribute(Float32Array.from({ length: count * 2 }, (_, i) => (i & 1 ? uv.getY(i >> 1) : uv.getX(i >> 1))), 2)
      : new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    if (src.index) g.setIndex(src.index.clone());
    g.applyMatrix4(o.matrixWorld);
    if (g.index === null) g.setIndex([...Array(count).keys()]);
    const key = o.material.uuid;
    if (!groups.has(key)) groups.set(key, { material: o.material, geos: [], cast: false, receive: false });
    const grp = groups.get(key);
    grp.geos.push(g);
    grp.cast ||= o.castShadow;
    grp.receive ||= o.receiveShadow;
  });
  const meshes = [];
  for (const { material, geos, cast, receive } of groups.values()) {
    const merged = mergeGeometries(geos, false);
    merged.computeBoundingSphere();
    const m = new THREE.Mesh(merged, material);
    m.castShadow = cast;
    m.receiveShadow = receive;
    m.name = `batch_${material.name}`;
    target.add(m);
    meshes.push(m);
    geos.forEach((g) => g.dispose());
  }
  return meshes;
}
