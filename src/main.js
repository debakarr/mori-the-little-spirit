import * as THREE from 'three';
import { globalUniforms } from './core/shaders.js';
import { Input } from './core/Input.js';
import { loadSettings, saveSettings, loadGame, saveGame, clearGame } from './core/Storage.js';
import { loadModels } from './world/assetKit.js';
import { createWorld } from './world/createWorld.js';
import { SPAWN, streamDistance, WATER_Y } from './world/terrain.js';
import { PhysicsWorld } from './physics/PhysicsWorld.js';
import { Forms } from './player/Forms.js';
import { PlayerController } from './player/PlayerController.js';
import { FollowCamera } from './camera/FollowCamera.js';
import { EnvironmentEffects } from './effects/EnvironmentEffects.js';
import { Butterflies } from './effects/Butterflies.js';
import { createPostFX } from './effects/PostFX.js';
import { Ambience } from './audio/Ambience.js';
import { ControlsOverlay } from './ui/ControlsOverlay.js';

const canvas = document.getElementById('game');
const settings = loadSettings();
const ui = new ControlsOverlay(document.getElementById('ui'), { settings });

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.05, 600);

const PIXEL_RATIO = { low: 0.8, medium: 1, high: 1.5 };
const SAVE_EVERY = 5; // seconds
const FLIGHT_HINT = 'Space climb · release to glide · C dive · land on anything to perch';

async function boot() {
  const [models, physics] = await Promise.all([loadModels((p) => ui.progress(p)), PhysicsWorld.create()]);
  const world = createWorld({ scene, renderer, models });
  physics.addStatic(world.colliders);

  const pixelScale = renderer.getDrawingBufferSize(new THREE.Vector2()).y / (2 * Math.tan((camera.fov * Math.PI) / 360));
  const mori = new Forms({ spirit: models.mori, fox: models.fox, bird: models.bird }, { pixelScale });
  scene.add(mori.object, mori.shadow, mori.fx.group);
  const spawn = SPAWN.clone();
  spawn.y = world.heightAt(spawn.x, spawn.z);

  const input = new Input(canvas);
  const audio = new Ambience();
  const effects = new EnvironmentEffects(scene, {
    heightAt: world.heightAt,
    mushroomCenter: world.mushroomCenter,
    pixelScale,
  });
  const player = new PlayerController({
    physics, input, mori, spawn, facing: Math.PI,
    events: {
      onJump: () => audio.whoosh(true),
      onFlap: () => audio.whoosh(true),
      onLand: (impact) => { if (impact > 3) audio.step(false, 1); },
      onBounce: () => { audio.whoosh(true); audio.chime(880); },
    },
  });
  mori.onStep = (run) => audio.step(player.position.y < WATER_Y + 0.05, run);
  mori.onChange = (phase, name) => {
    if (phase === 'start') {
      audio.whoosh(false);
      ui.setForm(name);
    } else {
      audio.whoosh(true);
      audio.chime(990);
      if (name === 'bird') ui.toast(FLIGHT_HINT, 6);
    }
  };
  const follow = new FollowCamera(camera, physics, world.heightAt);
  follow.snap(player.position);
  const post = createPostFX(renderer, scene, camera);

  function applySettings(s) {
    audio.setVolume(s);
    follow.sensitivity = s.sensitivity;
    renderer.setPixelRatio(Math.min(devicePixelRatio, PIXEL_RATIO[s.quality] ?? 1));
    renderer.setSize(innerWidth, innerHeight);
    post.setSize(innerWidth, innerHeight);
    post.bloom.enabled = s.quality !== 'low';
    world.sun.castShadow = s.quality !== 'low';
    saveSettings(s);
  }
  applySettings(settings);
  ui.onSettings = applySettings;

  let started = false;
  let paused = false;
  const canAct = () => started && !paused;
  const lockPointer = () => canvas.requestPointerLock?.()?.catch?.(() => {});
  const save = () => {
    if (started && !mori.change && !player.flying && player.grounded) {
      saveGame({ position: player.position.toArray(), yaw: player.yaw, form: mori.name });
    }
  };
  let pausedAt = 0;
  function setPaused(on) {
    if (!started || paused === on) return;
    paused = on;
    pausedAt = performance.now();
    ui.setPaused(on);
    audio.duck(on);
    if (on) {
      save();
      if (document.pointerLockElement === canvas) document.exitPointerLock();
    } else {
      lockPointer();
    }
  }
  ui.onResume = () => setPaused(false);
  ui.onTitle = () => { save(); location.reload(); };

  input.on('KeyM', () => audio.toggleMute());
  input.on('KeyQ', () => canAct() && mori.transform());
  input.on('Digit1', () => canAct() && mori.transform('spirit'));
  input.on('Digit2', () => canAct() && mori.transform('fox'));
  input.on('Digit3', () => canAct() && mori.transform('bird'));
  input.on('KeyH', () => ui.toggleHints());
  // one Esc can arrive both as the lock release below and as a keypress: count it once
  input.on('Escape', () => { if (performance.now() - pausedAt > 300) setPaused(!paused); });
  // the browser releases pointer lock on Esc without always passing the key on: treat that as pause
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement !== canvas && canAct()) setPaused(true);
  });

  const begin = () => {
    started = true;
    audio.start();
    ui.setForm(mori.name);
    lockPointer();
  };
  ui.ready({
    hasSave: !!loadGame(),
    onNew: () => { clearGame(); begin(); },
    onContinue: () => {
      const s = loadGame();
      if (s) {
        player.teleport(new THREE.Vector3(...s.position), s.yaw ?? player.yaw);
        mori.setForm(s.form ?? 'spirit');
        follow.yaw = player.yaw + Math.PI;
        follow.snap(player.position);
      }
      begin();
    },
  });

  const timer = new THREE.Timer();
  const tailPos = new THREE.Vector3();
  const promptPos = new THREE.Vector3();
  let frames = 0, fpsTime = 0, fps = 0, saveTime = 0, sleepTime = 0;
  physics.step(); // fills Rapier's query pipeline, so the rays below see the static colliders
  for (const it of world.interactables.filter((i) => i.seat)) { // seats sit on whatever is there: rock top or roots
    it.position.y = physics.groundBelow(it.position.x, it.position.y + 4, it.position.z, 8) ?? it.position.y;
  }
  const butterflies = new Butterflies(scene, { heightAt: world.heightAt, homes: world.flowerSpots });

  function frame(now) {
    timer.update(now);
    const dt = Math.min(timer.getDelta(), 0.05);
    const t = timer.getElapsed();
    globalUniforms.uTime.value = t;

    if (paused) {
      input.consumeLook();
      input.consumeWheel();
      input.consumeJump();
      input.consumeInteract();
    } else if (started) {
      player.update(dt, follow.yaw);
      physics.step();
      follow.update(dt, player.position, player.yaw, player.speed, input.consumeLook(), input.consumeWheel(), player.flying);
      if ((saveTime += dt) > SAVE_EVERY) { saveTime = 0; save(); }
    } else {
      // idle orbit behind the title screen (step physics here too, or the ground isn't in the
      // query pipeline yet and Mori sinks through it before the game starts)
      player.update(dt, follow.yaw);
      physics.step();
      follow.update(dt, player.position, player.yaw, 0, { dx: -0.35, dy: 0 }, 0);
    }
    if (!paused) {
      globalUniforms.uPlayer.value.copy(player.position);
      mori.update(dt);
      mori.updateFX();
    }

    // contact shadow follows the ground under Mori, fading with height
    const g = physics.groundBelow(player.position.x, player.position.y + 0.3, player.position.z, 16) ?? player.position.y;
    mori.shadow.position.set(player.position.x, g + 0.02, player.position.z);
    const h = player.position.y - g;
    mori.shadow.material.opacity = THREE.MathUtils.clamp(1 - h * 0.25, 0.1, 1);
    mori.shadow.scale.setScalar((1 + h * 0.15) * mori.stats.shadow);

    // nearest interactable within reach
    let near = null;
    for (const it of world.interactables) {
      const d = it.position.distanceTo(player.position);
      if (d < 2.0 && (!near || d < near.d)) near = { ...it, d };
    }
    if (near && canAct()) {
      promptPos.copy(near.position).add({ x: 0, y: 0.9, z: 0 }).project(camera);
      ui.showPrompt(promptPos.z < 1 ? { x: (promptPos.x * 0.5 + 0.5) * innerWidth, y: (-promptPos.y * 0.5 + 0.5) * innerHeight } : null, near.label);
      const pressed = input.consumeInteract();
      if (pressed && near.seat) {
        player.teleport(near.position, near.yaw);
        mori.animator.sitNow();
        audio.step(false, 0);
      } else if (pressed) {
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

    // glance at whatever is interesting nearby: a butterfly, the mushrooms, a door or a seat
    const poi = butterflies.nearest(player.position, 2.6) ?? (near && near.d < 3 ? near.position : null)
      ?? (world.mushroomCenter.distanceTo(player.position) < 3.5 ? world.mushroomCenter : null);
    const rel = poi ? Math.atan2(poi.x - player.position.x, poi.z - player.position.z) - player.yaw : 0;
    const look = Math.atan2(Math.sin(rel), Math.cos(rel));
    mori.animator.lookTarget = poi && Math.abs(look) < 1.7 ? look : null;

    // resting a while: Mori dozes, her glow breathes slowly and sleepy motes drift up
    const dozing = THREE.MathUtils.smoothstep(mori.animator.restTime, 10, 14);
    if (dozing > 0.5 && (sleepTime -= dt) < 0) {
      sleepTime = 1.6;
      effects.emitBurst(player.position.clone().add({ x: 0, y: 0.75, z: 0 }), '#cfe7ff', 3, 0.22);
    }
    mori.setGlow((2.4 + 0.5 * Math.sin(t * (2.1 - dozing * 1.3)) + player.runBlend * 0.9) * (1 - dozing * 0.4));
    butterflies.update(dt, t, player.position);
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
  addEventListener('pagehide', save);

  if (import.meta.env.DEV) {
    window.__mori = {
      player, follow, world, scene, renderer, camera, input, audio, mori, ui, post,
      get fps() { return fps; },
      start: () => ui.titleMenu.querySelector('[data-act="new"]').click(),
    };
  }
}

boot().catch((err) => {
  console.error(err);
  ui.error('Something went wrong while loading the grove. See the console for details.');
});
