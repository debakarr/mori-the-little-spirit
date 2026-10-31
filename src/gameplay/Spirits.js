import * as THREE from 'three';
import { softDotTexture } from '../core/textures.js';
import { AREAS, TREE_POS } from '../world/terrain.js';

const COLLECT_RADIUS = 1.05;
const SNIFF_TIME = 3;
const AREA_KEYS = ['hollow', 'overlook', 'lake', 'falls', 'meadow'];

/**
 * The quiet "game" in the grove, all of it optional: wisps of spirit light rest all over the world
 * (some only wings or a mushroom bounce can reach), five dormant shrines wait in the far places, and
 * only Mori's spirit form can wake them. A woken shrine lights its area and makes its wisps shine
 * brighter; waking all five makes the grove celebrate. The fox can sniff out the nearest wisp (F), and
 * each place's name drifts in the first time Mori arrives. Progress is part of the save.
 */
export class Spirits {
  constructor({ scene, world, physics, effects, audio, ui }) {
    this.world = world;
    this.effects = effects;
    this.audio = audio;
    this.ui = ui;
    this.shrines = world.areas.shrines;
    this.collected = new Set();
    this.discovered = new Set();
    this.sniff = null;
    this.finale = 0;
    const tex = softDotTexture();
    this.wisps = world.areas.wisps.map((w, i) => {
      const p = w.p.clone();
      if (w.snap) { // rest on whatever is below: a rock top, a mushroom cap, the tree's crown
        const g = physics.groundBelow(p.x, p.y + 12, p.z, 40);
        if (g !== null) p.y = g + 0.7;
      }
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: '#7ff4ff', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: '#ffffff', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      glow.scale.setScalar(1.1);
      core.scale.setScalar(0.32);
      const group = new THREE.Group();
      group.add(glow, core);
      group.position.copy(p);
      scene.add(group);
      return { ...w, p, group, glow, core, phase: i * 1.37 };
    });
    this.total = this.wisps.length;
    this._center = new THREE.Vector3();
    this.refreshHud();
  }

  get awakeCount() {
    return this.shrines.filter((s) => s.woken).length;
  }

  refreshHud() {
    this.ui.setProgress?.({ wisps: this.collected.size, total: this.total, shrines: this.awakeCount, shrineTotal: this.shrines.length });
  }

  /** Wake a shrine (from an interaction); only the spirit form can. */
  awaken(shrine, form) {
    if (shrine.woken) {
      this.ui.toast(`The ${shrine.name.toLowerCase()} shrine hums softly.`, 3);
      return;
    }
    if (form !== 'spirit') {
      this.ui.toast('Only Mori\'s spirit form can wake a shrine. Press 1 to become the spirit.', 4);
      this.audio.chime(330);
      return;
    }
    shrine.woken = true;
    this.effects.emitBurst(shrine.position.clone().add({ x: 0, y: 0.8, z: 0 }), '#8ff3ff', 80, 2.4);
    [0, 0.35, 0.7].forEach((d, i) => setTimeout(() => this.audio.chime([523, 659, 784][i]), d * 1000));
    this.ui.areaTitle(`${shrine.name} awakens`);
    this.refreshHud();
    if (this.awakeCount === this.shrines.length) setTimeout(() => this.celebrate(), 2200);
  }

  celebrate() {
    this.finale = 1;
    this.ui.areaTitle('The grove remembers you');
    const tree = new THREE.Vector3(TREE_POS.x, 6, TREE_POS.z);
    for (let i = 0; i < 4; i++) {
      setTimeout(() => {
        this.effects.emitBurst(tree.clone().add({ x: (Math.random() - 0.5) * 6, y: Math.random() * 4, z: (Math.random() - 0.5) * 6 }), '#ffe9a8', 80, 3);
        this.audio.chime(440 * (1 + i * 0.25));
      }, i * 600);
    }
    this.world.trigger('door');
    this.world.trigger('rune');
  }

  /** The fox follows its nose: a trail of motes toward the nearest wisp still out there. */
  startSniff(from) {
    let best = null, bd = Infinity;
    for (const w of this.wisps) {
      if (this.collected.has(w.id)) continue;
      const d = w.p.distanceTo(from);
      if (d < bd) { bd = d; best = w; }
    }
    if (!best) {
      this.ui.toast('No wisps left to find. The forest is full of light.', 3);
      return;
    }
    this.sniff = { target: best, time: SNIFF_TIME, next: 0 };
    this.ui.toast(bd < 15 ? 'A wisp is very close…' : bd < 45 ? 'Mori catches a scent of light.' : 'A faint scent, far away.', 2.5);
  }

  collect(w) {
    this.collected.add(w.id);
    w.group.visible = false;
    this.effects.emitBurst(w.p, '#9ff7ff', 36, 1.6);
    this.audio.chime(660 + this.collected.size * 12);
    const areaLeft = this.wisps.filter((o) => o.area === w.area && !this.collected.has(o.id)).length;
    if (this.collected.size === this.total) this.ui.toast('Every wisp found. Thank you, little spirit.', 5);
    else if (areaLeft === 0 && AREAS[w.area]) this.ui.toast(`All the wisps of ${AREAS[w.area].name} are found.`, 3.5);
    this.refreshHud();
  }

  update(dt, t, playerPos) {
    const c = this._center.copy(playerPos).add({ x: 0, y: 0.4, z: 0 });
    for (const w of this.wisps) {
      if (this.collected.has(w.id)) continue;
      const shrine = this.shrines.find((s) => s.area === w.area);
      const lit = shrine?.woken ? 1 : 0;
      w.group.position.set(w.p.x, w.p.y + Math.sin(t * 1.7 + w.phase) * 0.12, w.p.z);
      const pulse = 0.85 + 0.15 * Math.sin(t * 3.1 + w.phase);
      w.glow.scale.setScalar((1.0 + lit * 0.5) * pulse);
      w.glow.material.opacity = 0.75 + lit * 0.25;
      if (w.group.position.distanceTo(c) < COLLECT_RADIUS) this.collect(w);
    }
    for (const s of this.shrines) s.awake += ((s.woken ? 1 : 0) - s.awake) * Math.min(1, dt * 1.5);

    // the first visit to a place shows its name
    for (const k of AREA_KEYS) {
      const a = AREAS[k];
      if (!this.discovered.has(k) && Math.hypot(playerPos.x - a.x, playerPos.z - a.z) < a.r + 6) {
        this.discovered.add(k);
        this.ui.areaTitle(a.name);
      }
    }

    if (this.sniff) {
      const s = this.sniff;
      s.time -= dt;
      s.next -= dt;
      if (s.next <= 0) {
        s.next = 0.12;
        const dir = s.target.p.clone().sub(c);
        const len = Math.min(dir.length(), 9);
        dir.normalize();
        const k = ((SNIFF_TIME - s.time) * 3) % 1; // motes run along the scent line
        this.effects.emitBurst(c.clone().addScaledVector(dir, 0.6 + k * len).add({ x: 0, y: -0.2, z: 0 }), '#bff8ff', 3, 0.15);
      }
      if (s.time <= 0 || this.collected.has(s.target.id)) this.sniff = null;
    }
  }

  /** Save data: which wisps were gathered and which shrines are awake. */
  state() {
    return { wisps: [...this.collected], shrines: this.shrines.filter((s) => s.woken).map((s) => s.id), discovered: [...this.discovered] };
  }

  load(s) {
    if (!s) return;
    for (const id of s.wisps ?? []) {
      const w = this.wisps.find((o) => o.id === id);
      if (w) { this.collected.add(id); w.group.visible = false; }
    }
    for (const id of s.shrines ?? []) {
      const sh = this.shrines.find((o) => o.id === id);
      if (sh) { sh.woken = true; sh.awake = 1; }
    }
    for (const k of s.discovered ?? []) this.discovered.add(k);
    if (this.awakeCount === this.shrines.length) this.finale = 1;
    this.refreshHud();
  }
}
