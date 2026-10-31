import * as THREE from 'three';
import { heightAt, STREAM_SAMPLES, WATER_Y, AREAS } from './terrain.js';
import { globalUniforms } from '../core/shaders.js';
import { SUN_DIR } from './lighting.js';

// Shallow forest stream. Techniques adapted from Ultra-Water (github.com/Humpalumps/Ultra-Water, MIT):
// - caustics by area-ratio splatting (after Evan Wallace): a grid over one tile of the ripple field
//   is refracted through its slopes onto the stream bed, each landed cell adds (old area / new area),
//   so the pattern averages 1 and only redistributes sunlight,
// - sun glints as a finite number of tiny facets that twinkle,
// - depth-based absorption on the bed (Beer-Lambert) instead of a flat translucent colour.

const RIPPLE_TILE = 1.2;   // m: the ripple field (and the caustic texture) tiles every RIPPLE_TILE
const CAUSTIC_DEPTH = 0.34; // m: the bed is ~0.3 m under the surface
const CAUSTIC_RES = 256;
const CELLS = 96, MARGIN = 12; // grid cells per tile, extra cells past each edge for wrap-around
const ETA = 1 / 1.33;
// [kx, kz] whole wavenumbers per tile, amplitude (m), phase
const RIPPLES = [[2, 1, 0.010, 0.0], [-1, 3, 0.007, 1.7], [4, -2, 0.004, 4.1], [3, 5, 0.0025, 2.3], [-6, 1, 0.002, 5.2], [5, 6, 0.0012, 0.9]];
const f = (x) => x.toPrecision(7);

/** GLSL: rippleSlope(world xz, time) -> (dh/dx, dh/dz) of the stream's surface ripples. */
export const RIPPLE_GLSL = /* glsl */ `
vec2 rippleSlope(vec2 xz, float t) {
  vec2 s = vec2(0.0);
  ${RIPPLES.map(([kx, kz, a, ph]) => {
    const k = [kx, kz].map((v) => (v * 2 * Math.PI) / RIPPLE_TILE);
    const w = Math.sqrt(9.81 * Math.hypot(...k)) * 0.35; // gravity-wave dispersion, slowed for a calm stream
    return `{ vec2 k = vec2(${f(k[0])}, ${f(k[1])}); s += k * ${f(a)} * cos(dot(k, xz) - ${f(w)} * t + ${f(ph)}); }`;
  }).join('\n  ')}
  return s;
}`;

const CAUSTIC_VERT = /* glsl */ `
precision highp float;
in vec3 position; // tile units, covering [-margin, 1 + margin]
uniform float uTime;
uniform vec3 uSun;
out vec2 vOld;
${RIPPLE_GLSL}
void main() {
  vec2 t = position.xy;
  vec2 s = rippleSlope(t * ${f(RIPPLE_TILE)}, uTime);
  vec3 r = refract(-uSun, normalize(vec3(-s.x, 1.0, -s.y)), ${f(ETA)});
  vec3 rf = refract(-uSun, vec3(0.0, 1.0, 0.0), ${f(ETA)});
  // landing offset relative to flat water, so the pattern registers to the surface entry point
  vec2 d = (r.xz / max(-r.y, 0.05) - rf.xz / -rf.y) * ${f(CAUSTIC_DEPTH / RIPPLE_TILE)};
  d = clamp(d, -${f(MARGIN / CELLS)}, ${f(MARGIN / CELLS)});
  vOld = t * ${f(CAUSTIC_RES)};
  gl_Position = vec4((t + d) * 2.0 - 1.0, 0.0, 1.0);
}`;

const CAUSTIC_FRAG = /* glsl */ `
precision highp float;
in vec2 vOld;
out vec4 outColor;
void main() {
  // raster space is landed space at one texel per pixel: the ratio is the old area per pixel
  vec2 a = dFdx(vOld), b = dFdy(vOld);
  outColor = vec4(min(abs(a.x * b.y - a.y * b.x), 12.0), 0.0, 0.0, 1.0);
}`;

/** Bed shading for the terrain: caustics on direct sun, absorption with depth, a wet band on the banks. */
function bedInject(uniforms) {
  return {
    uniforms,
    head: /* glsl */ `
      uniform sampler2D uCaustics;
      uniform vec3 uSunDir;
      float streamCaustic(vec3 p, float depth) {
        vec3 rs = refract(-uSunDir, vec3(0.0, 1.0, 0.0), ${f(ETA)});
        vec2 entry = p.xz + rs.xz / rs.y * depth;
        // two lookups, rotated and scaled against each other, so the small tile doesn't read as a grid
        vec2 uv = entry / ${f(RIPPLE_TILE)};
        float a = texture2D(uCaustics, uv).r;
        float b = texture2D(uCaustics, mat2(0.7986, 0.6018, -0.6018, 0.7986) * uv * 0.71 + 0.37).r;
        float v = 1.0 + ((a + b) * 0.5 - 1.0) * 1.3;
        return mix(1.0, max(v, 0.0), smoothstep(0.0, 0.12, depth));
      }`,
    color: /* glsl */ `{
      float above = vLsWorld.y - ${f(WATER_Y)};
      float wet = 1.0 - smoothstep(0.0, 0.05 + 0.05 * lsNoise(vLsWorld * 3.0), above);
      diffuseColor.rgb *= mix(1.0, 0.6, wet * step(-0.02, above));
    }`,
    roughness: /* glsl */ `{
      float above = vLsWorld.y - ${f(WATER_Y)};
      roughnessFactor = mix(roughnessFactor, 0.35, (1.0 - smoothstep(0.0, 0.07, above)) * step(0.0, above));
    }`,
    lights: /* glsl */ `{
      float depth = ${f(WATER_Y)} - vLsWorld.y;
      if (depth > 0.0) reflectedLight.directDiffuse *= streamCaustic(vLsWorld, depth) * 1.15;
    }`,
    output: /* glsl */ `{
      float depth = ${f(WATER_Y)} - vLsWorld.y;
      if (depth > 0.0) {
        vec3 v = normalize(cameraPosition - vLsWorld);
        float path = depth * (1.0 + 1.0 / max(v.y, 0.25)); // sunlight down + view ray up
        vec3 tr = exp(-vec3(1.5, 0.6, 0.62) * path);
        outgoingLight = outgoingLight * tr + vec3(0.03, 0.07, 0.06) * (1.0 - exp(-1.2 * path));
      }
    }`,
  };
}

/**
 * The stream: water surface mesh, the caustics render target, and the terrain bed patch.
 * Call update() once per frame before rendering.
 */
export function createStream(renderer, envMap, sun) {
  // ---- caustics
  const target = new THREE.WebGLRenderTarget(CAUSTIC_RES, CAUSTIC_RES, {
    type: THREE.HalfFloatType, format: THREE.RedFormat, samples: 4, depthBuffer: false,
    minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, generateMipmaps: true,
  });
  const span = 1 + (2 * MARGIN) / CELLS;
  const grid = new THREE.PlaneGeometry(span, span, CELLS + 2 * MARGIN, CELLS + 2 * MARGIN).translate(0.5, 0.5, 0);
  const causticMat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: CAUSTIC_VERT, fragmentShader: CAUSTIC_FRAG,
    uniforms: { uTime: globalUniforms.uTime, uSun: { value: SUN_DIR } },
    side: THREE.DoubleSide, // cells folded past the focus land flipped
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    depthTest: false, depthWrite: false,
  });
  const causticMesh = new THREE.Mesh(grid, causticMat);
  causticMesh.frustumCulled = false;
  const causticScene = new THREE.Scene().add(causticMesh);
  const causticCam = new THREE.Camera();
  const clear = new THREE.Color();

  function update() {
    const prev = renderer.getRenderTarget();
    const alpha = renderer.getClearAlpha();
    renderer.getClearColor(clear);
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, false, false);
    renderer.render(causticScene, causticCam);
    renderer.setRenderTarget(prev);
    renderer.setClearColor(clear, alpha);
  }

  const bed = bedInject({ uCaustics: { value: target.texture }, uSunDir: { value: SUN_DIR } });
  const mesh = new THREE.Group();
  mesh.name = 'Water';
  const mat = waterMaterial(envMap, sun);
  for (const geo of [ribbonGeometry(), discGeometry(AREAS.lake, AREAS.lake.r + 9), discGeometry(AREAS.falls, AREAS.falls.r + 1.5)]) {
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = 2;
    m.receiveShadow = true;
    mesh.add(m);
  }
  return { mesh, bed, update, target };
}

/** Water surface: a ribbon along the stream curve with per-vertex depth to the bed (stopping where the
 * lake and the falls pool take over, so two surfaces never overlap). */
function ribbonGeometry() {
  const half = 1.75, across = 12;
  const inPool = (p, a, pad) => Math.hypot(p.x - a.x, p.z - a.z) < a.r + pad;
  const pts = STREAM_SAMPLES.filter((p) => !inPool(p, AREAS.lake, 6) && !inPool(p, AREAS.falls, 0.5));
  const n = pts.length;
  const pos = new Float32Array(n * (across + 1) * 3);
  const uv = new Float32Array(n * (across + 1) * 2);
  const depth = new Float32Array(n * (across + 1));
  let along = 0;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const q = pts[Math.min(i + 1, n - 1)];
    const o = pts[Math.max(i - 1, 0)];
    const tx = q.x - o.x, tz = q.z - o.z;
    const l = Math.hypot(tx, tz) || 1;
    const nx = -tz / l, nz = tx / l;
    if (i > 0) along += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z);
    for (let j = 0; j <= across; j++) {
      const s = 1 - (j / across) * 2; // +normal side first, so the triangles face up
      const x = p.x + nx * half * s, z = p.z + nz * half * s;
      const k = i * (across + 1) + j;
      pos.set([x, WATER_Y, z], k * 3);
      uv.set([along / 3, j / across], k * 2);
      depth[k] = WATER_Y - heightAt(x, z);
    }
  }
  const idx = [];
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < across; j++) {
      const a = i * (across + 1) + j, b = a + across + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('aDepth', new THREE.BufferAttribute(depth, 1));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** A round water surface (lake, pool) over the terrain's bowl; flow coordinates are just world xz. */
function discGeometry(c, radius) {
  const rings = 24, segs = 72;
  const pos = [], uv = [], depth = [], idx = [];
  for (let i = 0; i <= rings; i++) {
    for (let j = 0; j <= segs; j++) {
      const rr = (i / rings) * radius, a = (j / segs) * Math.PI * 2;
      const x = c.x + Math.cos(a) * rr, z = c.z + Math.sin(a) * rr;
      pos.push(x, WATER_Y, z);
      uv.push(x / 9, z / 3);
      depth.push(WATER_Y - heightAt(x, z));
      if (i < rings && j < segs) {
        const k = i * (segs + 1) + j;
        idx.push(k, k + 1, k + segs + 1, k + 1, k + segs + 2, k + segs + 1);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('aDepth', new THREE.Float32BufferAttribute(depth, 1));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function waterMaterial(envMap, sun) {
  const mat = new THREE.MeshStandardMaterial({
    color: '#0e3532', roughness: 0.18, metalness: 0.0, transparent: true,
    envMap, envMapIntensity: 0.6, depthWrite: false,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = globalUniforms.uTime;
    shader.uniforms.uSunDir = { value: SUN_DIR };
    shader.uniforms.uSunColor = { value: sun.color.clone().multiplyScalar(sun.intensity) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aDepth;\nvarying vec2 vFlow;\nvarying float vDepth;\nvarying vec3 vWorld;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvFlow = uv;\nvDepth = aDepth;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vFlow;
        varying float vDepth;
        varying vec3 vWorld;
        uniform float uTime;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float wNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(wHash(i), wHash(i + vec2(1, 0)), f.x), mix(wHash(i + vec2(0, 1)), wHash(i + vec2(1, 1)), f.x), f.y); }
        ${RIPPLE_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        // body colour only scatters a little: the bed shader does the absorption, the surface
        // mostly reflects. Thicker over deep water, clear at the edges, foam where it's shallow.
        float shallow = 1.0 - smoothstep(0.0, 0.05, vDepth);
        vec2 fl = vec2(vFlow.x * 3.0 - uTime * 0.9, vFlow.y * 5.0);
        float foam = smoothstep(0.55, 0.85, wNoise(fl * vec2(0.6, 1.2)) * 0.6 + wNoise(fl * 2.3 + 3.0) * 0.4);
        float edgeFoam = shallow * smoothstep(0.35, 0.7, wNoise(vWorld.xz * 9.0 + uTime * 0.6)) * step(0.0, vDepth);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.86, 0.82), clamp(foam * 0.18 + edgeFoam * 0.7, 0.0, 1.0));
        diffuseColor.a = mix(0.16, 0.42, smoothstep(0.05, 0.35, vDepth)) + foam * 0.12 + edgeFoam * 0.5;
        diffuseColor.a *= smoothstep(-0.01, 0.015, vDepth);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec2 p = vec2(vFlow.x * 3.0 - uTime * 0.7, vFlow.y * 4.0);
          float e = 0.05;
          float h0 = wNoise(p * 1.7) + 0.5 * wNoise(p * 4.1 + uTime * 0.3);
          float hx = wNoise((p + vec2(e, 0.0)) * 1.7) + 0.5 * wNoise((p + vec2(e, 0.0)) * 4.1 + uTime * 0.3);
          float hy = wNoise((p + vec2(0.0, e)) * 1.7) + 0.5 * wNoise((p + vec2(0.0, e)) * 4.1 + uTime * 0.3);
          // the ripples that focus the caustics, plus a rotated, larger copy so the tile doesn't
          // show as stripes in the reflections; softened with distance to keep it from aliasing
          const mat2 R = mat2(0.7986, 0.6018, -0.6018, 0.7986);
          vec2 rs = rippleSlope(vWorld.xz, uTime) * 0.6 + (transpose(R) * rippleSlope(R * vWorld.xz * 0.71 + 3.7, uTime * 0.8)) * 0.71 * 0.5;
          rs /= 1.0 + length(vViewPosition) * 0.12;
          vec3 pert = vec3(h0 - hx, 0.0, h0 - hy) * 0.6 + vec3(-rs.x, 0.0, -rs.y) * 0.9;
          normal = normalize(normal + (viewMatrix * vec4(pert, 0.0)).xyz);
        }`)
      .replace('#include <opaque_fragment>', `{
          vec3 V = normalize(vViewPosition);
          float F = 0.02 + 0.98 * pow(1.0 - clamp(dot(normal, V), 0.0, 1.0), 5.0);
          diffuseColor.a = mix(diffuseColor.a, 1.0, F * 0.85);
          // glints: per small cell one facet with a random tilt, re-drawn now and then (twinkle).
          // Only where the sun reaches: compare the sun's diffuse light here with the unshadowed value.
          vec3 L = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
          float unshadowed = diffuseColor.g * RECIPROCAL_PI * max(dot(normal, L), 0.05) * uSunColor.g;
          float sunlit = smoothstep(0.35, 0.8, reflectedLight.directDiffuse.g / max(unshadowed, 1e-5));
          float g = 0.0;
          for (int j = 0; j < 2; j++) {
            float sz = j == 0 ? 0.07 : 0.16;
            vec2 cell = floor(vWorld.xz / sz) + float(j) * 31.0;
            float tt = uTime * 1.6 + wHash(cell) * 40.0, it = floor(tt);
            vec2 jit = vec2(wHash(cell + it * 1.7), wHash(cell * 1.3 + it * 2.9)) - 0.5;
            vec3 nf = normalize(normal + (viewMatrix * vec4(jit.x * 0.4, 0.0, jit.y * 0.4, 0.0)).xyz);
            g += pow(max(dot(reflect(-V, nf), L), 0.0), 500.0) * sin(3.14159 * fract(tt));
          }
          g *= step(0.02, vDepth) * sunlit;
          outgoingLight += vec3(1.0, 0.88, 0.7) * g * 7.0;
          diffuseColor.a = max(diffuseColor.a, min(g * 4.0, 1.0));
        }
        #include <opaque_fragment>`);
  };
  return mat;
}

/**
 * Whisper Falls: a sheet of water arching off the cliff lip into the pool (scrolling streaks and foam in
 * the shader), with a churned foam ring and a soft mist where it lands.
 */
export function createWaterfall() {
  const F = AREAS.falls;
  const dir = new THREE.Vector2(F.x, F.z).normalize();
  const side = new THREE.Vector2(-dir.y, dir.x);
  const topAlong = 7.7, width = 3.4, rows = 24, cols = 8;
  const top = heightAt(F.x + dir.x * topAlong, F.z + dir.y * topAlong) + 0.05;
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= rows; i++) {
    const v = i / rows;
    const along = topAlong - 4 * Math.sqrt(v); // arcs out off the lip, clear of the cliff face below
    const y = top + (WATER_Y - top) * v;
    for (let j = 0; j <= cols; j++) {
      const u = j / cols - 0.5;
      const w = width * (1 + v * 0.35) * u; // spreads a little as it falls
      pos.push(F.x + dir.x * along + side.x * w, y, F.z + dir.y * along + side.y * w);
      uv.push(j / cols, v);
      if (i < rows && j < cols) {
        const k = i * (cols + 1) + j;
        idx.push(k, k + cols + 1, k + 1, k + 1, k + cols + 1, k + cols + 2);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  const noise = /* glsl */ `
    float fH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float fN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(fH(i), fH(i + vec2(1, 0)), f.x), mix(fH(i + vec2(0, 1)), fH(i + vec2(1, 1)), f.x), f.y); }`;
  const sheet = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    uniforms: { uTime: globalUniforms.uTime },
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */ `
      uniform float uTime; varying vec2 vUv;
      ${noise}
      void main() {
        vec2 p = vec2(vUv.x * 9.0, vUv.y * 5.0 - uTime * 2.6);
        float streak = fN(p * vec2(1.0, 0.35)) * 0.6 + fN(p * vec2(2.3, 0.8) + 7.0) * 0.4;
        float edge = smoothstep(0.0, 0.14, vUv.x) * smoothstep(1.0, 0.86, vUv.x);
        float foam = smoothstep(0.75, 1.0, vUv.y) + smoothstep(0.55, 0.85, streak) * 0.6;
        vec3 c = mix(vec3(0.42, 0.66, 0.7), vec3(0.95, 0.98, 1.0), clamp(foam + streak * 0.35, 0.0, 1.0));
        gl_FragColor = vec4(c * 1.1, edge * (0.55 + streak * 0.35 + foam * 0.3));
        #include <colorspace_fragment>
      }`,
  }));
  sheet.renderOrder = 3;

  // churned water where it lands, and mist rising off it
  const land = new THREE.Vector3(F.x + dir.x * (topAlong - 4), WATER_Y + 0.02, F.z + dir.y * (topAlong - 4));
  const foam = new THREE.Mesh(new THREE.CircleGeometry(3.2, 40).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
    uniforms: { uTime: globalUniforms.uTime },
    transparent: true, depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */ `
      uniform float uTime; varying vec2 vUv;
      ${noise}
      void main() {
        vec2 d = vUv - 0.5; float r = length(d) * 2.0;
        float a = atan(d.y, d.x);
        float n = fN(vec2(a * 4.0, r * 6.0 - uTime * 1.8)) * 0.6 + fN(vec2(a * 9.0 + 3.0, r * 11.0 - uTime * 2.4)) * 0.4;
        float alpha = smoothstep(1.0, 0.3, r) * smoothstep(0.35, 0.75, n);
        gl_FragColor = vec4(vec3(0.93, 0.97, 1.0), alpha * 0.85);
        #include <colorspace_fragment>
      }`,
  }));
  foam.position.copy(land);
  foam.renderOrder = 3;
  const mist = new THREE.Sprite(new THREE.SpriteMaterial({ color: '#e8f6ff', transparent: true, opacity: 0.35, depthWrite: false }));
  mist.material.map = softMistTexture();
  mist.position.copy(land).add({ x: 0, y: 1.2, z: 0 });
  mist.scale.set(7, 4.5, 1);
  const group = new THREE.Group();
  group.name = 'Waterfall';
  group.add(sheet, foam, mist);
  return {
    group, base: land, top: new THREE.Vector3(F.x + dir.x * topAlong, top, F.z + dir.y * topAlong),
    update(t) {
      mist.material.opacity = 0.3 + 0.06 * Math.sin(t * 1.3);
      mist.scale.set(7 + Math.sin(t * 0.7) * 0.5, 4.5 + Math.sin(t * 0.9) * 0.4, 1);
    },
  };
}

function softMistTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
