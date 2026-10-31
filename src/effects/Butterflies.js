import * as THREE from 'three';
import { rng, noise2 } from '../core/noise.js';
import { globalUniforms } from '../core/shaders.js';

const COLORS = ['#fff4c9', '#ffd2ea', '#c9e8ff', '#ffe08a', '#d8ccff'];

/**
 * A handful of butterflies wandering over the clearing's flower patches. One that Mori comes close to
 * drifts over and circles her head for a while, then wanders home. Wings flap in the vertex shader;
 * the paths are cheap noise steering on the CPU (a few instances).
 */
export class Butterflies {
  constructor(scene, { heightAt, homes, count = 9 }) {
    this.heightAt = heightAt;
    const r = rng(5);
    this.items = [...Array(count)].map((_, i) => {
      const home = homes[i % homes.length].clone();
      return {
        home, p: home.clone().add({ x: (r() - 0.5) * 2, y: 0.6 + r() * 0.6, z: (r() - 0.5) * 2 }),
        v: new THREE.Vector3(), seed: r() * 100, follow: 0, cooldown: r() * 5,
      };
    });

    // two wings hinged on the body line (z): x = 0 at the body, |x| = 1 at the wing tip
    const g = new THREE.BufferGeometry();
    const pos = [], uv = [];
    for (const s of [-1, 1]) {
      pos.push(0, 0, -0.5, s, 0, -0.5, s, 0, 0.5, 0, 0, 0.5);
      uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6]);
    const phase = new Float32Array(count).map(() => r() * 6.28);
    g.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    const color = new Float32Array(count * 3);
    this.items.forEach((_, i) => new THREE.Color(COLORS[i % COLORS.length]).toArray(color, i * 3));
    g.setAttribute('aColor', new THREE.InstancedBufferAttribute(color, 3));

    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: globalUniforms.uTime },
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        attribute float aPhase; attribute vec3 aColor;
        uniform float uTime; varying vec2 vUv; varying vec3 vC;
        void main() {
          float a = (0.2 + 0.8 * sin(uTime * 17.0 + aPhase)) * 1.15;
          vec3 p = position;
          p = vec3(p.x * cos(a), abs(p.x) * sin(a), p.z);
          vUv = uv; vC = aColor;
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv; varying vec3 vC;
        void main() {
          // fore and hind wing lobes
          vec2 q = vUv;
          float fore = length((q - vec2(0.55, 0.32)) / vec2(0.5, 0.36));
          float hind = length((q - vec2(0.42, 0.74)) / vec2(0.38, 0.27));
          float d = min(fore, hind);
          if (d > 1.0) discard;
          vec3 c = mix(vC, vC * 0.45, smoothstep(0.55, 1.0, d));
          c += vec3(0.25) * (1.0 - smoothstep(0.0, 0.25, abs(d - 0.62)));
          gl_FragColor = vec4(c * 1.15, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.InstancedMesh(g, mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'Butterflies';
    scene.add(this.mesh);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3(0.075, 0.075, 0.075);
    this._t = new THREE.Vector3();
  }

  /** The butterfly nearest to `p` within `range`, for Mori's glances. */
  nearest(p, range = 3) {
    let best = null, bd = range;
    for (const b of this.items) {
      const d = b.p.distanceTo(p);
      if (d < bd) { bd = d; best = b.p; }
    }
    return best;
  }

  update(dt, t, player) {
    const head = this._t.copy(player).add({ x: 0, y: 0.75, z: 0 });
    this.items.forEach((b, i) => {
      b.cooldown -= dt;
      const near = b.p.distanceTo(head) < 2.4;
      if (near && b.follow <= 0 && b.cooldown <= 0) b.follow = 6 + (i % 3) * 2;
      if (b.follow > 0 && (b.follow -= dt) <= 0) b.cooldown = 10;

      // wander: noise steering around home, or a loose orbit around Mori's head
      const n = t * 0.35 + b.seed;
      const target = b.follow > 0
        ? head.clone().add({ x: Math.cos(t * 1.6 + b.seed) * 0.55, y: Math.sin(t * 2.3 + b.seed) * 0.15 + 0.1, z: Math.sin(t * 1.6 + b.seed) * 0.55 })
        : b.home.clone().add({ x: (noise2(n, 0) - 0.5) * 5, y: 0.5 + noise2(0, n) * 0.9, z: (noise2(n, 7) - 0.5) * 5 });
      const steer = target.sub(b.p).multiplyScalar(b.follow > 0 ? 2.2 : 0.8);
      b.v.lerp(steer, Math.min(1, dt * 2));
      b.v.y += Math.sin(t * 9 + b.seed) * 0.6 * dt * 10; // fluttery bob
      b.p.addScaledVector(b.v, dt);
      b.p.y = Math.max(b.p.y, this.heightAt(b.p.x, b.p.z) + 0.15);

      this._q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.atan2(b.v.x, b.v.z));
      this._m.compose(b.p, this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
