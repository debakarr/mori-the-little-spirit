import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { rng, damp, clamp, smoothstep } from '../core/noise.js';
import { globalUniforms } from '../core/shaders.js';
import { toonMaterial, addOutline } from '../player/toonMaterial.js';
import { AREAS, WATER_Y, WORLD_RADIUS } from './terrain.js';

const FLEE_SPEED = 3.6;  // Mori moving faster than this nearby startles the deer
const CALM_RADIUS = 2.4; // close enough to greet
const DEER = { deer: { scale: 0.3, walk: 0.9, run: 6.5 }, stag: { scale: 0.36, walk: 0.85, run: 6.0 } };
// [home x, z, count of does]: each herd also has a stag
const HERDS = [
  [AREAS.meadow.x + 8, AREAS.meadow.z + 6, 3],
  [AREAS.lake.x - 20, AREAS.lake.z - 4, 2],
  [AREAS.overlook.x + 22, AREAS.overlook.z + 8, 2],
  [AREAS.hollow.x + 4, AREAS.hollow.z - 26, 2],
];

/**
 * Life in the valley beyond Mori: deer herds (Quaternius' CC0 animated deer and stag, cel shaded like
 * Mori) that graze, look up, wander and drink, let a slow, quiet Mori come close and be greeted (E), and
 * gallop away from anything running at them; flocks of little birds wheeling over the forest that fall in
 * beside Mori when she flies with them; and fish in the lake and the falls pool that dart from her feet.
 */
export class Wildlife {
  constructor(scene, { models, heightAt }) {
    this.heightAt = heightAt;
    this.r = rng(77);
    this.deer = [];
    const toon = new Map();
    const prep = (gltf) => {
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        if (!toon.has(o.material)) {
          const m = o.material.clone();
          m.emissive?.set('#000000');
          toonMaterial(m, { rimColor: '#ffe9c4', rimStrength: 0.12 });
          toon.set(o.material, m);
        }
        o.material = toon.get(o.material);
      });
    };
    prep(models.deer);
    prep(models.stag);
    HERDS.forEach(([hx, hz, does], h) => {
      for (let i = 0; i <= does; i++) this.spawnDeer(scene, i === 0 ? 'stag' : 'deer', i === 0 ? models.stag : models.deer, hx, hz, h);
    });
    this.birds = new Flocks(scene, heightAt);
    this.fish = new Fish(scene);
    this.greeted = new Set();
  }

  spawnDeer(scene, kind, gltf, hx, hz, herd) {
    const r = this.r;
    const object = cloneSkinned(gltf.scene);
    const s = DEER[kind].scale * (0.9 + r() * 0.2);
    object.scale.setScalar(s);
    object.traverse((o) => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; }
    });
    const skinned = [];
    object.traverse((o) => { if (o.isSkinnedMesh) skinned.push(o); });
    for (const m of skinned) addOutline(m, { width: 0.002 });
    const x = hx + (r() - 0.5) * 8, z = hz + (r() - 0.5) * 8;
    object.position.set(x, this.heightAt(x, z), z);
    scene.add(object);
    const mixer = new THREE.AnimationMixer(object);
    const actions = Object.fromEntries(gltf.animations.map((c) => [c.name, mixer.clipAction(c)]));
    const d = {
      kind, object, mixer, actions, herd, home: new THREE.Vector2(hx, hz), yaw: r() * Math.PI * 2,
      state: 'graze', timer: 2 + r() * 6, target: new THREE.Vector2(x, z), speed: 0, current: null,
      label: kind === 'stag' ? 'Greet the stag' : 'Greet the deer', calm: 0,
    };
    object.rotation.y = d.yaw;
    this.play(d, 'Eating', 0);
    this.deer.push(d);
  }

  play(d, name, fade = 0.4) {
    const next = d.actions[name] ?? d.actions.Idle;
    if (d.current === next) return;
    next.reset().setEffectiveWeight(1).play();
    if (d.current) d.current.crossFadeTo(next, fade, false);
    d.current = next;
  }

  /** The deer Mori could greet right now (calm and close), if any. */
  nearestGreetable(p) {
    let best = null, bd = CALM_RADIUS;
    for (const d of this.deer) {
      if (d.state === 'flee') continue;
      const dist = Math.hypot(d.object.position.x - p.x, d.object.position.z - p.z);
      if (dist < bd) { bd = dist; best = d; }
    }
    return best && { position: best.object.position.clone().add({ x: 0, y: 1.0 * best.object.scale.x * 3, z: 0 }), label: best.label, key: 'greet', deer: best, d: bd };
  }

  /** Mori greets a deer: it turns to her, lifts its head and stays a while. */
  greet(d, p) {
    d.state = 'greet';
    d.timer = 4;
    d.yaw = Math.atan2(p.x - d.object.position.x, p.z - d.object.position.z);
    this.play(d, 'Idle_2', 0.3);
    const first = !this.greeted.has(d.kind);
    this.greeted.add(d.kind);
    return first;
  }

  /** The nearest deer or bird within range, for Mori's glances. */
  nearestInteresting(p, range = 6) {
    let best = null, bd = range;
    for (const d of this.deer) {
      const dist = d.object.position.distanceTo(p);
      if (dist < bd) { bd = dist; best = d.object.position; }
    }
    return best;
  }

  update(dt, t, player, { speed, flying, camera }) {
    const r = this.r;
    for (const d of this.deer) {
      const o = d.object;
      const dx = player.x - o.position.x, dz = player.z - o.position.z;
      const dist = Math.hypot(dx, dz);
      const far = o.position.distanceToSquared(camera.position) > 110 * 110;
      o.visible = !far;
      // startled by anything rushing at them (or swooping low); a slow, quiet Mori is welcome
      const startle = dist < 9 && (speed > FLEE_SPEED || (flying && player.y - o.position.y < 3 && dist < 5));
      if (startle && d.state !== 'flee') {
        d.state = 'flee';
        d.timer = 3 + r() * 2;
        const away = Math.atan2(-dx, -dz) + (r() - 0.5) * 0.8;
        d.target.set(o.position.x + Math.sin(away) * 22, o.position.z + Math.cos(away) * 22);
        for (const other of this.deer) { // the herd follows the first to bolt
          if (other !== d && other.herd === d.herd && other.state !== 'flee') {
            other.state = 'flee';
            other.timer = d.timer + r();
            other.target.set(d.target.x + (r() - 0.5) * 6, d.target.y + (r() - 0.5) * 6);
          }
        }
      }
      d.timer -= dt;
      let moveSpeed = 0;
      if (d.state === 'flee') {
        moveSpeed = DEER[d.kind].run;
        this.play(d, 'Gallop', 0.25);
        if (d.timer <= 0) { d.state = 'idle'; d.timer = 2 + r() * 3; d.home.set(o.position.x, o.position.z); }
      } else if (d.state === 'greet') {
        this.play(d, d.timer > 2 ? 'Idle_2' : 'Idle', 0.4);
        if (d.timer <= 0) { d.state = 'graze'; d.timer = 4 + r() * 4; }
      } else if (d.state === 'walk') {
        moveSpeed = DEER[d.kind].walk;
        this.play(d, 'Walk');
        if (Math.hypot(d.target.x - o.position.x, d.target.y - o.position.z) < 0.8 || d.timer <= 0) {
          d.state = r() < 0.6 ? 'graze' : 'idle';
          d.timer = 3 + r() * 6;
        }
      } else {
        // grazing or standing: a calm Mori nearby makes them look up and watch her
        const watching = dist < 6 && speed < FLEE_SPEED;
        this.play(d, watching ? 'Idle' : d.state === 'graze' ? (Math.sin(t * 0.3 + d.herd) > 0 ? 'Eating' : 'Idle_Headlow') : 'Idle', 0.5);
        if (watching) d.yaw = lerpAngle(d.yaw, Math.atan2(dx, dz), damp(1.5, dt));
        if (d.timer <= 0 && !watching) {
          d.state = 'walk';
          d.timer = 12;
          for (let k = 0; k < 8; k++) { // somewhere near home that isn't water
            const a = r() * Math.PI * 2, rad = 3 + r() * 9;
            const tx = d.home.x + Math.cos(a) * rad, tz = d.home.y + Math.sin(a) * rad;
            if (this.heightAt(tx, tz) > WATER_Y + 0.15 && Math.hypot(tx, tz) < WORLD_RADIUS - 6) { d.target.set(tx, tz); break; }
          }
        }
      }
      if (moveSpeed > 0) {
        const want = Math.atan2(d.target.x - o.position.x, d.target.y - o.position.z);
        d.yaw = lerpAngle(d.yaw, want, damp(d.state === 'flee' ? 6 : 2.5, dt));
        d.speed += (moveSpeed - d.speed) * damp(3, dt);
      } else {
        d.speed += (0 - d.speed) * damp(5, dt);
      }
      const nx = o.position.x + Math.sin(d.yaw) * d.speed * dt, nz = o.position.z + Math.cos(d.yaw) * d.speed * dt;
      if (this.heightAt(nx, nz) > WATER_Y + 0.05 && Math.hypot(nx, nz) < WORLD_RADIUS - 3) o.position.set(nx, o.position.y, nz);
      else if (d.state === 'flee' || d.state === 'walk') d.timer = 0; // blocked by water or the edge
      o.position.y += (this.heightAt(o.position.x, o.position.z) - o.position.y) * damp(12, dt);
      o.rotation.y = d.yaw;
      if (!far) d.mixer.update(dt * (d.current?.getClip().name === 'Gallop' ? clamp(d.speed / 5, 0.6, 1.3) : 1));
    }
    this.birds.update(dt, t, player, flying);
    this.fish.update(dt, t, player);
  }
}

function lerpAngle(a, b, k) {
  return a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;
}

// ---------------------------------------------------------------- birds
const FLOCKS = [[10, -30, 22], [-40, 30, 26], [40, 10, 30]];

/** Little dark birds wheeling over the canopy in loose flocks (two-triangle wings flapping in the shader). */
class Flocks {
  constructor(scene, heightAt) {
    const r = rng(31);
    this.heightAt = heightAt;
    this.flocks = FLOCKS.map(([x, z, h]) => ({ center: new THREE.Vector3(x, h, z), home: new THREE.Vector3(x, h, z), phase: r() * 6, join: 0 }));
    this.birds = [];
    this.flocks.forEach((f, k) => {
      for (let i = 0; i < 9; i++) this.birds.push({ flock: k, p: f.center.clone().add({ x: (r() - 0.5) * 8, y: (r() - 0.5) * 3, z: (r() - 0.5) * 8 }), v: new THREE.Vector3(r() - 0.5, 0, r() - 0.5), seed: r() * 100 });
    });
    const g = new THREE.BufferGeometry();
    // body point plus two wings (x = -1 / +1 tips), flapped around the body axis in the vertex shader
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.12, -1, 0, -0.05, 0, 0, -0.12, 0, 0, 0.12, 0, 0, -0.12, 1, 0, -0.05], 3));
    const flap = new Float32Array(this.birds.length).map(() => r() * 6.28);
    g.setAttribute('aPhase', new THREE.InstancedBufferAttribute(flap, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: globalUniforms.uTime },
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        attribute float aPhase; uniform float uTime;
        void main() {
          vec3 p = position;
          float a = sin(uTime * 14.0 + aPhase) * 0.9;
          p.y = abs(p.x) * sin(a) * 0.8; p.x *= 0.18 * cos(a) + 0.04;
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(p * 1.0, 1.0);
        }`,
      fragmentShader: 'void main() { gl_FragColor = vec4(0.08, 0.07, 0.1, 1.0); }',
    });
    this.mesh = new THREE.InstancedMesh(g, mat, this.birds.length);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'Flocks';
    scene.add(this.mesh);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3(1.4, 1.4, 1.4);
  }

  update(dt, t, player, flying) {
    for (const f of this.flocks) {
      // a flock drifts on a slow loop around its home, or falls in beside a flying Mori
      const near = flying && f.center.distanceTo(player) < 14;
      f.join = clamp(f.join + (near ? dt : -dt * 0.3), 0, 1);
      const loop = f.home.clone().add({ x: Math.cos(t * 0.08 + f.phase) * 14, y: Math.sin(t * 0.13 + f.phase) * 3, z: Math.sin(t * 0.08 + f.phase) * 14 });
      const target = loop.lerp(player.clone().add({ x: 0, y: 1.5, z: 0 }), smoothstep(0, 1, f.join));
      f.center.lerp(target, damp(f.join > 0.2 ? 1.2 : 0.5, dt));
    }
    this.birds.forEach((b, i) => {
      const f = this.flocks[b.flock];
      const n = t * 0.6 + b.seed;
      const want = f.center.clone().add({ x: Math.sin(n) * 4, y: Math.sin(n * 1.3) * 1.5, z: Math.cos(n * 0.9) * 4 }).sub(b.p);
      b.v.lerp(want.multiplyScalar(0.9), damp(1.6, dt));
      if (b.v.lengthSq() < 4) b.v.setLength(2);
      b.p.addScaledVector(b.v, dt);
      b.p.y = Math.max(b.p.y, this.heightAt(b.p.x, b.p.z) + 4);
      this._q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), b.v.clone().normalize());
      this._m.compose(b.p, this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- fish
/** Small silvery fish circling in the lake and the falls pool, scattering from Mori's feet. */
class Fish {
  constructor(scene) {
    const r = rng(53);
    this.fish = [];
    for (const [a, n] of [[AREAS.lake, 16], [AREAS.falls, 6]]) {
      for (let i = 0; i < n; i++) {
        this.fish.push({ c: new THREE.Vector2(a.x, a.z), rad: 1.5 + r() * (a.r - 3), ang: r() * 6.28, speed: (0.25 + r() * 0.3) * (r() < 0.5 ? 1 : -1), dart: 0, depth: 0.22 + r() * 0.15, seed: r() * 10 });
      }
    }
    const g = new THREE.ConeGeometry(0.035, 0.22, 5).rotateX(Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: '#9fb6c2', roughness: 0.35, metalness: 0.4 });
    this.mesh = new THREE.InstancedMesh(g, mat, this.fish.length);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'Fish';
    scene.add(this.mesh);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
  }

  update(dt, t, player) {
    this.fish.forEach((f, i) => {
      const px = f.c.x + Math.cos(f.ang) * f.rad, pz = f.c.y + Math.sin(f.ang) * f.rad;
      if (Math.hypot(player.x - px, player.z - pz) < 1.6 && player.y < WATER_Y + 0.6) f.dart = 1.2; // startled
      f.dart = Math.max(0, f.dart - dt);
      f.ang += f.speed * (1 + f.dart * 5) * dt / Math.max(f.rad, 1);
      const x = f.c.x + Math.cos(f.ang) * f.rad, z = f.c.y + Math.sin(f.ang) * f.rad;
      const wiggle = Math.sin(t * 9 + f.seed) * 0.25;
      this._q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, -f.ang + (f.speed > 0 ? Math.PI : 0) + wiggle);
      this._m.compose(this._p.set(x, WATER_Y - f.depth, z), this._q, new THREE.Vector3(1, 1, 1));
      this.mesh.setMatrixAt(i, this._m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
