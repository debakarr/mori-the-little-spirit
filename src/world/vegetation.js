import * as THREE from 'three';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';
import { rng, fbm2, smoothstep } from '../core/noise.js';
import { patchMaterial } from '../core/shaders.js';
import { leafClusterTexture } from '../core/textures.js';
import { heightAt, grassDensity, heightGrid, GRID_N, GRID_HALF } from './terrain.js';

const LEAF_LOW = new THREE.Color('#2f5a24');
const LEAF_HIGH = new THREE.Color('#9cc24a');

function bladeGeometry(segs = 4) {
  const pos = [], aH = [], col = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const w = 0.5 * Math.pow(1 - t, 0.85) * 0.07;
    const bend = t * t * 0.22;
    if (i < segs) {
      pos.push(-w, t, bend, w, t, bend);
      aH.push(t, t);
      const c = 0.32 + 0.68 * t;
      col.push(c, c, c, c, c, c);
    } else {
      pos.push(0, 1, bend);
      aH.push(1);
      col.push(1, 1, 1);
    }
  }
  for (let i = 0; i < segs - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
  }
  const top = segs * 2;
  idx.push(top - 2, top - 1, top);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute('aH', new THREE.Float32BufferAttribute(aH, 1));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

function flowerGeometry() {
  // tiny 5-petal head on a thin stem; aH = 1 at the head so it sways with the grass tips
  const head = new THREE.CircleGeometry(0.045, 10);
  const p = head.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const a = Math.atan2(p.getY(i), p.getX(i));
    const r = Math.hypot(p.getX(i), p.getY(i));
    const k = 0.55 + 0.45 * Math.abs(Math.cos(a * 2.5));
    p.setXY(i, (p.getX(i) / (r || 1)) * r * k, (p.getY(i) / (r || 1)) * r * k);
  }
  head.rotateX(-Math.PI / 2);
  head.translate(0, 1, 0);
  const n = head.attributes.position.count;
  head.setAttribute('aH', new THREE.Float32BufferAttribute(new Array(n).fill(1), 1));
  head.setAttribute('color', new THREE.Float32BufferAttribute(new Array(n * 3).fill(1), 3));
  const stem = bladeGeometry();
  stem.scale(0.35, 1, 0.2);
  const stemCol = stem.attributes.color;
  for (let i = 0; i < stemCol.count; i++) stemCol.setXYZ(i, 0.25, 0.5, 0.18);
  head.deleteAttribute('uv');
  const merged = new THREE.BufferGeometry();
  const geos = [stem, head];
  for (const name of ['position', 'normal', 'aH', 'color']) {
    const size = geos[0].attributes[name].itemSize;
    const arr = [];
    geos.forEach((g) => arr.push(...g.attributes[name].array));
    merged.setAttribute(name, new THREE.Float32BufferAttribute(arr, size));
  }
  const idx = [...stem.index.array, ...Array.from(head.index.array, (i) => i + stem.attributes.position.count)];
  merged.setIndex(idx);
  return merged;
}

/**
 * Scatter grass blades and small wildflowers over the clearing.
 * `blockers` are {x, z, r} circles (rocks, props) kept clear of grass.
 */
export function createGrass({ count = 62000, flowers = 900, blockers = [] } = {}) {
  const r = rng(42);
  const blocked = (x, z) => blockers.some((b) => (x - b.x) ** 2 + (z - b.z) ** 2 < b.r * b.r);
  const group = new THREE.Group();
  group.name = 'Grass';

  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  patchMaterial(mat, { attrs: ['aH'], wind: 'aH * aH * 0.2', push: 'aH * aH', noFlip: true });

  const blades = new THREE.InstancedMesh(bladeGeometry(), mat, count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
  const e = new THREE.Euler();
  const greenA = new THREE.Color('#4f8a2a'), greenB = new THREE.Color('#86b23e'), dry = new THREE.Color('#b8b45a');
  let placed = 0, tries = 0;
  while (placed < count && tries < count * 6) {
    tries++;
    const x = (r() - 0.5) * 34, z = (r() - 0.5) * 34;
    const d = grassDensity(x, z);
    if (r() > d || blocked(x, z)) continue;
    const patch = fbm2(x * 0.25 + 9, z * 0.25);
    const h = (0.13 + 0.2 * smoothstep(0.3, 0.75, patch) + r() * 0.08) * (1 + smoothstep(10.5, 14, Math.hypot(x, z)) * 1.2);
    p.set(x, heightAt(x, z) - 0.02, z);
    e.set((r() - 0.5) * 0.3, r() * Math.PI * 2, (r() - 0.5) * 0.3);
    q.setFromEuler(e);
    s.set(0.8 + r() * 0.5, h, 0.8 + r() * 0.5);
    m.compose(p, q, s);
    blades.setMatrixAt(placed, m);
    c.copy(greenA).lerp(greenB, smoothstep(0.25, 0.75, patch) * 0.8 + r() * 0.2);
    c.lerp(dry, smoothstep(0.62, 0.78, fbm2(x * 0.07 + 10, z * 0.07)) * 0.5);
    blades.setColorAt(placed, c);
    placed++;
  }
  blades.count = placed;
  blades.receiveShadow = true;
  blades.frustumCulled = false;
  group.add(blades);

  const fmat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, emissive: '#1a1a12' });
  patchMaterial(fmat, { attrs: ['aH'], wind: 'aH * aH * 0.2', push: 'aH * aH', noFlip: true });
  const heads = new THREE.InstancedMesh(flowerGeometry(), fmat, flowers);
  const palette = ['#fffaf0', '#fff1a8', '#d9c6ff', '#ffd0e0', '#fffaf0'].map((h) => new THREE.Color(h));
  placed = 0; tries = 0;
  while (placed < flowers && tries < flowers * 40) {
    tries++;
    // clustered patches
    const cx = Math.round((r() - 0.5) * 6) * 3.6, cz = Math.round((r() - 0.5) * 6) * 3.6;
    const x = cx + (r() - 0.5) * 3.2, z = cz + (r() - 0.5) * 3.2;
    if (grassDensity(x, z) < 0.45 || blocked(x, z) || fbm2(cx * 0.3, cz * 0.3) < 0.45) continue;
    p.set(x, heightAt(x, z), z);
    q.setFromEuler(e.set(0, r() * 6.28, 0));
    const h = 0.17 + r() * 0.12;
    m.compose(p, q, s.set(1, h, 1));
    heads.setMatrixAt(placed, m);
    heads.setColorAt(placed, palette[Math.floor(r() * palette.length)]);
    placed++;
  }
  heads.count = placed;
  heads.frustumCulled = false;
  heads.receiveShadow = true;
  group.add(heads);
  return group;
}

/**
 * Leafy fringe: alpha-tested leaf cards scattered over canopy surfaces so the
 * Blender-built clumps get a soft, leafy silhouette. Card normals follow the
 * clump surface (blended upward) for volumetric lighting.
 */
export function createLeafFringe(canopyMeshes, density = 2.6) {
  const tex = leafClusterTexture();
  const items = [];
  const tmpPos = new THREE.Vector3(), tmpN = new THREE.Vector3(), tmpC = new THREE.Color();
  for (const mesh of canopyMeshes) {
    mesh.updateMatrixWorld(true);
    const geo = mesh.geometry;
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    const s = mesh.getWorldScale(new THREE.Vector3()).x;
    const area = 4 * Math.PI * (geo.boundingSphere.radius * s) ** 2 * 0.7;
    const n = Math.max(12, Math.round(area * density));
    const sampler = new MeshSurfaceSampler(mesh).build();
    const nm = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
    for (let i = 0; i < n; i++) {
      sampler.sample(tmpPos, tmpN, tmpC);
      const p = tmpPos.clone().applyMatrix4(mesh.matrixWorld);
      const nn = tmpN.clone().applyMatrix3(nm).normalize();
      // baked (textured) canopies have no vertex colour: tint by facing, sunlit tops lighter
      if (!geo.attributes.color) tmpC.copy(LEAF_LOW).lerp(LEAF_HIGH, THREE.MathUtils.clamp(nn.y * 0.6 + 0.45 + (Math.random() - 0.5) * 0.25, 0, 1));
      if (nn.y < -0.55) continue; // undersides stay solid and shaded
      items.push({ p, n: nn, c: tmpC.clone(), size: (0.75 + Math.random() * 0.55) * Math.min(1.4, 0.6 + s * 0.4) });
    }
  }
  const mat = new THREE.MeshStandardMaterial({
    map: tex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.85, vertexColors: false,
  });
  patchMaterial(mat, { leafNormal: true, noFlip: true, wind: 'clamp(lsW.y * 0.011, 0.0, 0.12)', flutter: 0.03, nearFade: [0.6, 1.6] });
  const geo = new THREE.PlaneGeometry(1, 1);
  const leafNormals = new Float32Array(items.length * 3);
  geo.setAttribute('aLeafNormal', new THREE.InstancedBufferAttribute(leafNormals, 3));
  const mesh = new THREE.InstancedMesh(geo, mat, items.length);
  const q = new THREE.Quaternion(), qi = new THREE.Quaternion(), m = new THREE.Matrix4(), sc = new THREE.Vector3();
  const z = new THREE.Vector3(0, 0, 1), up = new THREE.Vector3(0, 1, 0);
  items.forEach((it, i) => {
    q.setFromUnitVectors(z, it.n);
    q.multiply(qi.setFromAxisAngle(z, Math.random() * Math.PI * 2));
    q.multiply(qi.setFromAxisAngle(new THREE.Vector3(1, 0, 0), (Math.random() - 0.5) * 1.1));
    const pos = it.p.clone().addScaledVector(it.n, 0.06);
    m.compose(pos, q, sc.setScalar(it.size));
    mesh.setMatrixAt(i, m);
    const lightN = it.n.clone().lerp(up, 0.35).normalize();
    const local = lightN.applyQuaternion(q.clone().invert());
    leafNormals.set([local.x, local.y, local.z], i * 3);
    mesh.setColorAt(i, it.c.multiplyScalar(1.25));
  });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tex, alphaTest: 0.45 });
  mesh.name = 'LeafFringe';
  return mesh;
}

const FIELD = 42; // m: the grass patch that travels with Mori
const DENSITY_STEP = 1, DENSITY_N = (GRID_HALF * 2) / DENSITY_STEP + 1;

/**
 * Grass over the whole world without storing it: a fixed set of blades in a FIELD-sized tile that wraps
 * around the player in the vertex shader. Each blade reads the ground height from the terrain's height
 * grid (a half-float texture) and keeps itself only where the density texture says grass grows; blades
 * thin out toward the edge of the patch. Wind, the player's push and colour variation as before.
 * `blockers` ({x, z, r}) are painted out of the density (rocks, props).
 */
export function createGrassField({ count = 72000, blockers = [] } = {}) {
  const r = rng(42);
  const geo = new THREE.InstancedBufferGeometry().copy(bladeGeometry(3));
  geo.instanceCount = count;
  const offset = new Float32Array(count * 2), rand = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    offset.set([r() * FIELD, r() * FIELD], i * 2);
    rand.set([r() * Math.PI * 2, r(), r(), r()], i * 4);
  }
  geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offset, 2));
  geo.setAttribute('aRand', new THREE.InstancedBufferAttribute(rand, 4));

  const heights = new Uint16Array(heightGrid.length);
  for (let i = 0; i < heightGrid.length; i++) heights[i] = THREE.DataUtils.toHalfFloat(heightGrid[i]);
  const heightTex = new THREE.DataTexture(heights, GRID_N, GRID_N, THREE.RedFormat, THREE.HalfFloatType);
  heightTex.minFilter = heightTex.magFilter = THREE.LinearFilter;
  heightTex.needsUpdate = true;
  const dens = new Uint8Array(DENSITY_N * DENSITY_N);
  for (let j = 0; j < DENSITY_N; j++) {
    for (let i = 0; i < DENSITY_N; i++) {
      const x = -GRID_HALF + i * DENSITY_STEP, z = -GRID_HALF + j * DENSITY_STEP;
      const blocked = blockers.some((b) => (x - b.x) ** 2 + (z - b.z) ** 2 < b.r * b.r);
      dens[j * DENSITY_N + i] = blocked ? 0 : Math.round(grassDensity(x, z) * 255);
    }
  }
  const densTex = new THREE.DataTexture(dens, DENSITY_N, DENSITY_N, THREE.RedFormat, THREE.UnsignedByteType);
  densTex.minFilter = densTex.magFilter = THREE.LinearFilter;
  densTex.needsUpdate = true;

  const uniforms = {
    uCenter: { value: new THREE.Vector2() },
    uHeight: { value: heightTex },
    uDensity: { value: densTex },
  };
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  patchMaterial(mat, { attrs: ['aH'], wind: 'aH * aH * 0.2', push: 'aH * aH', noFlip: true });
  const patch = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    patch(shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 aOffset; attribute vec4 aRand;
        uniform vec2 uCenter; uniform sampler2D uHeight; uniform sampler2D uDensity;`)
      .replace('#include <begin_vertex>', /* glsl */ `#include <begin_vertex>
        {
          // the copy of this blade's slot nearest to the player
          vec2 p = aOffset + ${FIELD.toFixed(1)} * floor((uCenter - aOffset) / ${FIELD.toFixed(1)} + 0.5);
          vec2 uv = (p + ${GRID_HALF.toFixed(1)}) / ${(GRID_HALF * 2).toFixed(1)};
          float dens = texture2D(uDensity, uv).r;
          float edge = 1.0 - smoothstep(${(FIELD / 2 - 9).toFixed(1)}, ${(FIELD / 2 - 1).toFixed(1)}, length(p - uCenter));
          float keep = step(aRand.w, dens) * edge * step(abs(p.x), ${(GRID_HALF - 1).toFixed(1)}) * step(abs(p.y), ${(GRID_HALF - 1).toFixed(1)});
          float patchN = lsNoise(vec3(p * 0.25, 0.0));
          float hgt = (0.13 + 0.2 * smoothstep(0.3, 0.75, patchN) + aRand.y * 0.08) * (0.6 + 0.4 * dens) * keep;
          float c = cos(aRand.x), s = sin(aRand.x);
          vec3 q = transformed * vec3(0.8 + aRand.z * 0.5, hgt, 0.8 + aRand.z * 0.5);
          transformed = vec3(q.x * c + q.z * s, q.y, -q.x * s + q.z * c);
          transformed += vec3(p.x, texture2D(uHeight, uv).r - 0.02, p.y);
        }`)
      .replace('#include <color_vertex>', /* glsl */ `#include <color_vertex>
        {
          vec2 p = aOffset + ${FIELD.toFixed(1)} * floor((uCenter - aOffset) / ${FIELD.toFixed(1)} + 0.5);
          float patchN = lsNoise(vec3(p * 0.25, 0.0)), dry = lsNoise(vec3(p * 0.07 + 10.0, 1.0));
          vec3 tint = mix(vec3(0.079, 0.258, 0.023), vec3(0.235, 0.445, 0.044), smoothstep(0.25, 0.75, patchN) * 0.8 + aRand.y * 0.2);
          tint = mix(tint, vec3(0.479, 0.456, 0.102), smoothstep(0.62, 0.78, dry) * 0.5);
          vColor.rgb *= tint;
        }`);
  };
  mat.customProgramCacheKey = () => 'grass-field';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.name = 'GrassField';
  return {
    mesh,
    update(player) {
      uniforms.uCenter.value.set(player.x, player.z);
    },
  };
}
