# Little Spirit — Whispers of the Grove

A cozy 3D forest where you play Mori, a little forest spirit who can become a fox or a bird. No missions,
no timers, nothing to fail: walk, run, fly, perch, sit on a rock and watch the butterflies. Three.js + Rapier + Vite.

**The world** (~240 m across, ringed by mountains): the Whispering Grove with the ancient tree at the centre;
forested hills around it; a river from **Whisper Falls** at the mountains' feet, through the grove, into
**Mirror Lake** (shallow enough to wade, stepping stones out to a flat rock); **Mushroom Hollow**, a dell of
giant glowing mushrooms with bouncy caps; **Windy Overlook**, a plateau with a ring of standing stones; and
**Sunny Meadow** in bloom. Dirt trails link them all.

**Things to do, if you like:** 40 wisps of spirit light rest all over the world (on rocks, mushroom caps,
the tree tops, over the water, behind the falls: some need wings or a bounce). Five dormant shrines wait in
the far places, and only Mori's spirit form can wake them. A woken shrine lights its place and its wisps shine
brighter, and waking all five makes the grove celebrate. The fox can sniff out the nearest wisp (F). Each
place's name drifts in the first time you arrive. Progress is part of the save.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/ (GitHub Pages: .github/workflows/deploy.yml)
```

**Controls:** WASD move · mouse look (click to capture) · Space jump · Shift run · 1 / 2 / 3 spirit, fox, bird (Q cycles) · E interact, sit, rest, wake a shrine · F sniff (fox) · Esc pause · M sound · H hints · wheel zoom.
**Bird:** Space takes off and climbs (tap for a single wingbeat) · release to glide · C or Ctrl dives · Shift flies faster · touch down on anything (rocks, the lantern roofs, the top of the ancient tree) to perch.

The title menu has New Game, Continue (when a save exists), Settings (master and music volume, mouse sensitivity, graphics quality) and Credits. Settings and one save slot (position, facing, form, wisps and shrines; written every few seconds and on pause) live in the browser's localStorage.

## Code map

| Path | What |
|---|---|
| `src/main.js` | boot, game loop, pause and save, adaptive resolution, interaction prompts, seats, Mori's glances and dozing |
| `src/world/` | the world's layout, height (one 0.5 m grid shared by the terrain mesh, the Rapier heightfield and the grass) and ground colour, plus where trees and grass grow (`terrain.js`); river, lake, falls pool and waterfall (`water.js`; `water.js`: caustics by area-ratio splatting, sun glints and depth absorption, adapted from [Ultra-Water](https://github.com/Humpalumps/Ultra-Water), MIT), light/sky and shadows that follow Mori (`lighting.js`), grass that travels with the player and the leaf fringe (`vegetation.js`), asset placement and static batching (`createWorld.js`, `assetKit.js`), the forest (`forest.js` places it; `megakit.js` draws it: near trees as geometry, far ones as billboards baked at load), the far places with their shrines and wisp spots (`areas.js`) |
| `src/player/` | Rapier character controller with bird flight (`PlayerController.js`), clip-based animation (`CharacterAnimator.js`: AnimationMixer + procedural lean/tail/ears; `BirdAnimator.js`: hop, flap/glide blend, pitch and bank), Mori model setup, anime cel shading + ink outline (`toonMaterial.js`), forms and the change between them (`Forms.js`) |
| `src/camera/FollowCamera.js` | third-person orbit camera with collision; pulls back and widens in flight |
| `src/effects/` | fireflies/spores/leaves/god rays, butterflies that come to circle Mori (`Butterflies.js`), bloom + grade |
| `src/gameplay/Spirits.js` | wisps, shrines, the fox's sniffing, place names, the celebration; save state |
| `src/ui/ControlsOverlay.js`, `src/core/Storage.js` | title / pause / settings / credits menus, form HUD, wisp and shrine counters, place titles, hints; settings and the save slot |
| `src/audio/Ambience.js` | Web Audio mix: calm music, birds-and-wind and a stream loop that swells near the water (CC0 tracks below), plus synthesized steps and chimes |

## Asset pipeline (Blender 5.2)

Source models in the repo root are never modified; runtime GLBs are written to `public/models/`.

```bash
npm run assets   # rebuild every runtime model headless
```

- `tools/blender/prepare_mori_new.py -- --unrigged art/mesh2motion/mori_unrigged.glb` — the painted Mori sculpt (`mori-new.glb`, 2M tris) → 40k tris, 2K textures and an emissive map pulled from the painted cyan.
- `tools/blender/rig_mori_mesh2motion.py` — rigs that mesh with [mesh2motion](https://app.mesh2motion.org/)'s fox skeleton and animates it with its fox clip library (CC0, `art/mesh2motion/fox-animations.glb`): the skeleton is fitted in the fox's Sit pose (the sculpt sits), clips are retargeted onto a crouched chibi stance with feet kept on the ground → `mori.glb` (Idle, Idle Alert, Walk, Run, Sit, Howl, Fall, Jump, Sneak). Skin weights come from `art/mesh2motion/mori_arp_weights.npz` when present, and the mesh gets smoothed normals for the cel shading (`toon_mori.py`).
- `tools/blender/prepare_fox.py` + `rig_mori_mesh2motion.py -- --form fox` — the fox form (`fox-mori.glb`, painted) → `fox.glb`: same skeleton and clips, bound in the template's standing rest pose.
- `tools/decode_glb.mjs` + `tools/blender/prepare_bird.py` + `rig_mori_mesh2motion.py -- --form bird` — the bird form (`mori-bird.glb`, painted; meshopt-compressed, so it is decoded to `art/blend/` first, which Blender's importer needs) → `bird.glb`: mesh2motion's bird skeleton and clips (CC0, `art/mesh2motion/bird-animations.glb`: Idle, Walk, Flap, Glide), its joints fitted to the upright chibi bird with the wings mapped along their span; flight clips are not foot-pinned.
- `tools/blender/prepare_megakit.py` — Quaternius' [Stylized Nature MegaKit](https://quaternius.itch.io/stylized-nature-megakit) (CC0; download steps in `art/megakit_src/README.md`) → `megakit.glb`: 28 trees, bushes, ferns, flowers, rocks and pebbles in one file with shared materials, smaller textures, the autumn-red leaf variant swapped for the tintable mask, and the kit's AO vertex colour softened.
- `tools/blender/arp_weights_mori.py` — run in a live Blender with [Auto-Rig Pro](https://lucky3d.fr/auto-rig-pro/doc/index.html) (`python3 tools/blender/mcp_run.py --file tools/blender/arp_weights_mori.py`): fits ARP's dog rig to Mori, binds a watertight voxel copy with ARP's heat map (the raw sculpt's overlapping fur shells defeat bone heat) and writes those weights, mapped onto the game skeleton, to `mori_arp_weights.npz`.
- `tools/blender/toon_mori.py` — smoothed normals for the game's cel shading, plus a Blender look-dev preview (Shader-to-RGB ramp, rim, inverted-hull outline).
- `tools/anim-preview.html` — dev-only animation preview (speed slider, emotes, fixed camera): `http://localhost:5173/tools/anim-preview.html`.
- `tools/blender/prepare_mushroom_new.py` — the painted mushroom cluster (`mushroom-new.glb`) → 24k tris + glow map → `glow_mushroom.glb`.
- `tools/blender/prepare_grass_patch.py` — the painted grass/flower patch (`grass.glb`) → 12k tris → `grass_patch.glb`, scattered as ground clumps.
- `tools/blender/prepare_stream_pool.py` — the painted pool diorama (`stream.glb`, 2M tris) → 24k tris + convex hulls around its boulders → `stream_pool.glb`, set into the stream's bend with the live water surface over its painted water.
- `prepare_mori.py` / `prepare_mushroom.py` — the earlier versions built from the untextured FBX / first mushroom (kept for reference).
- `tools/blender/build_heroes.py` — the environment kit, modelled against the reference sheets in
  `little_spirit_assets_24_individual_pngs/` and baked with the
  [blender-agent-skills](https://github.com/EL4CTEO/blender-skills) scripts (installed in `.claude/skills/`):
  voxel remesh + sculpt detail → procedural Cycles materials → UV → decimate → bake BC/N/AO/R (ORM) → QA → web GLB.
- `tools/blender/mcp_run.py "<expr>"` runs any build step inside a live Blender session through the Blender MCP add-on (port 9876).

## Asset credits

- Forest trees, plants, rocks: [Stylized Nature MegaKit](https://quaternius.com/packs/stylizednaturemegakit.html) by Quaternius (CC0)
- Fox and bird skeletons and animation clips: [Mesh2Motion](https://github.com/scottpetrovic/mesh2motion-app) by Scott Petrovic (CC0)

## Dev log

- **Forms:** spirit and fox (mesh2motion fox rig, Auto-Rig Pro weights for the spirit), then the bird (mesh2motion bird rig) with a real flight controller: takeoff, climb, glide, dive, soft ceiling, perching on any surface; the ancient tree's upper crown is solid so flights go under it or land on top rather than through a wall of leaves.
- **World:** the Blender-built background trees were replaced by MegaKit trees, undergrowth and rocks drawn as instanced meshes (~44 draw calls); the clearing got ferns, flower clumps, clover, bank plants and pebbles. Steady 60 fps in the dev browser at 1.5× pixel ratio.
- **Presentation:** title menu with Continue, settings (volumes, sensitivity, quality: Low drops bloom and sun shadows and renders at 0.8× pixel ratio), pause on Esc or when pointer lock is released, form HUD, a flight-controls toast, butterflies, seats on two rocks and by the tree, Mori glancing at nearby things and dozing after a long rest.
- **Bigger world:** the grove became the centre of a ~240 m valley (heightfield physics, one height grid for terrain/physics/grass), a river with falls and a lake, four new places, trails, mountains beyond the walkable ring, ~700 MegaKit trees (real geometry within 40 m, baked billboards out to 260 m, trunk colliders), undergrowth that appears near the camera, and grass that travels with Mori. Wisps, shrines and the fox's nose give it optional goals.
- **Fixes:** the bird's head no longer spins (its look-around turn compounded every frame on bones the mixer didn't rewrite); its resting wings close only part way instead of folding into spikes; Mori no longer walks through tree trunks; the invisible wall around the grove is gone.
- **Performance:** in the dev browser (727×683 window, 1.5× pixel ratio) a frame takes 13–16 ms on the GPU; bloom is ~4.5 ms of that (pass count, not pixels: it runs at a quarter resolution now). Resolution adapts down when frames run long. Not yet measured on other machines.
- **Known gaps:** the fox still uses distance weights (no Auto-Rig Pro pass yet); shadows only cover ~28 m around Mori; the far mountains are coarse geometry seen through haze.

## Audio credits

All CC0 (public domain) from OpenGameArt; credit given as thanks. `tools/blender/prepare_audio.py` turns the originals in `art/audio_src/` into the loops in `public/audio/`.

- Music: [Forest Ambience](https://opengameart.org/content/forest-ambience) by TinyWorlds
- Birds and wind: [Birds and Wind - Ambient](https://opengameart.org/content/birds-and-wind-ambient-birds-wind-and-synth) by Spring Spring
- Stream: [Sea and river wave sounds](https://opengameart.org/content/sea-and-river-wave-sounds) by RandomMind
