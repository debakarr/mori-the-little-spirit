import * as THREE from 'three';
import { patchMaterial, globalUniforms } from '../core/shaders.js';

/**
 * Quaternius' Stylized Nature MegaKit (CC0), packed by tools/blender/prepare_megakit.py: one node per
 * model, origin at its base. Models are drawn as InstancedMeshes (one per model and material).
 * placeKit: a fixed set (the grove's dressing). KitLOD: the whole world's forest, where only what is near
 * the camera is drawn as real geometry; trees further out become baked billboards (impostors).
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

const materials = new Map(); // shared by every placement, so all trees of a kind are one program
function kitMaterial(src) {
  const name = src.name.replace(/^MK_/, '');
  if (materials.has(name)) return materials.get(name);
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
  materials.set(name, m);
  return m;
}

/** The model's meshes as [geometry in model space, kit material] pairs. */
function modelParts(gltf, model) {
  const root = gltf.scene.getObjectByName(model);
  if (!root) throw new Error(`MegaKit model ${model} missing from megakit.glb`);
  root.updateMatrixWorld(true);
  const parts = [];
  root.traverse((part) => {
    if (!part.isMesh) return;
    const geometry = part.geometry.clone().applyMatrix4(part.matrixWorld);
    if (!geometry.attributes.color) { // rocks, pebbles, mushrooms carry no AO ramp; read as white, not black
      geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count * 3).fill(1), 3));
    }
    geometry.computeBoundingBox();
    parts.push([geometry, kitMaterial(part.material)]);
  });
  return parts;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
function compose(p) {
  _q.setFromAxisAngle(UP, p.yaw ?? 0);
  _s.setScalar(p.scale ?? 1);
  return _m.compose(_p.set(p.x, p.y, p.z), _q, _s);
}

function groupByModel(placements) {
  const byModel = new Map();
  for (const p of placements) {
    if (!byModel.has(p.model)) byModel.set(p.model, []);
    byModel.get(p.model).push(p);
  }
  return byModel;
}

/**
 * Build instanced meshes for `placements` ([{ model, x, y, z, yaw, scale }]) and add them to `parent`.
 * Small plants skip shadow casting (their cards would speckle the ground at shadow-map resolution).
 */
export function placeKit(gltf, placements, parent, { castShadow = true } = {}) {
  const meshes = [];
  for (const [model, list] of groupByModel(placements)) {
    for (const [geometry, material] of modelParts(gltf, model)) {
      const inst = new THREE.InstancedMesh(geometry, material, list.length);
      list.forEach((p, i) => inst.setMatrixAt(i, compose(p)));
      inst.computeBoundingSphere();
      inst.castShadow = castShadow && material.userData.castShadow;
      inst.receiveShadow = true;
      inst.name = `kit_${model}_${material.name}`;
      parent.add(inst);
      meshes.push(inst);
    }
  }
  return meshes;
}

// ---------------------------------------------------------------- impostors
const SLOT_W = 256, SLOT_H = 512, ATLAS_COLS = 8;

/**
 * Render each model once, from the side, into an atlas with the game's own materials and a light rig
 * matching the scene's average (sky fill plus a soft sun from the front): far trees then cost two triangles.
 */
export function bakeImpostors(renderer, gltf, models) {
  const rows = Math.ceil(models.length / ATLAS_COLS);
  const target = new THREE.WebGLRenderTarget(SLOT_W * ATLAS_COLS, SLOT_H * rows, { samples: 4 });
  target.texture.generateMipmaps = true;
  target.texture.minFilter = THREE.LinearMipmapLinearFilter;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#b9d3ff', '#4d5a2c', 1.5));
  const sun = new THREE.DirectionalLight('#ffd9a6', 2.2);
  sun.position.set(0.4, 0.8, 1);
  scene.add(sun);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  const slots = {};
  const prev = { target: renderer.getRenderTarget(), color: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha() };
  renderer.setRenderTarget(target);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  models.forEach((model, k) => {
    const group = new THREE.Group();
    const box = new THREE.Box3();
    for (const [geometry, material] of modelParts(gltf, model)) {
      group.add(new THREE.Mesh(geometry, material));
      box.union(geometry.boundingBox);
    }
    scene.add(group);
    const w = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 1.02, h = (box.max.y - box.min.y) * 1.02;
    const scale = Math.max(w / (SLOT_W / SLOT_H), h); // fit the slot's 1:2 aspect
    const cx = (box.min.x + box.max.x) / 2;
    cam.left = cx - (scale * SLOT_W / SLOT_H) / 2; cam.right = cx + (scale * SLOT_W / SLOT_H) / 2;
    cam.bottom = box.min.y; cam.top = box.min.y + scale;
    cam.position.set(0, 0, 50);
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();
    const col = k % ATLAS_COLS, row = Math.floor(k / ATLAS_COLS);
    renderer.setViewport(col * SLOT_W, row * SLOT_H, SLOT_W, SLOT_H);
    renderer.setScissor(col * SLOT_W, row * SLOT_H, SLOT_W, SLOT_H);
    renderer.setScissorTest(true);
    renderer.render(scene, cam);
    scene.remove(group);
    slots[model] = {
      index: k, uv: [col / ATLAS_COLS, row / rows, 1 / ATLAS_COLS, 1 / rows],
      width: scale * SLOT_W / SLOT_H, height: scale, bottom: box.min.y, centerX: cx,
    };
  });
  renderer.setScissorTest(false);
  renderer.setRenderTarget(prev.target);
  renderer.setClearColor(prev.color, prev.alpha);
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  renderer.setViewport(0, 0, size.x / renderer.getPixelRatio(), size.y / renderer.getPixelRatio());
  return { texture: target.texture, slots };
}

function makeImpostorMaterial(texture) {
  const m = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uAtlas: { value: null } }]),
    fog: true,
    vertexShader: IMPOSTOR_VS,
    fragmentShader: IMPOSTOR_FS,
  });
  m.uniforms.uAtlas.value = texture;
  m.uniforms.uTime = globalUniforms.uTime;
  return m;
}

const IMPOSTOR_VS = /* glsl */ `
  attribute vec4 aUv;   // atlas rect: x, y, w, h
  attribute vec4 aDims; // width, height, bottom, flip (+1/-1)
  uniform float uTime;
  varying vec2 vUv;
  #include <fog_pars_vertex>
  void main() {
    vec3 base = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    float s = length(instanceMatrix[0].xyz);
    // cylindrical billboard: turn about the vertical to face the camera
    vec3 toCam = cameraPosition - base; toCam.y = 0.0;
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), normalize(toCam + vec3(1e-4, 0.0, 0.0))));
    float sway = sin(uTime * 0.9 + base.x * 0.3 + base.z * 0.2) * 0.03 * position.y;
    vec3 p = base + right * (position.x + sway) * aDims.x * s + vec3(0.0, (position.y * aDims.y + aDims.z) * s, 0.0);
    vUv = vec2(aUv.x + (aDims.w > 0.0 ? uv.x : 1.0 - uv.x) * aUv.z, aUv.y + uv.y * aUv.w);
    vec4 mvPosition = viewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
const IMPOSTOR_FS = /* glsl */ `
  uniform sampler2D uAtlas;
  varying vec2 vUv;
  #include <fog_pars_fragment>
  void main() {
    vec4 c = texture2D(uAtlas, vUv);
    if (c.a < 0.5) discard;
    gl_FragColor = vec4(c.rgb / max(c.a, 1e-3), 1.0);
    #include <fog_fragment>
  }`;

/**
 * The world's forest and undergrowth with distance-based detail. Each placement may carry `near` (metres
 * within which it is real geometry, default 60) and `far` (beyond `near` it becomes an impostor until
 * `far`; omit to simply hide it). update(camera position) re-sorts every ~0.25 s or 4 m of movement.
 */
export class KitLOD {
  constructor(gltf, placements, parent, { impostors = null } = {}) {
    this.items = placements;
    this.models = new Map();
    for (const [model, list] of groupByModel(placements)) {
      const meshes = modelParts(gltf, model).map(([geometry, material]) => {
        const inst = new THREE.InstancedMesh(geometry, material, list.length);
        inst.count = 0;
        inst.castShadow = material.userData.castShadow && !/^(Bush|Plant|Fern)/.test(model); // undergrowth shadows barely read
        inst.receiveShadow = true;
        inst.frustumCulled = false;
        inst.name = `lod_${model}_${material.name}`;
        parent.add(inst);
        return inst;
      });
      this.models.set(model, meshes);
    }
    this.impostors = null;
    const far = placements.filter((p) => p.far && impostors?.slots[p.model]);
    if (far.length) {
      const g = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
      g.setAttribute('aUv', new THREE.InstancedBufferAttribute(new Float32Array(placements.length * 4), 4));
      g.setAttribute('aDims', new THREE.InstancedBufferAttribute(new Float32Array(placements.length * 4), 4));
      const mesh = new THREE.InstancedMesh(g, makeImpostorMaterial(impostors.texture), placements.length);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.name = 'lod_impostors';
      parent.add(mesh);
      this.impostors = { mesh, slots: impostors.slots };
    }
    this._last = new THREE.Vector3(1e9, 0, 0);
    this._timer = 0;
  }

  update(dt, cameraPos) {
    this._timer -= dt;
    if (this._timer > 0 && this._last.distanceToSquared(cameraPos) < 16) return;
    this._timer = 0.25;
    this._last.copy(cameraPos);
    const counts = new Map();
    let ni = 0;
    const imp = this.impostors;
    for (const p of this.items) {
      const d2 = (p.x - cameraPos.x) ** 2 + (p.z - cameraPos.z) ** 2;
      const near = p.near ?? 60;
      if (d2 < near * near) {
        const m = compose(p);
        const meshes = this.models.get(p.model);
        const k = counts.get(p.model) ?? 0;
        for (const inst of meshes) inst.setMatrixAt(k, m);
        counts.set(p.model, k + 1);
      } else if (imp && p.far && d2 < p.far * p.far) {
        const slot = imp.slots[p.model];
        if (!slot) continue;
        imp.mesh.setMatrixAt(ni, compose(p));
        imp.mesh.geometry.attributes.aUv.array.set(slot.uv, ni * 4);
        imp.mesh.geometry.attributes.aDims.array.set([slot.width, slot.height, slot.bottom, (p.yaw ?? 0) > Math.PI ? -1 : 1], ni * 4);
        ni++;
      }
    }
    for (const [model, meshes] of this.models) {
      const n = counts.get(model) ?? 0;
      for (const inst of meshes) {
        inst.count = n;
        inst.instanceMatrix.needsUpdate = true;
      }
    }
    if (imp) {
      imp.mesh.count = ni;
      imp.mesh.instanceMatrix.needsUpdate = true;
      imp.mesh.geometry.attributes.aUv.needsUpdate = true;
      imp.mesh.geometry.attributes.aDims.needsUpdate = true;
    }
  }
}
