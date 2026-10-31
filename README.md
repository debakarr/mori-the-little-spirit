# Little Spirit — Whispers of the Grove (first playable)

A tiny cozy 3D clearing where you play Mori, a little forest spirit. Three.js + Rapier + Vite.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/ (GitHub Pages: .github/workflows/deploy.yml)
```

**Controls:** WASD move · mouse look (click to capture) · Space jump · Shift run · E interact · M sound · H hints · wheel zoom.

## Code map

| Path | What |
|---|---|
| `src/main.js` | boot, game loop, interaction prompts |
| `src/world/` | terrain + stream (`terrain.js`; `water.js`: caustics by area-ratio splatting, sun glints and depth absorption, adapted from [Ultra-Water](https://github.com/Humpalumps/Ultra-Water), MIT), light/sky (`lighting.js`), grass + leaf fringe (`vegetation.js`), asset placement and static batching (`createWorld.js`, `assetKit.js`) |
| `src/player/` | Rapier character controller, clip-based animation (AnimationMixer + procedural lean/tail/ears), Mori model setup |
| `src/camera/FollowCamera.js` | third-person orbit camera with collision |
| `src/effects/` | fireflies/spores/leaves/god rays, bloom + grade |
| `src/audio/Ambience.js` | Web Audio mix: calm music, birds-and-wind and a stream loop that swells near the water (CC0 tracks below), plus synthesized steps and chimes |

## Asset pipeline (Blender 5.2)

Source models in the repo root are never modified; runtime GLBs are written to `public/models/`.

```bash
npm run assets   # rebuild every runtime model headless
```

- `tools/blender/prepare_mori_new.py -- --unrigged art/mesh2motion/mori_unrigged.glb` — the painted Mori sculpt (`mori-new.glb`, 2M tris) → 40k tris, 2K textures and an emissive map pulled from the painted cyan.
- `tools/blender/rig_mori_mesh2motion.py` — rigs that mesh with [mesh2motion](https://app.mesh2motion.org/)'s fox skeleton and animates it with its fox clip library (CC0, `art/mesh2motion/fox-animations.glb`): the skeleton is fitted in the fox's Sit pose (the sculpt sits), clips are retargeted onto a crouched chibi stance with feet kept on the ground → `mori.glb` (Idle, Idle Alert, Walk, Run, Sit, Howl, Fall, Jump, Sneak).
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

## Audio credits

All CC0 (public domain) from OpenGameArt; credit given as thanks. `tools/blender/prepare_audio.py` turns the originals in `art/audio_src/` into the loops in `public/audio/`.

- Music: [Forest Ambience](https://opengameart.org/content/forest-ambience) by TinyWorlds
- Birds and wind: [Birds and Wind - Ambient](https://opengameart.org/content/birds-and-wind-ambient-birds-wind-and-synth) by Spring Spring
- Stream: [Sea and river wave sounds](https://opengameart.org/content/sea-and-river-wave-sounds) by RandomMind
