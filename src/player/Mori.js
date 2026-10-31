import * as THREE from 'three';
import { patchMaterial } from '../core/shaders.js';
import { blobShadowTexture } from '../core/textures.js';
import { CharacterAnimator } from './CharacterAnimator.js';

/**
 * Mori in spirit form: the painted model from public/models/mori.glb, rigged and animated with
 * mesh2motion's fox skeleton and clips (tools/blender/rig_mori_mesh2motion.py). Its glow comes
 * from an emissive map extracted from the painted cyan; we add a soft cyan rim light and a contact shadow.
 */
export function createMori(gltf) {
  const object = new THREE.Group();
  object.name = 'Mori';
  const visual = new THREE.Group();
  object.add(visual);
  const model = gltf.scene;
  visual.add(model);

  let material = null;
  model.traverse((o) => {
    if (o.isMesh) {
      material = o.material;
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false;
    }
  });

  material.metalness = 0;
  material.emissive.set('#ffffff');
  const uniforms = patchMaterial(material, { rim: { color: '#8ff3ff', strength: 0.22, power: 3.2 } });
  /** Glow pulse: scales the painted emissive map (tail, ear tips, hood accents). */
  const setGlow = (v) => { material.emissiveIntensity = v; };
  setGlow(2.5);

  const animator = new CharacterAnimator(model, visual, gltf.animations);

  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: blobShadowTexture(), transparent: true, depthWrite: false }),
  );
  shadow.renderOrder = 1;

  let tailBone = null;
  model.traverse((o) => { if (o.isBone && o.name === 'Tail_Tip') tailBone = o; });

  return { object, visual, model, animator, uniforms, setGlow, shadow, tailBone };
}
