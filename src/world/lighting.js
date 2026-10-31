import * as THREE from 'three';

export const SUN_DIR = new THREE.Vector3(-0.62, 0.48, 0.62).normalize();
const ZENITH = new THREE.Color('#5d97d6');
const HORIZON = new THREE.Color('#f4d8a8');
export const FOG_COLOR = new THREE.Color('#bfc59c');
export const HEMI = { sky: new THREE.Color('#b9d3ff'), ground: new THREE.Color('#4d5a2c'), intensity: 1.25 };

/** Late-afternoon golden light: warm sun with soft shadows, sky/ground hemisphere fill, haze. */
export function createLighting(scene, renderer) {
  scene.fog = new THREE.Fog(FOG_COLOR, 20, 78);

  const hemi = new THREE.HemisphereLight(HEMI.sky, HEMI.ground, HEMI.intensity);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight('#ffd9a6', 3.2);
  sun.position.copy(SUN_DIR).multiplyScalar(40);
  sun.target.position.set(0, 0, -1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = sun.shadow.camera;
  s.left = -19; s.right = 19; s.top = 19; s.bottom = -19; s.near = 5; s.far = 90;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.035;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);

  const fill = new THREE.DirectionalLight('#9fb8ff', 0.35);
  fill.position.set(20, 12, -18);
  scene.add(fill);

  const sky = createSky();
  scene.add(sky);
  scene.add(createDistantHills());

  // Pre-filtered sky for reflections on the water.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(createSky());
  const envMap = pmrem.fromScene(envScene, 0.02).texture;
  pmrem.dispose();

  return { sun, hemi, envMap };
}

function createSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uSun: { value: SUN_DIR },
      uZenith: { value: ZENITH },
      uHorizon: { value: HORIZON },
      uFog: { value: FOG_COLOR },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      uniform vec3 uSun, uZenith, uHorizon, uFog;
      float h21(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
      float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(uHorizon, uZenith, pow(smoothstep(0.0, 0.65, h), 0.65));
        col = mix(uFog, col, smoothstep(-0.02, 0.1, h));
        // soft cumulus band
        vec2 cp = d.xz / max(h, 0.06) * 1.4;
        float cl = n2(cp * 0.6) * 0.55 + n2(cp * 1.4) * 0.3 + n2(cp * 3.2) * 0.15;
        cl = smoothstep(0.52, 0.8, cl) * smoothstep(0.02, 0.18, h) * (1.0 - smoothstep(0.4, 0.8, h));
        float s = max(dot(d, uSun), 0.0);
        col = mix(col, mix(vec3(1.0, 0.93, 0.84), uHorizon, 0.3) * (0.85 + 0.4 * pow(s, 6.0)), cl * 0.75);
        col += vec3(1.0, 0.82, 0.6) * (pow(s, 900.0) * 18.0 + pow(s, 14.0) * 0.45 + pow(s, 3.0) * 0.12);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), mat);
  mesh.name = 'Sky';
  mesh.frustumCulled = false;
  return mesh;
}

/** Two rings of hazy hills on the horizon, faded toward the sky colour. */
function createDistantHills() {
  const group = new THREE.Group();
  [
    [150, 16, '#7e9a86', 0.55],
    [210, 26, '#9fb2a8', 0.75],
  ].forEach(([radius, height, color, fade], k) => {
    const seg = 160;
    const pos = [];
    const idx = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const n = Math.sin(a * 3 + k) * 0.35 + Math.sin(a * 7.3 + 1.7 * k) * 0.25 + Math.sin(a * 17.1) * 0.12 + 0.5;
      const h = height * (0.35 + 0.65 * n);
      const x = Math.cos(a) * radius, z = Math.sin(a) * radius;
      pos.push(x, -6, z, x, h, z);
      if (i < seg) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    const c = new THREE.Color(color).lerp(FOG_COLOR, fade * 0.5);
    const mat = new THREE.MeshBasicMaterial({ color: c, fog: false, side: THREE.DoubleSide });
    group.add(new THREE.Mesh(geo, mat));
  });
  group.name = 'DistantHills';
  return group;
}
