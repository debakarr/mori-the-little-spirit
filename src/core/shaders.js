import * as THREE from 'three';

/** Uniforms shared by every patched material (time, wind, player position). */
export const globalUniforms = {
  uTime: { value: 0 },
  uWind: { value: 1 },
  uPlayer: { value: new THREE.Vector3(0, -100, 0) },
};

const NOISE = /* glsl */ `
float lsHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float lsNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(lsHash(i), lsHash(i + vec3(1, 0, 0)), f.x), mix(lsHash(i + vec3(0, 1, 0)), lsHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(lsHash(i + vec3(0, 0, 1)), lsHash(i + vec3(1, 0, 1)), f.x), mix(lsHash(i + vec3(0, 1, 1)), lsHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
`;

const WIND = /* glsl */ `
uniform float uTime;
uniform float uWind;
uniform vec3 uPlayer;
vec2 lsWind(vec2 p) {
  float a = sin(p.x * 0.21 + uTime * 1.1) + sin(p.y * 0.17 + uTime * 0.83 + p.x * 0.05) * 0.7;
  float gust = 0.55 + 0.45 * sin(uTime * 0.37 + p.x * 0.04 + p.y * 0.03);
  return vec2(0.85, 0.5) * (0.55 + 0.45 * a) * gust * uWind;
}
`;

/**
 * Inject the game's shared shader features into a built-in material.
 *
 * opts.wind        GLSL float expression: sway weight (world units of displacement)
 * opts.flutter     per-vertex leaf flutter amplitude
 * opts.push        GLSL float expression: how much the player bends this vertex away
 * opts.leafNormal  use instanced `aLeafNormal` for soft volumetric foliage lighting
 * opts.noFlip      keep normals of double-sided back faces (cards / blades)
 * opts.nearFade    [start, end] metres: dither away fragments close to the camera
 * opts.detail      [scaleX, scaleY, scaleZ, amount] world-space colour breakup
 * opts.glow        { color, strength } emissive mask from the `_glow` attribute
 * opts.glowFromColor  use the vertex colour as the glow colour
 * opts.rim         { color, strength, power } fresnel rim light
 * opts.inject      { uniforms, head, color, roughness, lights, output } extra GLSL: declarations, then
 *                  blocks run after the colour, roughness and lighting chunks and before the final output
 * Returns the per-material uniforms so callers can animate them.
 */
export function patchMaterial(material, opts = {}) {
  const uniforms = {
    uGlowColor: { value: new THREE.Color(opts.glow?.color ?? '#7ff4ff') },
    uGlowStrength: { value: opts.glow?.strength ?? 0 },
    uRimColor: { value: new THREE.Color(opts.rim?.color ?? '#7ff4ff') },
    uRimStrength: { value: opts.rim?.strength ?? 0 },
  };
  const key = JSON.stringify({ ...opts, glow: !!opts.glow, rim: opts.rim?.power ?? null, inject: opts.inject && { ...opts.inject, uniforms: null } });

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, globalUniforms, uniforms, opts.inject?.uniforms);
    let vs = shader.vertexShader;
    let fs = shader.fragmentShader;

    let vHead = `${WIND}${NOISE}\nvarying vec3 vLsWorld;\n`;
    if (opts.leafNormal) vHead += 'attribute vec3 aLeafNormal;\n';
    if (opts.glow) vHead += 'attribute float _glow;\nvarying float vGlow;\n';
    for (const a of opts.attrs ?? []) vHead += `attribute float ${a};\n`;
    vs = vs.replace('#include <common>', `#include <common>\n${vHead}`);
    if (opts.leafNormal) vs = vs.replace('#include <beginnormal_vertex>', 'vec3 objectNormal = aLeafNormal;');
    if (opts.glow) vs = vs.replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = _glow;');

    vs = vs.replace(
      '#include <project_vertex>',
      /* glsl */ `
      vec4 lsLocal = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        lsLocal = instanceMatrix * lsLocal;
      #endif
      vec4 lsW = modelMatrix * lsLocal;
      ${opts.wind ? `{ float lsWeight = ${opts.wind}; vec2 w = lsWind(lsW.xz); lsW.xz += w * lsWeight; lsW.y -= dot(w, w) * lsWeight * 0.2; }` : ''}
      ${opts.flutter ? `lsW.xyz += vec3(sin(uTime * 3.1 + lsW.x * 3.7 + lsW.y * 2.3), 0.5 * sin(uTime * 2.7 + lsW.z * 3.1), cos(uTime * 3.3 + lsW.z * 2.9 + lsW.y * 1.7)) * ${opts.flutter} * uWind;` : ''}
      ${opts.push ? `{ vec2 d = lsW.xz - uPlayer.xz; float dist = length(d); float k = (1.0 - smoothstep(0.1, 0.7, dist)) * (1.0 - smoothstep(0.6, 1.2, abs(lsW.y - uPlayer.y))); lsW.xz += (d / max(dist, 1e-3)) * k * 0.32 * (${opts.push}); lsW.y -= k * 0.1 * (${opts.push}); }` : ''}
      vLsWorld = lsW.xyz;
      vec4 mvPosition = viewMatrix * lsW;
      gl_Position = projectionMatrix * mvPosition;
      `,
    );

    let fHead = `${NOISE}\nvarying vec3 vLsWorld;\nuniform vec3 uGlowColor;\nuniform float uGlowStrength;\nuniform vec3 uRimColor;\nuniform float uRimStrength;\n`;
    if (opts.glow) fHead += 'varying float vGlow;\n';
    fs = fs.replace('#include <common>', `#include <common>\n${fHead}`);
    if (opts.noFlip) {
      fs = fs.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n#ifdef DOUBLE_SIDED\nnormal *= faceDirection;\nnonPerturbedNormal = normal;\n#endif');
    }
    if (opts.nearFade) {
      const [n0, n1] = opts.nearFade;
      fs = fs.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        { float lsF = smoothstep(${n0.toFixed(2)}, ${n1.toFixed(2)}, length(vViewPosition));
          if (lsF < fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453)) discard; }`);
    }
    if (opts.detail) {
      const [sx, sy, sz, amt] = opts.detail;
      fs = fs.replace(
        '#include <color_fragment>',
        `#include <color_fragment>\n{ vec3 q = vLsWorld * vec3(${sx.toFixed(3)}, ${sy.toFixed(3)}, ${sz.toFixed(3)}); float n = lsNoise(q) * 0.6 + lsNoise(q * 3.1 + 7.0) * 0.4; diffuseColor.rgb *= mix(${(1 - amt).toFixed(3)}, ${(1 + amt).toFixed(3)}, n); }`,
      );
    }
    const inj = opts.inject;
    if (inj) {
      fs = fs.replace('#include <common>', `#include <common>\n${inj.head ?? ''}`);
      if (inj.color) fs = fs.replace('#include <color_fragment>', `#include <color_fragment>\n${inj.color}`);
      if (inj.roughness) fs = fs.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${inj.roughness}`);
      if (inj.lights) fs = fs.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${inj.lights}`);
      if (inj.output) fs = fs.replace('#include <opaque_fragment>', `${inj.output}\n#include <opaque_fragment>`);
    }
    let emissive = '';
    if (opts.glow) emissive += `totalEmissiveRadiance += ${opts.glowFromColor ? 'vColor.rgb' : 'uGlowColor'} * vGlow * uGlowStrength;\n`;
    if (opts.rim) emissive += `{ float f = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), ${opts.rim.power.toFixed(2)}); totalEmissiveRadiance += uRimColor * f * uRimStrength; }\n`;
    if (emissive) fs = fs.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${emissive}`);

    shader.vertexShader = vs;
    shader.fragmentShader = fs;
  };
  material.customProgramCacheKey = () => key;
  material.needsUpdate = true;
  return uniforms;
}
