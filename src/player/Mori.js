import * as THREE from 'three';
import { blobShadowTexture } from '../core/textures.js';
import { CharacterAnimator } from './CharacterAnimator.js';
import { BirdAnimator } from './BirdAnimator.js';
import { addOutline, toonMaterial } from './toonMaterial.js';

/**
 * One of Mori's bodies (spirit: public/models/mori.glb, fox: fox.glb, bird: bird.glb), rigged and
 * animated with mesh2motion's fox (or bird) skeleton and clips (tools/blender/rig_mori_mesh2motion.py). It is cel shaded with
 * an ink outline (toonMaterial.js); its glow comes from an emissive map extracted from the painted cyan.
 */
export function createMori(gltf, name = 'Mori') {
  const object = new THREE.Group();
  object.name = name;
  const visual = new THREE.Group();
  object.add(visual);
  const model = gltf.scene;
  visual.add(model);

  let material = null;
  let skinned = null;
  model.traverse((o) => {
    if (o.isMesh) {
      material = o.material;
      skinned = o;
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false;
    }
  });

  material.emissive.set('#ffffff');
  const uniforms = toonMaterial(material);
  const outline = addOutline(skinned);
  /** Glow pulse: scales the painted emissive map (tail, ear tips, hood accents). */
  const setGlow = (v) => { material.emissiveIntensity = v; };
  setGlow(2.5);

  const bird = gltf.animations.some((c) => c.name === 'Flap');
  const animator = bird ? new BirdAnimator(model, visual, gltf.animations) : new CharacterAnimator(model, visual, gltf.animations);

  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: blobShadowTexture(), transparent: true, depthWrite: false }),
  );
  shadow.renderOrder = 1;

  let tailBone = null;
  model.traverse((o) => { if (o.isBone && (o.name === 'Tail_Tip' || o.name === 'tail_tip')) tailBone = o; });

  /** Form-change look: flash to spirit light, dissolve away (0..1 each); the outline hides meanwhile. */
  const setChange = (flash, dissolve) => {
    uniforms.uFlash.value = flash;
    uniforms.uDissolve.value = dissolve;
    outline.hull.visible = dissolve < 0.02 && flash < 0.5;
  };

  return { object, visual, model, animator, uniforms, outline, setGlow, setChange, shadow, tailBone };
}
