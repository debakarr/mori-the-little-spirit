import * as THREE from 'three';
import { patchMaterial } from '../core/shaders.js';

/**
 * Quaternius' Stylized Nature MegaKit (CC0), packed by tools/blender/prepare_megakit.py: one node per
 * model, origin at its base. Models are drawn as InstancedMeshes (one per model and material), so a
 * forest of them costs a few dozen draw calls.
 */

// kit material name (minus MK_) -> how it sways; heights are in the model's own metres (`transformed`)
const KIT = {
  Bark_NormalTree: { detail: [3.2, 0.55, 3.2, 0.25] },
  Bark_TwistedTree: { detail: [3.2, 0.55, 3.2, 0.25] },
  Leaves_NormalTree: { card: true, shadow: true, wind: 'clamp(transformed.y * 0.012, 0.0, 0.11)', flutter: 0.012 },
  // white leaf mask (prepare_megakit.py), tinted a cooler green than the common trees
  Leaves_TwistedTree: { card: true, shadow: true, color: '#4f8436', wind: 'clamp(transformed.y * 0.012, 0.0, 0.11)', flutter: 0.012 },
  Leaves_Pine: { card: true, shadow: true, wind: 'clamp(transformed.y * 0.01, 0.0, 0.09)', flutter: 0.006 },
  Leaves: { card: true, wind: 'clamp(transformed.y * 0.06, 0.0, 0.08)', flutter: 0.01, push: 'clamp(transformed.y * 1.2, 0.0, 1.0)' },
  Flowers: { card: true, wind: 'clamp(transformed.y * 0.06, 0.0, 0.08)', flutter: 0.01, push: 'clamp(transformed.y * 1.2, 0.0, 1.0)' },
  Grass: { card: true, wind: 'clamp(transformed.y * 0.12, 0.0, 0.14)', push: 'clamp(transformed.y * 1.5, 0.0, 1.0)' },
  Mushrooms: {},
  Rocks: { shadow: true, detail: [2.4, 2.4, 2.4, 0.18] },
  PathRocks: { detail: [2.4, 2.4, 2.4, 0.18] },
};

function kitMaterial(src) {
  const name = src.name.replace(/^MK_/, '');
  const o = KIT[name] ?? {};
  const m = new THREE.MeshStandardMaterial({
    name,
    map: src.map,
    color: o.color ?? '#ffffff',
    vertexColors: true, // the kit's soft AO ramp (dark roots, lighter tips)
    roughness: 1,
    alphaTest: o.card ? 0.5 : 0,
    side: o.card ? THREE.DoubleSide : THREE.FrontSide,
  });
  patchMaterial(m, {
    wind: o.wind, flutter: o.flutter, push: o.push, detail: o.detail,
    noFlip: o.card, nearFade: o.card ? [0.5, 1.4] : undefined,
  });
  m.userData.castShadow = !!o.shadow || !o.card;
  return m;
}

/**
 * Build instanced meshes for `placements` ([{ model, x, y, z, yaw, scale }]) and add them to `parent`.
 * Small plants skip shadow casting (their cards would speckle the ground at shadow-map resolution).
 */
export function placeKit(gltf, placements, parent, { castShadow = true } = {}) {
  const materials = new Map();
  const byModel = new Map();
  for (const p of placements) {
    if (!byModel.has(p.model)) byModel.set(p.model, []);
    byModel.get(p.model).push(p);
  }
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), pos = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const meshes = [];
  for (const [model, list] of byModel) {
    const root = gltf.scene.getObjectByName(model);
    if (!root) throw new Error(`MegaKit model ${model} missing from megakit.glb`);
    root.updateMatrixWorld(true);
    root.traverse((part) => {
      if (!part.isMesh) return;
      if (!materials.has(part.material.name)) materials.set(part.material.name, kitMaterial(part.material));
      const material = materials.get(part.material.name);
      const geometry = part.geometry.clone().applyMatrix4(part.matrixWorld);
      if (!geometry.attributes.color) { // rocks, pebbles, mushrooms carry no AO ramp; read as white, not black
        geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count * 3).fill(1), 3));
      }
      const inst = new THREE.InstancedMesh(geometry, material, list.length);
      list.forEach((p, i) => {
        q.setFromAxisAngle(up, p.yaw ?? 0);
        s.setScalar(p.scale ?? 1);
        m.compose(pos.set(p.x, p.y, p.z), q, s);
        inst.setMatrixAt(i, m);
      });
      inst.computeBoundingSphere();
      inst.castShadow = castShadow && material.userData.castShadow;
      inst.receiveShadow = true;
      inst.name = `kit_${model}_${material.name}`;
      parent.add(inst);
      meshes.push(inst);
    });
  }
  return meshes;
}
