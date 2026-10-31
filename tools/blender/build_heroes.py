"""Rebuild the environment kit as baked hero assets (blender-agent-skills recipe 2).

Headless:  blender -b --factory-startup --python tools/blender/build_heroes.py -- tree rocks rune props forest
Each asset: block out with the part generators -> hero() (remesh, detail, procedural material,
decimate, UV, bake BC/N/AO/R+ORM, PBR material, QA) -> web GLB in public/models + .blend in art/blend.
"""
import json
import os
import sys
import time

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lsgen as L  # noqa: E402
import build_ancient_tree  # noqa: E402
import build_props  # noqa: E402
import build_forest_kit  # noqa: E402
import hero as H  # noqa: E402


def adopt(child, parent):
    bpy.context.view_layer.update()
    child.parent = parent
    child.matrix_parent_inverse = parent.matrix_world.inverted()


def kids(node, *prefixes):
    return [o for o in node.children if o.type == "MESH" and o.name.startswith(prefixes)]


def tree():
    build_ancient_tree.build()
    root = bpy.data.objects["AncientTree"]
    rep = {}
    bark = kids(root, "Trunk", "Root_", "Limb_", "Branch_", "Crown_")
    # trunk: vertex colours (bark + moss x baked AO) - organic UVs at this density mosaic badly
    low, rep["bark"] = H.hero("TreeBark", bark, H.mat_bark(), voxel=0.06, tris=22000, smooth=5, samples=64,
                              vcol=build_ancient_tree.bark_color)
    adopt(low, root)
    low, rep["canopy"] = H.hero("TreeCanopy", kids(root, "Canopy_"), H.mat_canopy(), voxel=0.1, tris=12000, res=2048,
                                displace=("VORONOI", 0.6, 0.28), smooth=2, samples=32)
    adopt(low, root)
    low, rep["steps"] = H.hero("TreeSteps", kids(root, "Step_"), H.mat_stone("P_Steps", moss=(1.0, 1.3)), voxel=0.02, tris=1200, res=512)
    adopt(low, root)
    rep["export"] = H.export_web(root, "ancient_tree.glb")
    rep["blend"] = H.save_blend("ancient_tree")
    return rep


def rocks():
    build_props.build_rocks()
    root = bpy.data.objects["MossRocks"]
    rep = {}
    stone = H.mat_stone()
    for name in ("rock_big", "rock_tall", "rock_flat", "rock_small"):
        node = bpy.data.objects[name]
        parts = kids(node, f"{name}_stone", f"{name}_moss", f"{name}_pebble")
        size = max(max(p.dimensions) for p in parts)
        low, rep[name] = H.hero(f"Rock_{name.split('_')[1]}", parts, stone, voxel=max(0.012, size * 0.012), tris=3500,
                                res=1024, detail=f"{size * 0.012:.4f},{size * 0.12:.3f}", samples=48)
        adopt(low, node)
    rep["export"] = H.export_web(root, "moss_rocks.glb")
    rep["blend"] = H.save_blend("moss_rocks")
    return rep


def rune():
    build_props.build_rune_stone()
    root = bpy.data.objects["RuneStone"]
    rep = {}
    parts = kids(root, "Slab", "Pillar", "Step", "Moss_")
    low, rep["stone"] = H.hero("RuneStone", parts, H.mat_stone("P_RuneStone", moss=(0.5, 0.85)), voxel=0.018, tris=6000,
                               res=1024, detail="0.012,0.15", samples=48)
    adopt(low, root)
    rep["export"] = H.export_web(root, "rune_stone.glb")
    rep["blend"] = H.save_blend("rune_stone")
    return rep


def props():
    rep = {}
    build_props.build_lantern_post()
    root = bpy.data.objects["LanternPost"]
    low, rep["post"] = H.hero("PostWood", kids(root, "Post", "Arm", "Brace"), H.mat_wood(), voxel=0.012, tris=1600, res=512, samples=32)
    adopt(low, root)
    rep["post_export"] = H.export_web(root, "lantern_post.glb")
    build_props.build_fence()
    root = bpy.data.objects["Fence"]
    low, rep["fence"] = H.hero("FenceWood", kids(root, "Post0", "Post1", "Rail"), H.mat_wood("P_FenceWood"), voxel=0.014, tris=2200, res=512, samples=32)
    adopt(low, root)
    rep["fence_export"] = H.export_web(root, "fence.glb")
    build_props.build_lily()
    rep["lily"] = H.export_web(bpy.data.objects["Lily"], "lily.glb")
    rep["blend"] = H.save_blend("props")
    return rep


def forest():
    build_forest_kit.build()
    root = bpy.data.objects["ForestKit"]
    rep = {}
    canopy = H.mat_canopy("P_BgCanopy", top=0.8)
    bark = H.mat_bark("P_BgBark", ground=0.4)
    for t in ("tree_a", "tree_b"):
        node = bpy.data.objects[t]
        low, rep[f"{t}_bark"] = H.hero(f"Bg_{t}_bark", kids(node, f"{t}_trunk", f"{t}_limb"), bark, voxel=0.06, tris=2400, res=512, samples=24)
        adopt(low, node)
        low, rep[f"{t}_leaf"] = H.hero(f"Bg_{t}_canopy", kids(node, f"{t}_leaf"), canopy, voxel=0.12, tris=3000, res=1024,
                                       displace=("VORONOI", 0.55, 0.25), smooth=2, samples=24)
        adopt(low, node)
    for b in ("bush_a", "bush_b", "bush_c"):
        node = bpy.data.objects[b]
        low, rep[b] = H.hero(f"Bg_{b}", kids(node, f"{b}_"), canopy, voxel=0.04, tris=1600, res=512,
                             displace=("VORONOI", 0.3, 0.1), smooth=2, samples=24)
        adopt(low, node)
    rep["export"] = H.export_web(root, "forest_kit.glb")
    rep["blend"] = H.save_blend("forest_kit")
    return rep


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else ["tree", "rocks", "rune", "props", "forest"]
    for a in args:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        t0 = time.time()
        rep = globals()[a]()
        rep["seconds"] = round(time.time() - t0, 1)
        print("@@HERO@@", a, json.dumps(rep, default=str), flush=True)
