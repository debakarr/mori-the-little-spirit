import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/** Restrained post: HDR bloom for magic glows, a gentle warm grade and vignette, then tone mapping. */
export function createPostFX(renderer, scene, camera) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.55, 0.55, 0.92);
  composer.addPass(bloom);
  composer.addPass(new ShaderPass({
    uniforms: { tDiffuse: { value: null } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse; varying vec2 vUv;
      void main() {
        vec4 c = texture2D(tDiffuse, vUv);
        float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
        c.rgb = mix(vec3(l), c.rgb, 1.08);
        c.rgb *= vec3(1.03, 1.0, 0.96);
        c.rgb += vec3(0.008, 0.006, 0.0);
        vec2 d = (vUv - 0.5) * vec2(1.1, 1.0);
        c.rgb *= mix(0.74, 1.0, smoothstep(0.82, 0.25, length(d)));
        gl_FragColor = c;
      }`,
  }));
  composer.addPass(new OutputPass());
  return {
    composer,
    bloom,
    /** CSS pixels; the composer applies the renderer's pixel ratio itself. */
    setSize(w, h) {
      composer.setSize(w, h);
    },
    render() {
      composer.render();
    },
  };
}
