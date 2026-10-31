import * as THREE from 'three';
import { rng } from '../core/noise.js';
import { singleLeafTexture, beamTexture } from '../core/textures.js';
import { TREE_POS } from '../world/terrain.js';
import { SUN_DIR } from '../world/lighting.js';

/** Additive soft-point particle buffer; positions/colours/sizes are driven from JS. */
class Sparkles {
  constructor(count, pixelScale) {
    this.count = count;
    this.pos = new Float32Array(count * 3);
    this.col = new Float32Array(count * 3);
    this.size = new Float32Array(count);
    this.alpha = new Float32Array(count);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.uniforms = { uScale: { value: pixelScale } };
    const m = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
        uniform float uScale; varying vec3 vC; varying float vA;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * uScale / max(-mv.z, 0.1);
          vC = aColor; vA = aAlpha;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vC; varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float a = pow(max(1.0 - d, 0.0), 2.2) * vA;
          gl_FragColor = vec4(vC * a, a);
        }`,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
  }
  flush() {
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = a.aColor.needsUpdate = a.aSize.needsUpdate = a.aAlpha.needsUpdate = true;
  }
}

/**
 * Ambient life: fireflies, glowing spores over the mushrooms, drifting pollen in the sun,
 * falling leaves from the ancient tree, Mori's tail motes and a few soft god rays.
 */
export class EnvironmentEffects {
  constructor(scene, { heightAt, mushroomCenter, pixelScale }) {
    this.heightAt = heightAt;
    this.mushroomCenter = mushroomCenter;
    const r = (this.r = rng(99));
    this.group = new THREE.Group();
    scene.add(this.group);

    this.fire = new Sparkles(70, pixelScale);
    this.fireData = [...Array(70)].map(() => ({
      home: new THREE.Vector3((r() - 0.5) * 24, 0, (r() - 0.5) * 24),
      h: 0.4 + r() * 2.2, ph: r() * 100, sp: 0.2 + r() * 0.4, warm: r() < 0.6,
    }));
    this.spores = new Sparkles(60, pixelScale);
    this.sporeData = [...Array(60)].map(() => ({ t: r() * 6, life: 4 + r() * 3, a: r() * 6.28, rad: r() * 1.4 }));
    this.pollen = new Sparkles(220, pixelScale);
    this.pollenData = [...Array(220)].map(() => ({ p: new THREE.Vector3((r() - 0.5) * 26, 0.3 + r() * 5, (r() - 0.5) * 26), ph: r() * 100 }));
    this.tail = new Sparkles(50, pixelScale);
    this.tailData = [...Array(50)].map(() => ({ p: new THREE.Vector3(0, -99, 0), v: new THREE.Vector3(), life: 0 }));
    this.tailCursor = 0;
    this.burst = new Sparkles(80, pixelScale);
    this.burstData = [...Array(80)].map(() => ({ p: new THREE.Vector3(0, -99, 0), v: new THREE.Vector3(), life: 0, max: 1, c: new THREE.Color() }));
    for (const s of [this.fire, this.spores, this.pollen, this.tail, this.burst]) this.group.add(s.points);

    this.createLeaves();
    this.createRays();
  }

  createLeaves() {
    const n = 16;
    const mat = new THREE.MeshLambertMaterial({ map: singleLeafTexture(), alphaTest: 0.4, side: THREE.DoubleSide });
    this.leaves = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.16, 0.16), mat, n);
    this.leaves.frustumCulled = false;
    this.leafData = [...Array(n)].map(() => this.spawnLeaf({}, true));
    this.group.add(this.leaves);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
  }

  spawnLeaf(d, randomHeight = false) {
    const r = this.r;
    const a = r() * Math.PI * 2, rad = 1.5 + r() * 6.5;
    d.p = new THREE.Vector3(TREE_POS.x + Math.cos(a) * rad, randomHeight ? 1 + r() * 8 : 8 + r() * 2, TREE_POS.z + Math.sin(a) * rad);
    d.spin = new THREE.Vector3(r() * 3, r() * 3, r() * 3);
    d.ph = r() * 10;
    d.rest = 0;
    return d;
  }

  createRays() {
    const tex = beamTexture();
    this.rays = [];
    const r = this.r;
    for (let i = 0; i < 5; i++) {
      const m = new THREE.MeshBasicMaterial({ map: tex, color: '#ffe2b0', transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.6 + r() * 1.2, 14), m);
      const a = r() * Math.PI * 2, rad = 2 + r() * 5;
      const base = new THREE.Vector3(TREE_POS.x + Math.cos(a) * rad, 0, TREE_POS.z + 2 + Math.sin(a) * rad);
      mesh.position.copy(base).addScaledVector(SUN_DIR, 7);
      mesh.userData = { base: mesh.position.clone(), ph: r() * 10 };
      this.rays.push(mesh);
      this.group.add(mesh);
    }
  }

  /** Burst of motes (interaction feedback). */
  emitBurst(pos, color, count = 40, speed = 1.6) {
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const d = this.burstData.find((b) => b.life <= 0) ?? this.burstData[i % this.burstData.length];
      d.p.copy(pos);
      d.v.set((Math.random() - 0.5), Math.random() * 0.8 + 0.3, (Math.random() - 0.5)).normalize().multiplyScalar(speed * (0.4 + Math.random()));
      d.life = d.max = 1.2 + Math.random() * 1.2;
      d.c.copy(c);
    }
  }

  update(dt, t, camera, player) {
    // fireflies drift on looping paths and pulse
    this.fireData.forEach((f, i) => {
      const x = f.home.x + Math.sin(t * f.sp + f.ph) * 1.6 + Math.sin(t * f.sp * 2.3 + f.ph) * 0.4;
      const z = f.home.z + Math.cos(t * f.sp * 0.8 + f.ph) * 1.6;
      const y = this.heightAt(x, z) + f.h + Math.sin(t * 0.9 + f.ph) * 0.35;
      this.fire.pos.set([x, y, z], i * 3);
      const c = f.warm ? [3.2, 2.4, 0.9] : [1.0, 2.8, 3.2];
      this.fire.col.set(c, i * 3);
      this.fire.size[i] = 0.09;
      this.fire.alpha[i] = Math.max(0, Math.sin(t * 1.7 + f.ph * 3)) ** 3;
    });
    this.fire.flush();

    // spores rise from the glowing mushrooms
    const mc = this.mushroomCenter;
    this.sporeData.forEach((s, i) => {
      s.t += dt;
      if (s.t > s.life) { s.t = 0; s.a = Math.random() * 6.28; s.rad = Math.random() * 1.4; }
      const k = s.t / s.life;
      const x = mc.x + Math.cos(s.a + k * 2) * s.rad, z = mc.z + Math.sin(s.a + k * 2) * s.rad;
      this.spores.pos.set([x, mc.y - 0.3 + k * 2.6, z], i * 3);
      this.spores.col.set([0.6, 2.2, 3.4], i * 3);
      this.spores.size[i] = 0.05;
      this.spores.alpha[i] = Math.sin(k * Math.PI);
    });
    this.spores.flush();

    // pollen motes catching the light near the camera
    this.pollenData.forEach((p, i) => {
      const x = p.p.x + Math.sin(t * 0.21 + p.ph) * 0.8, y = p.p.y + Math.sin(t * 0.33 + p.ph * 2) * 0.4;
      const z = p.p.z + Math.cos(t * 0.17 + p.ph) * 0.8;
      this.pollen.pos.set([x, this.heightAt(x, z) + y, z], i * 3);
      this.pollen.col.set([1.3, 1.15, 0.85], i * 3);
      this.pollen.size[i] = 0.025;
      this.pollen.alpha[i] = 0.35 + 0.35 * Math.sin(t * 2 + p.ph);
    });
    this.pollen.flush();

    // tail motes: emitted while Mori moves
    if (player.tail) {
      const want = 4 + player.speed * 7;
      this._acc = (this._acc ?? 0) + dt * want;
      while (this._acc > 1) {
        this._acc -= 1;
        const d = this.tailData[this.tailCursor++ % this.tailData.length];
        d.p.copy(player.tail).add({ x: (Math.random() - 0.5) * 0.12, y: (Math.random() - 0.5) * 0.12, z: (Math.random() - 0.5) * 0.12 });
        d.v.set((Math.random() - 0.5) * 0.2, 0.25 + Math.random() * 0.3, (Math.random() - 0.5) * 0.2);
        d.life = 0.9 + Math.random() * 0.6;
      }
    }
    this.tailData.forEach((d, i) => {
      d.life -= dt;
      d.p.addScaledVector(d.v, dt);
      this.tail.pos.set([d.p.x, d.p.y, d.p.z], i * 3);
      this.tail.col.set([0.8, 2.6, 3.0], i * 3);
      this.tail.size[i] = 0.035;
      this.tail.alpha[i] = Math.max(0, Math.min(1, d.life));
    });
    this.tail.flush();

    this.burstData.forEach((d, i) => {
      d.life -= dt;
      d.v.y -= dt * 0.25;
      d.v.multiplyScalar(1 - dt * 0.8);
      d.p.addScaledVector(d.v, dt);
      this.burst.pos.set([d.p.x, d.p.y, d.p.z], i * 3);
      this.burst.col.set([d.c.r * 3, d.c.g * 3, d.c.b * 3], i * 3);
      this.burst.size[i] = 0.06;
      this.burst.alpha[i] = Math.max(0, d.life / d.max);
    });
    this.burst.flush();

    // falling leaves flutter down and rest a moment on the grass
    this.leafData.forEach((d, i) => {
      const ground = this.heightAt(d.p.x, d.p.z) + 0.03;
      if (d.p.y > ground) {
        d.p.y -= dt * 0.55;
        d.p.x += Math.sin(t * 1.3 + d.ph) * dt * 0.6 + dt * 0.25;
        d.p.z += Math.cos(t * 1.1 + d.ph) * dt * 0.4;
        this._e.set(t * d.spin.x, t * d.spin.y, t * d.spin.z);
      } else {
        d.p.y = ground;
        this._e.set(-Math.PI / 2, d.ph, 0);
        if ((d.rest += dt) > 6) this.spawnLeaf(d);
      }
      this._m.compose(d.p, this._q.setFromEuler(this._e), { x: 1, y: 1, z: 1 });
      this.leaves.setMatrixAt(i, this._m);
    });
    this.leaves.instanceMatrix.needsUpdate = true;

    // god rays: cylindrical billboards along the sun direction, fading when viewed end-on
    for (const ray of this.rays) {
      ray.position.copy(ray.userData.base);
      ray.up.copy(SUN_DIR);
      ray.lookAt(camera.position.x, ray.position.y, camera.position.z);
      ray.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(ray.position, camera.position, SUN_DIR));
      const facing = 1 - Math.abs(camera.getWorldDirection(new THREE.Vector3()).dot(SUN_DIR));
      ray.material.opacity = 0.06 * facing * (0.75 + 0.25 * Math.sin(t * 0.4 + ray.userData.ph));
    }
  }
}
