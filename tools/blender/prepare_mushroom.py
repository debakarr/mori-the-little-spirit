"""Prepare the glowing mushroom cluster for runtime.

Source:  mushroom.glb  (1.25M tris, no material, no UVs)
Output:  public/models/glow_mushroom.glb (~30k tris, vertex-coloured, `_glow` emissive mask)

Run:  blender -b --factory-startup --python tools/blender/prepare_mushroom.py [-- --preview DIR]

Origin is placed on the stem axis at the soil surface so the model can be dropped
straight onto the terrain (the soil block below it sinks into the ground).
"""
import bpy, sys, os, math
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SRC = os.path.join(ROOT, "mushroom.glb")
OUT = os.path.join(ROOT, "public", "models", "glow_mushroom.glb")
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
PREVIEW = argv[argv.index("--preview") + 1] if "--preview" in argv else None

AXIS = np.array([-0.02, -0.06])  # stem axis (X, Y) in the imported Blender space
SOIL_Z = -0.22


def srgb(h):
    c = np.array([int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)])
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


CAP_TOP = srgb("#2f6fd8")
CAP_RIM = srgb("#7fd8ff")
GILLS = srgb("#b9f4ff")
STEM = srgb("#cfe6f2")
MOSS = srgb("#4f7a2c")
MOSS_LIGHT = srgb("#86a63a")
SOIL = srgb("#3b2c20")

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
obj = [o for o in bpy.data.objects if o.type == "MESH"][0]
obj.data.transform(obj.matrix_world); obj.matrix_world = Matrix.Identity(4)
bpy.context.view_layer.objects.active = obj
dec = obj.modifiers.new("dec", "DECIMATE"); dec.ratio = 0.025
bpy.ops.object.modifier_apply(modifier="dec")
me = obj.data
for p in me.polygons:
    p.use_smooth = True
me.update()

nv = len(me.vertices)
P = np.empty(nv * 3); me.vertices.foreach_get("co", P); P = P.reshape(-1, 3)
N = np.empty(nv * 3); me.vertices.foreach_get("normal", N); N = N.reshape(-1, 3)
r = np.hypot(P[:, 0] - AXIS[0], P[:, 1] - AXIS[1])
z = P[:, 2]
rng = np.random.default_rng(3)

col = np.zeros((nv, 3)); glow = np.zeros(nv)

# ground: moss on top-facing surfaces, soil on the sides
up = np.clip(N[:, 2], 0, 1)[:, None]
noise = rng.random(nv)[:, None]
ground = SOIL * (1 - up) + (MOSS * (1 - noise) + MOSS_LIGHT * noise) * up
col[:] = ground

stem = (r < 0.075 + np.clip(SOIL_Z + 0.05 - z, 0, 1) * 0.6) & (z > SOIL_Z - 0.02) & (z < 0.09)
col[stem] = STEM; glow[stem] = 0.25

big_cap = (z > 0.055) & (r < 0.36)
under = big_cap & (N[:, 2] < -0.25)
top = big_cap & ~under
t = np.clip((z - 0.06) / 0.4, 0, 1)[:, None]
col[top] = (CAP_RIM * (1 - t) + CAP_TOP * t)[top]
glow[top] = (0.55 + 0.45 * (1 - t[:, 0]))[top]
col[under] = GILLS; glow[under] = 1.0

# small satellite caps: smooth, up-facing, above the soil and away from the stem
small = (~big_cap) & (~stem) & (z > SOIL_Z + 0.04) & (z < 0.03) & (N[:, 2] > 0.45) & (r < 0.34)
col[small] = (CAP_RIM * 0.6 + CAP_TOP * 0.4); glow[small] = 0.7

ca = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
ca.data.foreach_set("color", np.hstack([col, np.ones((nv, 1))]).ravel())
me.color_attributes.active_color = ca
ga = me.attributes.new("_glow", "FLOAT", "POINT")
ga.data.foreach_set("value", glow.astype(np.float32))

me.transform(Matrix.Translation(Vector((-AXIS[0], -AXIS[1], -SOIL_Z))))
mat = bpy.data.materials.new("Mushroom"); mat.use_nodes = True
vc = mat.node_tree.nodes.new("ShaderNodeVertexColor"); vc.layer_name = "Col"
mat.node_tree.links.new(vc.outputs["Color"], mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"])
me.materials.clear(); me.materials.append(mat)
obj.name = "GlowMushroom"

if PREVIEW:
    sc = bpy.context.scene
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.type = "ORTHO"; cam.data.ortho_scale = 1.2
    sc.render.engine = "BLENDER_WORKBENCH"; sc.display.shading.light = "STUDIO"
    sc.display.shading.color_type = "VERTEX"
    sc.render.resolution_x = sc.render.resolution_y = 500
    for name, loc, rot in [("side", (0, -2, 0.25), (math.pi / 2, 0, 0)),
                           ("q", (1.4, -1.4, 1.2), (math.radians(60), 0, math.radians(45)))]:
        cam.location = loc; cam.rotation_euler = rot
        sc.render.filepath = os.path.join(PREVIEW, f"mush_{name}.png")
        bpy.ops.render.render(write_still=True)

os.makedirs(os.path.dirname(OUT), exist_ok=True)
# blender-export-pipelines web preset (meshopt); keep the custom _glow attribute + vertex colours
sys.path.append(os.path.join(ROOT, ".claude", "skills", "blender-export-pipelines", "scripts"))
import export_asset  # noqa: E402
export_asset.run(preset="web", objects=[obj.name], out=OUT,
                 set=["export_vertex_color=ACTIVE", "export_attributes=True", "export_texcoords=False", "export_animations=False"])
print("EXPORTED", OUT, "tris", sum(len(p.vertices) - 2 for p in me.polygons))
