import * as THREE from 'three';
import { globalUniforms } from './core/shaders.js';
import { Input } from './core/Input.js';
import { loadModels } from './world/assetKit.js';
import { createWorld } from './world/createWorld.js';
import { SPAWN, streamDistance, WATER_Y } from './world/terrain.js';
import { PhysicsWorld } from './physics/PhysicsWorld.js';
import { createMori } from './player/Mori.js';
import { PlayerController } from './player/PlayerController.js';
import { FollowCamera } from './camera/FollowCamera.js';
import { EnvironmentEffects } from './effects/EnvironmentEffects.js';
import { createPostFX } from './effects/PostFX.js';
import { Ambience } from './audio/Ambience.js';
import { ControlsOverlay } from './ui/ControlsOverlay.js';

const canvas = document.getElementById('game');
const ui = new ControlsOverlay(document.getElementById('ui'));

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.05, 600);

async function boot() {
  const [models, physics] = await Promise.all([loadModels((p) => ui.progress(p)), PhysicsWorld.create()]);
  const world = createWorld({ scene, renderer, models });
  physics.addStatic(world.colliders);

  const mori = createMori(models.mori);
  scene.add(mori.object, mori.shadow);
  const spawn = SPAWN.clone();
  spawn.y = world.heightAt(spawn.x, spawn.z);

  const input = new Input(canvas);
  const audio = new Ambience();
  const effects = new EnvironmentEffects(scene, {
    heightAt: world.heightAt,
    mushroomCenter: world.mushroomCenter,
    pixelScale: renderer.getDrawingBufferSize(new THREE.Vector2()).y / (2 * Math.tan((camera.fov * Math.PI) / 360)),
  });
  const player = new PlayerController({
    physics, input, mori, spawn, facing: Math.PI,
    events: {
      onJump: () => audio.whoosh(true),
      onLand: (impact) => { if (impact > 3) audio.step(false, 1); },
      onBounce: () => { audio.whoosh(true); audio.chime(880); },
    },
  });
  mori.animator.onStep = (run) => audio.step(player.position.y < WATER_Y + 0.05, run);
  const follow = new FollowCamera(camera, physics, world.heightAt);
  follow.snap(player.position);
  const post = createPostFX(renderer, scene, camera);

  input.on('KeyM', () => audio.toggleMute());
  input.on('KeyH', () => ui.toggleHints());

  let started = false;
  ui.ready(() => {
    started = true;
    audio.start();
    canvas.requestPointerLock?.()?.catch?.(() => {});
  });

  const timer = new THREE.Timer();
  const tailPos = new THREE.Vector3();
  const promptPos = new THREE.Vector3();
  let frames = 0, fpsTime = 0, fps = 0;

  function frame(now) {
    timer.update(now);
    const dt = Math.min(timer.getDelta(), 0.05);
    const t = timer.getElapsed();
    globalUniforms.uTime.value = t;

    if (started) {
      player.update(dt, follow.yaw);
      physics.step();
      follow.update(dt, player.position, player.yaw, player.speed, input.consumeLook(), input.consumeWheel());
    } else {
      // idle orbit behind the title screen
      player.update(dt, follow.yaw);
      follow.update(dt, player.position, player.yaw, 0, { dx: -0.35, dy: 0 }, 0);
    }
    globalUniforms.uPlayer.value.copy(player.position);

    // contact shadow follows the ground under Mori, fading with height
    const g = physics.groundBelow(player.position.x, player.position.y + 0.3, player.position.z) ?? player.position.y;
    mori.shadow.position.set(player.position.x, g + 0.02, player.position.z);
    const h = player.position.y - g;
    mori.shadow.material.opacity = THREE.MathUtils.clamp(1 - h * 0.8, 0.15, 1);
    mori.shadow.scale.setScalar(1 + h * 0.3);

    // nearest interactable within reach
    let near = null;
    for (const it of world.interactables) {
      const d = it.position.distanceTo(player.position);
      if (d < 2.0 && (!near || d < near.d)) near = { ...it, d };
    }
    if (near && started) {
      promptPos.copy(near.position).add({ x: 0, y: 0.9, z: 0 }).project(camera);
      ui.showPrompt(promptPos.z < 1 ? { x: (promptPos.x * 0.5 + 0.5) * innerWidth, y: (-promptPos.y * 0.5 + 0.5) * innerHeight } : null, near.label);
      if (input.consumeInteract()) {
        world.trigger(near.key);
        mori.animator.play(near.key === 'door' ? 'Idle Alert' : 'Howl');
        const color = near.key === 'mushrooms' ? '#6fd0ff' : '#8ff3ff';
        effects.emitBurst(near.key === 'mushrooms' ? world.mushroomCenter : near.position.clone().add({ x: 0, y: 0.6, z: 0 }), color, 50);
        audio.chime(near.key === 'mushrooms' ? 520 : 660);
      }
    } else {
      ui.showPrompt(null);
      input.consumeInteract();
    }

    mori.setGlow(2.4 + 0.5 * Math.sin(t * 2.1) + player.runBlend * 0.9);
    if (mori.tailBone) mori.tailBone.getWorldPosition(tailPos);
    world.update(dt, t);
    effects.update(dt, t, camera, { tail: mori.tailBone ? tailPos : null, speed: player.speed });
    audio.update(dt, t, streamDistance(player.position.x, player.position.z));
    ui.update(dt, player.speed > 0.5);

    post.render();

    frames++;
    if ((fpsTime += dt) > 1) { fps = frames / fpsTime; frames = 0; fpsTime = 0; }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    post.setSize(innerWidth, innerHeight);
  });

  if (import.meta.env.DEV) {
    window.__mori = { player, follow, world, scene, renderer, camera, input, audio, get fps() { return fps; }, start: () => ui.start.click() };
  }
}

boot().catch((err) => {
  console.error(err);
  ui.error('Something went wrong while loading the grove. See the console for details.');
});
