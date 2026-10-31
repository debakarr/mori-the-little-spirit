"""Lay out the reference sheets as image planes beside each asset in the live scene."""
import bpy
import lsgen as L

LAYOUT = [
    ("01_mori_spirit.png", (-2.5, 1.2, 0), 1.6),
    ("11_mushroom.png", (1.2, 1.2, 0), 1.6),
    ("14_ancient_tree.png", (0, 36, 0), 11.0),
    ("15_moss_rock.png", (-3, 12, 0), 2.6),
    ("22_signpost.png", (8, 11, 0), 2.4),
    ("21_wooden_fence.png", (11, 11, 0), 1.6),
    ("12_flower.png", (14, 9.5, 0), 0.8),
    ("20_stone_ruin.png", (17, 11, 0), 2.4),
    ("18_stream.png", (24, 11, 0), 2.6),
    ("19_grass_patch.png", (29, 11, 0), 2.0),
]


def setup():
    coll = L.collection("LS_References")
    for f, loc, h in LAYOUT:
        L.ref_plane(f, coll, loc, height=h)
    for a in bpy.context.screen.areas:
        if a.type == "VIEW_3D":
            a.spaces[0].shading.type = "MATERIAL"
    return len(LAYOUT)


def frame(names, shading="MATERIAL", hide_cols=True):
    """Frame the given objects (and their children) in every 3D viewport."""
    import bpy
    obs = []
    for n in names:
        ob = bpy.data.objects.get(n)
        if ob:
            obs += [ob] + list(ob.children_recursive)
    for o in bpy.context.view_layer.objects:
        o.select_set(o in obs)
        if hide_cols and o.name.startswith(("COL_", "BOUNCE_")):
            o.hide_set(True)
    for a in bpy.context.screen.areas:
        if a.type == "VIEW_3D":
            a.spaces[0].shading.type = shading
            with bpy.context.temp_override(area=a, region=[r for r in a.regions if r.type == "WINDOW"][0]):
                bpy.ops.view3d.view_selected()
    for o in obs:
        o.select_set(False)
    return len(obs)


def snap(target, path, dist=20.0, elev=0.25, azim=-90.0, height=None, res=(960, 540), lens=40):
    """EEVEE still of an object from a temporary camera (does not touch the user's camera)."""
    import bpy, math
    from mathutils import Vector
    sc = bpy.context.scene
    ob = bpy.data.objects[target]
    bpy.context.view_layer.update()
    pts = [o.matrix_world @ Vector(c) for o in [ob] + list(ob.children_recursive) if o.type == "MESH" and not o.name.startswith(("COL_", "BOUNCE_")) for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    c = (lo + hi) / 2
    if height is not None:
        c.z = height
    cam = bpy.data.objects.get("LS_SnapCam") or bpy.data.objects.new("LS_SnapCam", bpy.data.cameras.new("LS_SnapCam"))
    if cam.name not in sc.collection.objects:
        sc.collection.objects.link(cam)
    cam.data.lens = lens
    a, e = math.radians(azim), elev
    cam.location = c + Vector((math.cos(a) * math.cos(e), math.sin(a) * math.cos(e), math.sin(e))) * dist
    cam.rotation_euler = (c - cam.location).to_track_quat("-Z", "Y").to_euler()
    sun = bpy.data.objects.get("LS_SnapSun")
    if sun is None:
        sun = bpy.data.objects.new("LS_SnapSun", bpy.data.lights.new("LS_SnapSun", "SUN"))
        sc.collection.objects.link(sun)
        sun.data.energy = 4.0
        sun.data.color = (1.0, 0.88, 0.72)
        sun.rotation_euler = (math.radians(50), 0, math.radians(-35))
    if sc.world is None:
        sc.world = bpy.data.worlds.new("LS_World")
    sc.world.use_nodes = True
    bg = sc.world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs["Color"].default_value = (0.42, 0.5, 0.62, 1)
        bg.inputs["Strength"].default_value = 0.9
    prev = (sc.camera, sc.render.engine, sc.render.resolution_x, sc.render.resolution_y, sc.render.filepath)
    hidden = [o for o in sc.objects if o.name.startswith("REF_") and not o.hide_render]
    for o in hidden:
        o.hide_render = True
    sc.camera = cam
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    sc.camera, sc.render.engine, sc.render.resolution_x, sc.render.resolution_y, sc.render.filepath = prev
    for o in hidden:
        o.hide_render = False
    return path


def show_final(models=("ancient_tree", "moss_rocks", "rune_stone", "lantern_post", "fence", "lily", "forest_kit")):
    """Import the exported (baked) runtime GLBs into an LS_Final collection beside the references,
    hiding the earlier vertex-colour blockouts. Nothing is deleted."""
    import bpy, os
    import lsgen as L
    for c in bpy.data.collections:
        if c.name.startswith("LS_") and c.name not in ("LS_References", "LS_Final"):
            lc = bpy.context.view_layer.layer_collection.children.get(c.name)
            if lc:
                lc.hide_viewport = True
    coll = L.collection("LS_Final")
    layout = {"ancient_tree": (0, 30, 0), "moss_rocks": (-6, 8, 0), "rune_stone": (17, 8, 0), "lantern_post": (8, 8, 0),
              "fence": (11, 8, 0), "lily": (14, 8, 0), "forest_kit": (30, 30, 0)}
    out = {}
    for name in models:
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=os.path.join(L.MODELS, f"{name}.glb"))
        new = [o for o in bpy.data.objects if o not in before]
        for o in new:
            for c in list(o.users_collection):
                c.objects.unlink(o)
            coll.objects.link(o)
            if o.name.startswith(("COL_", "BOUNCE_")):
                o.hide_set(True)
            if o.parent is None:
                o.location = layout.get(name, (0, 0, 0))
        out[name] = len(new)
    return out
