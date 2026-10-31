import * as THREE from 'three';
import { clamp, damp, lerp, smoothstep } from '../core/noise.js';

const Y = new THREE.Vector3(0, 1, 0);

class Spring {
  constructor(stiffness = 120, damping = 12) {
    this.k = stiffness;
    this.d = damping;
    this.value = 0;
    this.vel = 0;
  }
  update(target, dt) {
    this.vel += ((target - this.value) * this.k - this.vel * this.d) * dt;
    this.value += this.vel * dt;
    return this.value;
  }
}

/**
 * Mori's bird form (mesh2motion bird clips: Idle, Walk, Flap, Glide; rig_mori_mesh2motion.py --form bird).
 * On the ground it hops (Walk scrubbed from a hop phase, plus a little vertical bounce); in the air Flap
 * and Glide blend on `s.flap`, wingbeats speed up while climbing, and the body pitches into the flight
 * direction and banks into turns on the `visual` group. Same surface as CharacterAnimator so Forms and
 * PlayerController drive either one.
 */
export class BirdAnimator {
  constructor(model, visual, clips) {
    this.model = model;
    this.visual = visual;
    this.mixer = new THREE.AnimationMixer(model);
    this.actions = {};
    for (const clip of clips) {
      const a = this.mixer.clipAction(clip);
      a.setEffectiveWeight(0);
      a.play();
      this.actions[clip.name] = a;
    }
    this.actions.Walk.timeScale = 0;
    this.bones = {};
    model.traverse((o) => { if (o.isBone) this.bones[o.name] = o; });
    this.squash = new Spring(260, 14);
    this.ears = new Spring(140, 9); // the head tuft stands in for ears (Forms pokes it)
    this.pitch = new Spring(40, 9);
    this.bank = new Spring(45, 9);
    this.hop = 0;
    this.air = 0;
    this.flap = 0;
    this.onStep = null;
    this._q = new THREE.Quaternion();
    this.look = { yaw: 0, tYaw: 0, next: 2 };
    this.lookTarget = null;
    // pitch and bank turn about the body, not the feet
    this.pivotY = 0.22;
    model.position.y = -this.pivotY;
  }

  land(impact) {
    this.squash.vel -= clamp(impact, 0, 12) * 0.28;
  }

  jump() {
    this.squash.vel += 2.6;
  }

  play() {} // no emotes on the bird: a happy flap stands in (PlayerController)

  sitNow() {} // the bird perches by landing; nothing to settle into

  get restTime() {
    return 0;
  }

  /** s: { speed, grounded, vy, yawRate, accel, flying, flap } */
  update(dt, s) {
    if (!(dt > 1e-4)) return;
    dt = Math.min(dt, 1 / 20);
    const A = this.actions;
    const flying = s.flying ? 1 : 0;
    this.air = lerp(this.air, s.grounded && !s.flying ? 0 : 1, damp(s.grounded ? 14 : 8, dt));
    const air = this.air, ground = 1 - air;
    const moving = smoothstep(0.08, 0.5, s.speed);

    // hops: Walk is scrubbed from a hop phase; each hop lifts the body a little
    const prev = this.hop;
    this.hop = (this.hop + dt * (1.6 + s.speed * 1.4) * moving * ground) % 1;
    A.Walk.time = this.hop * A.Walk.getClip().duration;
    if (this.hop < prev && moving > 0.4) this.onStep?.(0);

    this.flap = lerp(this.flap, s.flap ?? (flying ? 0 : 1), damp(6, dt));
    A.Flap.timeScale = lerp(1.0, 1.7, smoothstep(0, 3, s.vy));
    const w = {
      Idle: ground * (1 - moving),
      Walk: ground * moving,
      Flap: air * this.flap,
      Glide: air * (1 - this.flap),
    };
    for (const [n, a] of Object.entries(A)) a.setEffectiveWeight(w[n] ?? 0);
    this.mixer.update(dt);

    // head looks around while perched
    const L = this.look;
    if (this.lookTarget != null) L.tYaw = clamp(this.lookTarget, -1.1, 1.1);
    else if ((L.next -= dt) < 0) {
      L.next = 1.2 + Math.random() * 2.5;
      L.tYaw = (Math.random() - 0.5) * 1.4;
    }
    L.yaw = lerp(L.yaw, L.tYaw * ground * (1 - moving), damp(6, dt));
    const head = this.bones.head;
    if (head) head.quaternion.premultiply(this._q.setFromAxisAngle(Y, L.yaw));

    // flight attitude: lean into the flight direction, nose up when climbing, bank into turns
    const pitch = this.pitch.update(flying * (smoothstep(0.5, 6, s.speed) * 0.55 - clamp(s.vy * 0.06, -0.25, 0.3)), dt);
    const bank = this.bank.update(flying * clamp(-s.yawRate * 0.22, -0.6, 0.6), dt);
    this.visual.rotation.set(pitch, 0, bank);

    this.squash.update(0, dt);
    this.ears.update(0, dt);
    const bounce = ground * moving * Math.sin(this.hop * Math.PI) * 0.06;
    const sy = 1 + clamp(this.squash.value, -0.3, 0.25);
    const sxz = 1 / Math.sqrt(Math.max(sy, 0.5));
    this.visual.scale.set(sxz, sy, sxz);
    this.visual.position.y = this.pivotY + bounce;
  }
}
