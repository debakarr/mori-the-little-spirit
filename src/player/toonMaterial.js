import * as THREE from 'three';
import { patchMaterial } from '../core/shaders.js';
import { HEMI } from '../world/lighting.js';

/**
 * Anime cel shading for Mori (the look of tools/blender/toon_mori.py's preview): every direct light goes
 * through a soft two-tone ramp whose dark side is a cool lilac instead of black, there is no specular or
 * sky reflection (that's what read as plastic), ambient light is flattened so the body reads as one
 * colour, and a thin fresnel rim lights the silhouette. The GLB carries smoothed normals so the ramp
 * draws a few clean shapes rather than every lump of the sculpt.
 * uFlash (0..1) washes the body to spirit light and uDissolve (0..1) eats it away through glowing
 * noise edges: the two halves of a form change (Forms.js).
 */
const TOON_LIGHT = /* glsl */ `
uniform vec3 uShadowTint;
uniform float uRampMid;
uniform float uRampSoft;
void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  float lit = smoothstep( uRampMid - uRampSoft, uRampMid + uRampSoft, dot( geometryNormal, directLight.direction ) );
  reflectedLight.directDiffuse += directLight.color * mix( uShadowTint, vec3( 1.0 ), lit ) * BRDF_Lambert( material.diffuseColor );
}
#undef RE_Direct
#define RE_Direct RE_Direct_Toon
`;

export function toonMaterial(material, { rimColor = '#9ff6ff', rimStrength = 0.16 } = {}) {
  material.metalness = 0;
  material.roughness = 1;
  material.envMapIntensity = 0;
  const uniforms = {
    uShadowTint: { value: new THREE.Color('#8f86c9') },
    uRampMid: { value: 0.02 },
    uRampSoft: { value: 0.07 },
    uFlatAmbient: { value: 0.7 },
    uAmbientAvg: { value: HEMI.sky.clone().add(HEMI.ground).multiplyScalar(0.5 * HEMI.intensity) },
    uToonRim: { value: new THREE.Color(rimColor) },
    uToonRimStrength: { value: rimStrength },
    uFlash: { value: 0 },
    uDissolve: { value: 0 },
  };
  const shared = patchMaterial(material, {
    inject: {
      uniforms,
      // painted near-black fur lifted toward slate blue, as anime renders dark characters
      color: /* glsl */ `
        diffuseColor.rgb = diffuseColor.rgb * 0.9 + vec3( 0.016, 0.018, 0.032 );
        float lsDissolve = lsNoise( vLsWorld * 16.0 ) * 0.7 + lsNoise( vLsWorld * 41.0 ) * 0.3;
        if ( uDissolve > 0.0 && lsDissolve < uDissolve * 1.05 ) discard;`,
      head: 'uniform float uFlatAmbient;\nuniform vec3 uAmbientAvg;\nuniform vec3 uToonRim;\nuniform float uToonRimStrength;\nuniform float uFlash;\nuniform float uDissolve;\n',
      output: /* glsl */ `
        outgoingLight = mix( outgoingLight, vec3( 0.75, 1.6, 1.7 ), uFlash );
        if ( uDissolve > 0.0 ) outgoingLight += vec3( 0.6, 2.2, 2.4 ) * ( 1.0 - smoothstep( 0.0, 0.08, lsDissolve - uDissolve * 1.05 ) );`,
      lights: /* glsl */ `
        { // flatten the sky/ground fill toward its average so it doesn't shade the form a second time
          reflectedLight.indirectDiffuse = mix( reflectedLight.indirectDiffuse, uAmbientAvg * BRDF_Lambert( material.diffuseColor ), uFlatAmbient );
          float rim = smoothstep( 0.7, 0.76, 1.0 - saturate( dot( geometryNormal, geometryViewDir ) ) );
          reflectedLight.directDiffuse += uToonRim * rim * uToonRimStrength;
        }`,
    },
  });
  // three's physical lighting chunk declares RE_Direct; swap in the cel ramp right after it
  const compile = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    compile(shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_physical_pars_fragment>',
      `#include <lights_physical_pars_fragment>\n${TOON_LIGHT}`,
    );
  };
  return { ...shared, ...uniforms };
}

/**
 * Inverted-hull outline for a skinned mesh: a back-face copy pushed out along the skinned normal by a
 * width that grows a little with distance, so the line stays about a pixel or two wide on screen.
 */
export function addOutline(mesh, { color = '#1b1428', width = 0.0022 } = {}) {
  const material = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  const uWidth = { value: width };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uOutlineWidth = uWidth;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uOutlineWidth;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        { vec3 vn = normalize( normalMatrix * objectNormal );
          mvPosition.xyz += vn * uOutlineWidth * clamp( -mvPosition.z, 0.6, 5.0 );
          gl_Position = projectionMatrix * mvPosition; }`,
      );
  };
  material.customProgramCacheKey = () => 'mori-outline';
  const hull = new THREE.SkinnedMesh(mesh.geometry, material);
  hull.bind(mesh.skeleton, mesh.bindMatrix);
  hull.frustumCulled = false;
  hull.castShadow = false;
  hull.receiveShadow = false;
  mesh.parent.add(hull);
  hull.position.copy(mesh.position);
  hull.quaternion.copy(mesh.quaternion);
  hull.scale.copy(mesh.scale);
  return { hull, uWidth };
}
