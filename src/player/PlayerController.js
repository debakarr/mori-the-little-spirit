import * as THREE from 'three';
import { clamp, damp, smoothstep } from '../core/noise.js';

const GRAVITY = 16;
const BOUNCE = 9.5;
const RADIUS = 0.22;
const HALF = 0.15;
const MAX_FLY_Y = 15; // over the ancient tree's crown (12.8 m), below the top of the boundary walls

function dampAngle(a, b, k) {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * k;
}

/**
 * Camera-relative third-person movement on a Rapier kinematic character controller:
 * smoothed acceleration, soft turning, buffered/coyote jumps with variable height,
 * landing detection and bouncy mushroom caps. Walk/run speed and jump come from the current form
 * (`mori.stats`, Forms.js); input pauses while a form change plays.
 * The bird's jump is a takeoff into flight: Space climbs, release glides, C/Ctrl dives, Shift flies
 * faster, and touching any surface (ground, rock, branch pad) lands and perches.
 */
export class PlayerController {
  constructor({ physics, input, mori, spawn, facing = Math.PI, events = {} }) {
    this.physics = physics;
    this.input = input;
    this.mori = mori;
    this.events = events;
    this.spawn = spawn.clone();
    this.position = spawn.clone();
    this.velocity = new THREE.Vector3();
    this.vy = 0;
    this.yaw = facing;
    this.yawRate = 0;
    this.grounded = true;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.speed = 0;
    this.runBlend = 0;
    this.flying = false;
    this.flap = 0;
    this.char = physics.createCharacter({ radius: RADIUS, halfHeight: HALF, position: spawn });
    this._desired = new THREE.Vector3();
    this._wish = new THREE.Vector3();
    this._prevSpeed = 0;
  }

  get center() {
    return new THREE.Vector3(this.position.x, this.position.y + HALF + RADIUS, this.position.z);
  }

  update(dt, cameraYaw) {
    if (!(dt > 1e-4)) return; // first frame can report dt = 0 (rates would become NaN)
    dt = Math.min(dt, 1 / 20);
    const { input } = this;
    const { walk, run, jump, fly } = this.mori.stats;
    const busy = this.mori.busy;
    if (!fly) this.flying = false; // a form change mid-air drops Mori back onto gravity and her feet
    else if (!this.grounded && !this.flying && busy) this.flying = true; // became the bird mid-jump
    const mv = busy ? { x: 0, y: 0 } : input.move;
    const fx = -Math.sin(cameraYaw), fz = -Math.cos(cameraYaw);
    const rx = Math.cos(cameraYaw), rz = -Math.sin(cameraYaw);
    const wish = this._wish.set(fx * mv.y + rx * mv.x, 0, fz * mv.y + rz * mv.x);
    if (wish.lengthSq() > 1) wish.normalize();
    const wishLen = wish.length();
    const running = input.run && wishLen > 0.1;
    const target = wish.clone().multiplyScalar(this.flying ? (running ? fly.fast : fly.cruise) : running ? run : walk);

    // flight is floaty: slow to build speed, slower still to lose it (Mori keeps gliding forward)
    const rate = this.flying ? (wishLen > 0.01 ? 2.2 : 0.8) : this.grounded ? (wishLen > 0.01 ? 9 : 11) : 2.6;
    const k = damp(rate, dt);
    this.velocity.x += (target.x - this.velocity.x) * k;
    this.velocity.z += (target.z - this.velocity.z) * k;

    const prevYaw = this.yaw;
    if (wishLen > 0.05) this.yaw = dampAngle(this.yaw, Math.atan2(wish.x, wish.z), damp(this.flying ? 3.5 : this.grounded ? 11 : 5, dt));
    const dy = Math.atan2(Math.sin(this.yaw - prevYaw), Math.cos(this.yaw - prevYaw));
    this.yawRate += (dy / dt - this.yawRate) * damp(10, dt);

    const jumped = input.consumeJump() && !busy;
    if (this.flying) {
      // Space held climbs with quick wingbeats (a tap is one strong beat), C / Ctrl dives,
      // otherwise Mori glides on outstretched wings, sinking slowly
      let climb = -0.9, flap = 0;
      if (busy) { climb = 0; flap = 1; }
      else if (input.jumpHeld) { climb = 3.2; flap = 1; }
      else if (input.has('KeyC', 'ControlLeft', 'ControlRight')) climb = -4.6;
      if (jumped) this.vy = Math.max(this.vy, 0) + 2.2;
      const room = MAX_FLY_Y - this.position.y; // soft ceiling over the grove
      if (room < 2) climb = Math.min(climb, room * 1.2 - 0.4);
      this.vy += (climb - this.vy) * damp(input.jumpHeld ? 4 : 2.2, dt);
      this.flap = flap;
      if (jumped) { this.mori.animator.jump(); this.events.onFlap?.(); }
    } else {
      // jumping: input buffer + coyote time, shorter hop when Space is released early
      if (jumped) this.jumpBuffer = 0.15;
      this.jumpBuffer -= dt;
      this.coyote -= dt;
      if (this.jumpBuffer > 0 && (this.grounded || this.coyote > 0)) {
        this.vy = jump;
        this.grounded = false;
        this.coyote = 0;
        this.jumpBuffer = 0;
        if (fly) this.flying = true; // the bird's jump is a takeoff
        this.mori.animator.jump();
        this.events.onJump?.();
      } else if (fly && jumped && !this.grounded) {
        this.flying = true; // stepped off a ledge as the bird: open the wings
        this.vy = Math.max(this.vy, 2.5);
        this.events.onFlap?.();
      }
      let g = GRAVITY;
      if (this.vy > 0 && !input.jumpHeld) g *= 2.2;
      else if (this.vy < 0) g *= 1.25;
      this.vy = Math.max(this.vy - g * dt, -18);
    }

    const desired = this._desired.set(this.velocity.x * dt, this.vy * dt, this.velocity.z * dt);
    const { controller, collider, body } = this.char;
    controller.computeColliderMovement(collider, desired, undefined, undefined, this.physics.walkable);
    const move = controller.computedMovement();
    const wasGrounded = this.grounded;
    const vyBefore = this.vy;
    this.grounded = controller.computedGrounded();


    this.position.x += move.x;
    this.position.y += move.y;
    this.position.z += move.z;
    // stop pushing into walls so velocity doesn't build up against them
    if (Math.abs(move.x) < Math.abs(desired.x) * 0.5) this.velocity.x = move.x / dt;
    if (Math.abs(move.z) < Math.abs(desired.z) * 0.5) this.velocity.z = move.z / dt;

    // landing on a bouncy cap (checked with a short ray under the feet)
    let bounced = false;
    if (this.grounded && !wasGrounded && vyBefore < -1.5) {
      this.physics.groundBelow(this.position.x, this.position.y + 0.2, this.position.z, 0.5);
      bounced = this.physics.lastGroundBouncy;
    }
    if (bounced) {
      this.vy = BOUNCE;
      this.grounded = false;
      this.mori.animator.land(4);
      this.events.onBounce?.();
    } else if (this.grounded && this.flying && vyBefore > 0) {
      this.grounded = false; // just took off: still touching the ground this frame
    } else if (this.grounded) {
      if (this.flying) { // touchdown: fold the wings (a gentle glide lands soft)
        this.flying = false;
        this.mori.animator.land(Math.max(-vyBefore, 1.5));
        this.events.onLand?.(-vyBefore);
      } else if (!wasGrounded && vyBefore < -0.5) {
        this.mori.animator.land(-vyBefore);
        this.events.onLand?.(-vyBefore);
      }
      this.vy = -1.0;
      this.coyote = 0.12;
    } else if (this.vy > 0 && move.y < desired.y * 0.4) {
      this.vy = 0; // bonked a ceiling
    }

    if (this.position.y < -6) this.respawn();
    body.setNextKinematicTranslation(this.center);

    const hSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    const accel = (hSpeed - this._prevSpeed) / dt;
    this._prevSpeed = hSpeed;
    this.speed = hSpeed;
    this.runBlend += (smoothstep(walk, run, hSpeed) - this.runBlend) * damp(6, dt);

    const { object, animator } = this.mori;
    object.position.copy(this.position);
    object.rotation.y = this.yaw;
    this.mori.airborne = this.flying || !this.grounded;
    animator.update(dt, {
      speed: hSpeed, runBlend: this.runBlend, grounded: this.grounded, vy: this.vy,
      yawRate: clamp(this.yawRate, -8, 8), accel, flying: this.flying, flap: this.flap,
    });
  }

  respawn() {
    this.teleport(this.spawn);
  }

  /** Put Mori somewhere directly (spawn, a loaded save), standing still. */
  teleport(position, yaw = this.yaw) {
    this.position.copy(position);
    this.velocity.set(0, 0, 0);
    this.vy = 0;
    this.yaw = yaw;
    this.flying = false;
    this.char.body.setTranslation(this.center, true);
  }
}
