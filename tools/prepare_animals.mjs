// Wildlife for the forest: Quaternius' Ultimate Animated Animal Pack (CC0) deer and stag, glTF with
// embedded buffers (art/animals_src/, see its README) -> compact GLBs in public/models/ with only the
// gentle clips (no attacks, hits or deaths: nothing is ever hurt here).
// Usage: node tools/prepare_animals.mjs
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, resample, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

const KEEP = new Set(['Idle', 'Idle_2', 'Idle_Headlow', 'Eating', 'Walk', 'Gallop', 'Gallop_Jump', 'Jump_toIdle']);
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
for (const [src, out] of [['Deer', 'deer'], ['Stag', 'stag']]) {
  const doc = await io.read(`art/animals_src/${src}.gltf`);
  for (const anim of doc.getRoot().listAnimations()) if (!KEEP.has(anim.getName())) anim.dispose();
  // drop redundant keyframes, then meshopt-compress (the game's GLTFLoader has the decoder)
  await doc.transform(dedup(), prune(), resample(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write(`public/models/${out}.glb`, doc);
  console.log(out, doc.getRoot().listAnimations().map((a) => a.getName()).join(', '));
}
