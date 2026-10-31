import * as THREE from 'three';
import { clamp, damp, smoothstep } from '../core/noise.js';

const PIVOT_HEIGHT = 0.62;

/**
 * Third-person orbit camera: mouse-driven yaw/pitch, smoothed pivot (softer vertically so
 * jumps don't jolt the view), obstruction handling that first rises over low obstacles
 * (bushes, rocks) and only then pulls in (fast in, slow out),
 * gentle auto-follow behind Mori after a moment without mouse input, and a ground clamp.
 */
export class FollowCamera {
  constructor(camera, physics, heightAt) {
    this.camera = camera;
    this.physics = physics;
    this.heightAt = heightAt;
    this.yaw = 0;
    this.pitch = 0.3;
    this.distance = 3.8;
    this.targetDistance = 3.8;
    this.current = 3.8;
    this.pivot = new THREE.Vector3();
    this.idle = 0;
    this.lift = 0;
    this.baseFov = camera.fov;
    this._dir = new THREE.Vector3();
    this._look = new THREE.Vector3();
  }

  snap(target) {
    this.pivot.set(target.x, target.y + PIVOT_HEIGHT, target.z);
    this.update(1 / 60, target, 0, 0, { dx: 0, dy: 0 }, 0);
  }

  update(dt, target, playerYaw, speed, look, wheel) {
    if (look.dx || look.dy) this.idle = 0;
    else this.idle += dt;
    this.yaw -= look.dx * 0.0024;
    this.pitch = clamp(this.pitch + look.dy * 0.002, -0.3, 1.2);
    if (wheel) this.targetDistance = clamp(this.targetDistance + wheel * 0.0025, 1.8, 7);
    this.distance += (this.targetDistance - this.distance) * damp(8, dt);

    // drift behind Mori while exploring and the mouse is resting
    if (this.idle > 1.4 && speed > 0.6) {
      const behind = playerYaw + Math.PI;
      const d = Math.atan2(Math.sin(behind - this.yaw), Math.cos(behind - this.yaw));
      this.yaw += d * damp(0.9 * smoothstep(0.6, 4, speed), dt);
    }

    const kx = damp(11, dt), ky = damp(5, dt);
    this.pivot.x += (target.x - this.pivot.x) * kx;
    this.pivot.z += (target.z - this.pivot.z) * kx;
    this.pivot.y += (target.y + PIVOT_HEIGHT - this.pivot.y) * ky;

    // prefer climbing over an obstruction to diving in behind Mori's head
    let lift = 0;
    for (const extra of [0, 0.2, 0.4]) {
      const p = Math.min(this.pitch + extra, 1.35);
      const c = Math.cos(p);
      this._dir.set(Math.sin(this.yaw) * c, Math.sin(p), Math.cos(this.yaw) * c);
      if (this.physics.cameraCast(this.pivot, this._dir, this.distance + 0.3) - 0.2 >= this.distance * 0.85) { lift = extra; break; }
    }
    this.lift += (lift - this.lift) * damp(lift > this.lift ? 6 : 2, dt);
    const pitch = Math.min(this.pitch + this.lift, 1.35);
    const cp = Math.cos(pitch);
    const dir = this._dir.set(Math.sin(this.yaw) * cp, Math.sin(pitch), Math.cos(this.yaw) * cp);
    const free = this.physics.cameraCast(this.pivot, dir, this.distance + 0.3) - 0.2;
    const allowed = clamp(free, 0.55, this.distance);
    this.current += (allowed - this.current) * damp(allowed < this.current ? 22 : 2.5, dt);

    const cam = this.camera;
    cam.position.copy(this.pivot).addScaledVector(dir, this.current);
    const floor = this.heightAt(cam.position.x, cam.position.z) + 0.22;
    if (cam.position.y < floor) cam.position.y = floor;
    cam.lookAt(this._look.copy(this.pivot).add({ x: 0, y: 0.1, z: 0 }));

    const fov = this.baseFov + smoothstep(2.5, 5, speed) * 5;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov += (fov - cam.fov) * damp(4, dt);
      cam.updateProjectionMatrix();
    }
  }
}
