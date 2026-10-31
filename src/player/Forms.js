import * as THREE from 'three';
import { smoothstep } from '../core/noise.js';
import { createMori } from './Mori.js';

/** Movement per form (the fox is the runner and jumper); glow scales the painted emissive (the fox's
 * whole flame tail is painted cyan, so it needs less to read the same). */
const FORMS = {
  spirit: { walk: 2.3, run: 4.9, jump: 5.5, shadow: 1, glow: 1 },
  fox: { walk: 2.9, run: 7.2, jump: 6.6, shadow: 1.35, glow: 0.45 },
};
const ORDER = ['spirit', 'fox'];
const DURATION = 1.25; // seconds for a whole change
const SWAP = 0.48;     // share of DURATION when the new body takes over

/**
 * Mori's bodies and the change between them (the reference: crouch, cyan mist spirals in around the
 * body, it flashes to light and dissolves, the new form pops out of the mist as it bursts outward).
 * Stands in for a single body wherever the game expects one: object, animator, setGlow, tailBone.
 */
export class Forms {
  constructor(gltfs, { pixelScale }) {
    this.object = new THREE.Group();
    this.object.name = 'Mori';
    this.bodies = {};
    for (const name of ORDER) {
      const body = createMori(gltfs[name], name);
      body.object.visible = name === 'spirit';
      this.object.add(body.object);
      this.bodies[name] = body;
    }
    this.name = 'spirit';
    this.shadow = this.bodies.spirit.shadow;
    this.fx = new ChangeFX(pixelScale);
    this.change = null; // { from, to, t, swapped }
    this.onChange = null;
    this._glow = 2.5;
  }

  get body() { return this.bodies[this.name]; }
  get animator() { return this.body.animator; }
  get tailBone() { return this.body.tailBone; }
  get stats() { return FORMS[this.name]; }
  /** Movement and jumping pause while a change plays. */
  get busy() { return !!this.change && this.change.t < SWAP + 0.2; }

  set onStep(fn) { for (const b of Object.values(this.bodies)) b.animator.onStep = fn; }

  setGlow(v) {
    this._glow = v;
    this.body.setGlow(v * this.stats.glow);
  }

  /** Change to `name` (or the next form); ignored mid-change or when already there. */
  transform(name = ORDER[(ORDER.indexOf(this.name) + 1) % ORDER.length]) {
    if (this.change || name === this.name || !this.bodies[name]) return false;
    this.change = { from: this.name, to: name, t: 0, swapped: false };
    this.bodies[this.name].animator.land(7); // crouch into it
    this.onChange?.('start', name);
    return true;
  }

  update(dt) {
    const c = this.change;
    if (!c) return;
    c.t += dt / DURATION;
    const from = this.bodies[c.from];
    const to = this.bodies[c.to];
    if (!c.swapped) {
      from.setChange(smoothstep(0.05, 0.38, c.t), smoothstep(0.26, SWAP, c.t));
      if (c.t >= SWAP) {
        c.swapped = true;
        from.object.visible = false;
        from.setChange(0, 0);
        this.name = c.to;
        to.object.visible = true;
        to.animator.squash.vel += 5.5; // pop up out of the mist
        to.animator.ears.vel -= 6;
        to.setGlow(this._glow * FORMS[c.to].glow);
        this.shadow.scale.setScalar(1);
        this.onChange?.('swap', c.to);
      }
    }
    if (c.swapped) to.setChange(1 - smoothstep(SWAP, 0.95, c.t), 1 - smoothstep(SWAP, 0.74, c.t));
    if (c.t >= 1) {
      to.setChange(0, 0);
      this.change = null;
    }
    // the incoming body idles (unseen) until it takes over, so it appears settled
    if (!c.swapped) to.animator.update(dt, { speed: 0, runBlend: 0, grounded: true, vy: 0, yawRate: 0, accel: 0 });
  }

  updateFX() {
    this.fx.update(this.change ? this.change.t : null, this.object.position);
  }
}

/**
 * The mist: ~300 additive motes that spiral in and up around Mori, then burst outward with a ground
 * ring when the new body takes over. All motion is in the vertex shader from one progress value.
 */
class ChangeFX {
  constructor(pixelScale) {
    const N = 320;
    const geo = new THREE.BufferGeometry();
    const seed = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) {
      seed.set([Math.random() * Math.PI * 2, 0.35 + Math.random() * 0.75, Math.random(), Math.random()], i * 4);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    this.uniforms = {
      uT: { value: 0 },
      uCenter: { value: new THREE.Vector3() },
      uScale: { value: pixelScale },
      uSwap: { value: SWAP },
      uTint: { value: new THREE.Color('#7ff4ff') },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute vec4 aSeed; // start angle, start radius, height, random
        uniform float uT, uScale, uSwap;
        uniform vec3 uCenter;
        varying float vA;
        varying float vR;
        void main() {
          float gather = smoothstep( 0.0, uSwap, uT );
          float burst = smoothstep( uSwap, 1.0, uT );
          float ang = aSeed.x + ( uT * 7.0 + burst * 2.5 ) * ( 0.7 + aSeed.w * 0.8 ) * ( aSeed.w > 0.5 ? 1.0 : -1.0 );
          float r = mix( aSeed.y, 0.16 + 0.14 * aSeed.w, gather * gather ) + burst * ( 0.5 + aSeed.w * 1.3 );
          float y = mix( 0.03, 0.08 + aSeed.z * 0.7, gather ) + burst * ( 0.15 + aSeed.z * 0.55 );
          vec3 p = uCenter + vec3( cos( ang ) * r, y, sin( ang ) * r );
          vec4 mv = viewMatrix * vec4( p, 1.0 );
          gl_Position = projectionMatrix * mv;
          vA = smoothstep( 0.0, 0.12, uT ) * ( 1.0 - smoothstep( 0.72, 1.0, uT ) ) * ( 0.55 + 0.45 * sin( uT * 30.0 + aSeed.w * 40.0 ) );
          vR = aSeed.w;
          gl_PointSize = ( 0.018 + aSeed.w * 0.03 ) * ( 1.0 + burst * 0.6 ) * uScale / -mv.z;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uTint;
        varying float vA;
        varying float vR;
        void main() {
          float d = length( gl_PointCoord - 0.5 ) * 2.0;
          float a = smoothstep( 1.0, 0.0, d );
          vec3 c = mix( uTint, vec3( 1.0 ), smoothstep( 0.6, 0.0, d ) * 0.7 + vR * 0.2 );
          gl_FragColor = vec4( c * a * vA * 1.6, 1.0 );
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.visible = false;

    this.ring = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }',
        fragmentShader: /* glsl */ `
          uniform float uT, uSwap;
          uniform vec3 uTint;
          varying vec2 vUv;
          void main() {
            float d = length( vUv - 0.5 ) * 2.0;
            float burst = smoothstep( uSwap, 1.0, uT );
            float r = mix( 0.15, 0.95, sqrt( burst ) );
            float a = exp( -pow( ( d - r ) / 0.05, 2.0 ) ) * ( 1.0 - burst ) * step( uSwap, uT );
            a += smoothstep( 0.6, 0.0, d ) * smoothstep( 0.0, uSwap, uT ) * ( 1.0 - burst ) * 0.25; // mist pooling underfoot
            gl_FragColor = vec4( uTint * a * 1.5, 1.0 );
          }`,
      }),
    );
    this.ring.scale.setScalar(2.4);
    this.ring.frustumCulled = false;
    this.ring.visible = false;
    this.group = new THREE.Group();
    this.group.add(this.points, this.ring);
  }

  update(t, center) {
    const on = t !== null;
    this.points.visible = this.ring.visible = on;
    if (!on) return;
    this.uniforms.uT.value = Math.min(t, 1);
    this.uniforms.uCenter.value.copy(center);
    this.ring.position.set(center.x, center.y + 0.03, center.z);
  }
}
