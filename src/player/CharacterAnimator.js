import * as THREE from 'three';
import { clamp, damp, lerp, smoothstep } from '../core/noise.js';

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

/** Critically-damped-ish spring for secondary motion (ears, tail, squash). */
class Spring {
  constructor(stiffness = 120, damping = 12) {
    this.k = stiffness;
    this.d = damping;
    this.value = 0;
    this.vel = 0;
  }
  update(target, dt) {
    const a = (target - this.value) * this.k - this.vel * this.d;
    this.vel += a * dt;
    this.value += this.vel * dt;
    return this.value;
  }
}

const ONE_SHOT = ['Sit', 'Howl', 'Idle Alert'];
const SIT_AFTER = 6; // seconds standing still before Mori sits down (the sculpt's own pose)

/**
 * Plays Mori's mesh2motion fox clips (tools/blender/rig_mori_mesh2motion.py) with an AnimationMixer.
 * Walk and Run share one phase so the gait stays in step while blending; their rate follows speed.
 * Idle settles into Sit after a while; emotes (Howl, Idle Alert) play while standing still.
 * On top of the clips: lean and head turn into turns, tail lag, ear springs, and squash/stretch
 * on the `visual` group for jumps and landings.
 */
export class CharacterAnimator {
  constructor(model, visual, clips) {
    this.model = model;
    this.visual = visual;
    this.mixer = new THREE.AnimationMixer(model);
    this.actions = {};
    for (const clip of clips) {
      const a = this.mixer.clipAction(clip);
      if (ONE_SHOT.includes(clip.name)) {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
      a.setEffectiveWeight(0);
      a.play();
      this.actions[clip.name] = a;
    }
    // locomotion clips are scrubbed from a shared phase, not advanced by the mixer
    for (const n of ['Walk', 'Run']) this.actions[n].timeScale = 0;
    this.bones = {};
    model.traverse((o) => { if (o.isBone) this.bones[o.name] = o; });
    this._base = new Map(['Head', 'Hips', 'Tail_Base', 'Tail_Mid', 'Ear_L', 'Ear_R']
      .filter((n) => this.bones[n]).map((n) => [this.bones[n], this.bones[n].quaternion.clone()]));

    this._q = new THREE.Quaternion();
    this._pq = new THREE.Quaternion();
    this._axis = new THREE.Vector3();
    this._rootInv = new THREE.Quaternion();
    this.t = 0;
    this.phase = 0;
    this.air = 0;
    this.still = 0;
    this.sit = 0;
    this.emote = null;
    this.emoteBlend = 0;
    this.squash = new Spring(260, 14);
    this.ears = new Spring(140, 9);
    this.tailYaw = new Spring(60, 6);
    this.lean = new Spring(80, 11);
    this.look = { yaw: 0, tYaw: 0, next: 2 };
    this.lookTarget = null; // head yaw (radians, model space) toward a nearby point of interest
    this.onStep = null;
    this._lastStepSign = 1;
  }

  /** Landing impact (m/s downward) -> squash. */
  land(impact) {
    this.squash.vel -= clamp(impact, 0, 14) * 0.32;
    this.ears.vel += clamp(impact, 0, 14) * 0.9;
  }

  jump() {
    this.squash.vel += 2.2;
    this.ears.vel -= 3;
  }

  /** Sit down right away (resting on a rock or by the tree) instead of after a wait. */
  sitNow() {
    this.emote = null;
    this.still = SIT_AFTER + 0.01;
    this.actions.Sit?.reset().play();
  }

  /** Seconds Mori has been sitting still (drives the sleepy motes in main.js). */
  get restTime() {
    return Math.max(0, this.still - SIT_AFTER);
  }

  /** One-shot clip while standing still (e.g. 'Howl'); moving cancels it. */
  play(name) {
    const a = this.actions[name];
    if (!a) return;
    a.reset().play();
    this.emote = name;
    this.still = 0;
  }

  /** Rotate a bone about a model-space axis, after the mixer has posed it. */
  rot(name, axis, angle) {
    const b = this.bones[name];
    if (!b || angle === 0) return;
    b.parent.getWorldQuaternion(this._pq).premultiply(this._rootInv);
    this._axis.copy(axis).applyQuaternion(this._pq.invert());
    b.quaternion.premultiply(this._q.setFromAxisAngle(this._axis, angle));
  }

  /**
   * s: { speed, runBlend, grounded, vy, yawRate, accel }
   */
  update(dt, s) {
    if (!(dt > 1e-4)) return;
    dt = Math.min(dt, 1 / 20);
    const t = (this.t += dt);
    const A = this.actions;

    const moving = smoothstep(0.08, 0.6, s.speed);
    const run = s.runBlend;
    this.air = lerp(this.air, s.grounded ? 0 : 1, damp(s.grounded ? 18 : 9, dt));
    const air = this.air, ground = 1 - air;

    // ---- gait: one phase for Walk and Run, cadence rises with speed (Mori is tiny and quick)
    const cadence = lerp(1.25 + s.speed * 0.5, 1.6 + s.speed * 0.42, run);
    this.phase = (this.phase + dt * cadence * (0.3 + 0.7 * ground)) % 1;
    A.Walk.time = this.phase * A.Walk.getClip().duration;
    A.Run.time = this.phase * A.Run.getClip().duration;
    const stepSign = Math.sign(Math.sin(this.phase * Math.PI * 4));
    if (stepSign !== this._lastStepSign && moving > 0.4 && ground > 0.9) this.onStep?.(run);
    this._lastStepSign = stepSign;

    // ---- standing still: idle, then sit down; emotes play on request
    const idle = (1 - moving) * ground;
    this.still = idle > 0.95 && !this.emote ? this.still + dt : 0;
    if (this.still > SIT_AFTER && this.sit < 0.01) A.Sit.reset().play();
    const sitting = this.still > SIT_AFTER;
    this.sit = lerp(this.sit, sitting ? 1 : 0, damp(sitting ? 2.5 : 9, dt));
    if (this.emote) {
      const a = A[this.emote];
      if (moving > 0.3 || air > 0.5 || a.time >= a.getClip().duration - 0.05) this.emote = null;
    }
    this.emoteBlend = lerp(this.emoteBlend, this.emote ? 1 : 0, damp(7, dt));

    const w = {
      Idle: idle * (1 - this.sit) * (1 - this.emoteBlend),
      Sit: idle * this.sit * (1 - this.emoteBlend),
      Walk: moving * (1 - run) * ground,
      Run: moving * run * ground,
      Fall: air,
    };
    for (const n of ['Howl', 'Idle Alert']) w[n] = n === this.emote || (this.emoteBlend > 0.01 && A[n].isRunning()) ? idle * this.emoteBlend : 0;
    const sum = Object.values(w).reduce((a, b) => a + b, 0) || 1;
    for (const [n, a] of Object.entries(A)) a.setEffectiveWeight((w[n] ?? 0) / sum);
    // the mixer only writes a bone when its animated value changes (e.g. not while Sit is held),
    // so put back the clip pose before re-applying the procedural layer, or it would accumulate
    for (const [b, q] of this._base) b.quaternion.copy(q);
    this.mixer.update(dt);
    for (const [b, q] of this._base) q.copy(b.quaternion);

    // ---- procedural layer on top of the clips
    this.model.updateMatrixWorld(true);
    this._rootInv.copy(this.model.getWorldQuaternion(this._q)).invert();

    const L = this.look;
    if (this.lookTarget != null) L.tYaw = clamp(this.lookTarget, -0.9, 0.9); // something interesting nearby
    else if ((L.next -= dt) < 0) {
      L.next = 1.8 + Math.random() * 3.5;
      L.tYaw = (Math.random() - 0.5) * 0.9;
    }
    const glance = this.lookTarget != null ? Math.max(idle, 0.6) : idle; // looks over even while walking past
    L.yaw = lerp(L.yaw, L.tYaw * glance * (1 - this.emoteBlend), damp(3, dt));
    this.rot('Head', Y, L.yaw + clamp(s.yawRate * 0.07, -0.35, 0.35));

    const lean = this.lean.update(clamp(-s.yawRate * s.speed * 0.045, -0.3, 0.3) * ground, dt);
    this.rot('Hips', Z, lean);
    this.rot('Head', Z, -lean * 0.5);
    this.rot('Hips', X, clamp(s.accel * 0.01, -0.08, 0.08) * ground);

    const tail = this.tailYaw.update(-clamp(s.yawRate * 0.12, -0.5, 0.5), dt);
    const sway = Math.sin(t * 0.8) * 0.12 * idle; // the tail drifts lazily while she rests
    this.rot('Tail_Base', Y, tail + sway);
    this.rot('Tail_Mid', Y, tail * 0.6);

    const ear = this.ears.update(air * (s.vy > 0 ? -0.2 : 0.25), dt);
    this.rot('Ear_L', X, -ear);
    this.rot('Ear_R', X, -ear);

    // ---- squash/stretch for jumps and landings
    this.squash.update(0, dt);
    const stretch = clamp(s.vy * 0.025, -0.08, 0.12) * air;
    const breathe = Math.sin(t * 2.3) * 0.012 * idle; // a slow breath while still
    const sy = 1 + clamp(this.squash.value, -0.32, 0.25) + stretch + breathe;
    const sxz = 1 / Math.sqrt(Math.max(sy, 0.5));
    this.visual.scale.set(sxz, sy, sxz);
  }
}
