// Rapier (with its inlined WASM) is loaded as a separate chunk, in parallel with the models.
let RAPIER = null;

/**
 * Thin wrapper around a Rapier world holding only static colliders plus the
 * player's kinematic capsule. Also answers camera collision queries.
 */
export class PhysicsWorld {
  static async create() {
    RAPIER = (await import('@dimforge/rapier3d-compat')).default;
    await RAPIER.init();
    return new PhysicsWorld();
  }

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.cameraIgnore = new Set();
    this.bouncy = new Set();
    this.cameraOnly = new Set();
    this.walkable = (c) => !this.cameraOnly.has(c.handle);
  }

  /** Build static colliders from world specs (trimesh / hull / cuboid). */
  addStatic(specs) {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    for (const s of specs) {
      let desc = null;
      if (s.type === 'trimesh') desc = RAPIER.ColliderDesc.trimesh(s.vertices, s.indices);
      else if (s.type === 'hull') desc = s.points.length >= 12 ? RAPIER.ColliderDesc.convexHull(s.points) : null;
      else if (s.type === 'cuboid') {
        desc = RAPIER.ColliderDesc.cuboid(...s.half)
          .setTranslation(s.center.x, s.center.y, s.center.z)
          .setRotation({ x: 0, y: Math.sin(s.yaw / 2), z: 0, w: Math.cos(s.yaw / 2) });
      }
      if (!desc) continue;
      desc.setFriction(0.6);
      const c = this.world.createCollider(desc, body);
      if (s.cameraIgnore) this.cameraIgnore.add(c.handle);
      if (s.bounce) this.bouncy.add(c.handle);
      if (s.cameraOnly) this.cameraOnly.add(c.handle);
    }
  }

  /** Kinematic capsule + character controller for the player. */
  createCharacter({ radius, halfHeight, position }) {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(position.x, position.y + halfHeight + radius, position.z),
    );
    const collider = this.world.createCollider(RAPIER.ColliderDesc.capsule(halfHeight, radius), body);
    this.cameraIgnore.add(collider.handle);
    const controller = this.world.createCharacterController(0.02);
    controller.setUp({ x: 0, y: 1, z: 0 });
    controller.setMaxSlopeClimbAngle((52 * Math.PI) / 180);
    controller.setMinSlopeSlideAngle((60 * Math.PI) / 180);
    controller.enableAutostep(0.22, 0.12, false);
    controller.enableSnapToGround(0.25);
    controller.setSlideEnabled(true);
    return { body, collider, controller };
  }

  /**
   * Sphere-cast from `from` along `dir`; returns the free distance (or the full distance).
   * Ignores the player, invisible boundary walls and any collider the cast starts inside
   * (Mori standing in a bush must not pin the camera to her head).
   */
  cameraCast(from, dir, maxDist, radius = 0.22) {
    const shape = new RAPIER.Ball(radius);
    const origin = { x: from.x, y: from.y, z: from.z };
    const inside = new Set();
    this.world.intersectionsWithShape(origin, { x: 0, y: 0, z: 0, w: 1 }, shape, (c) => { inside.add(c.handle); return true; });
    const hit = this.world.castShape(
      origin, { x: 0, y: 0, z: 0, w: 1 }, { x: dir.x, y: dir.y, z: dir.z }, shape,
      0, maxDist, true, undefined, undefined, undefined, undefined,
      (c) => !this.cameraIgnore.has(c.handle) && !inside.has(c.handle),
    );
    return hit ? hit.time_of_impact ?? hit.timeOfImpact ?? maxDist : maxDist;
  }

  /** Downward ray: ground height under a point (null if none) and whether that ground is bouncy. */
  groundBelow(x, y, z, maxDist = 6) {
    const ray = new RAPIER.Ray({ x, y, z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(ray, maxDist, true, undefined, undefined, undefined, undefined, (c) => !this.cameraIgnore.has(c.handle) && this.walkable(c));
    if (!hit) return null;
    this.lastGroundBouncy = this.bouncy.has(hit.collider.handle);
    return y - hit.timeOfImpact;
  }

  step() {
    this.world.step();
  }
}
