"""Prepare the painted grass-patch diorama (grass.glb) for runtime.

Source:  grass.glb  (2M tris, 8K textures, UVs; round patch ~1 m wide, 0.2 m tall, centred at z=0)
Output:  public/models/grass_patch.glb  (~12k tris, 2K base colour, base at origin)

Run:  blender -b --factory-startup --python tools/blender/prepare_grass_patch.py

blender-workflow-recipes #5 (AI asset cleanup): weld, decimate, QA, web export.
The game places it as a decorative patch, sunk so its soil disc sits just under the terrain.
"""
import bpy, bmesh, os, sys
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SKILLS = os.path.join(ROOT, ".claude", "skills")
for s in ("blender-asset-qa", "blender-export-pipelines"):
    sys.path.append(os.path.join(SKILLS, s, "scripts"))
import qa_check  # noqa: E402
import export_asset  # noqa: E402

SRC = os.path.join(ROOT, "grass.glb")
OUT = os.path.join(ROOT, "public", "models", "grass_patch.glb")
TRIS = 12000

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o)
bpy.ops.import_scene.gltf(filepath=SRC)
ob = next(o for o in bpy.data.objects if o.type == "MESH")
ob.data.transform(ob.matrix_world)
ob.matrix_world = Matrix.Identity(4)
ob.name = ob.data.name = "GrassPatch"
me = ob.data

bm = bmesh.new()
bm.from_mesh(me)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
bm.to_mesh(me)
bm.free()
dec = ob.modifiers.new("Decimate", "DECIMATE")
dec.ratio = TRIS / max(1, sum(len(p.vertices) - 2 for p in me.polygons))
with bpy.context.temp_override(object=ob, active_object=ob, selected_objects=[ob], selected_editable_objects=[ob]):
    assert bpy.ops.object.modifier_apply(modifier=dec.name) == {"FINISHED"}
for p in me.polygons:
    p.use_smooth = True

# origin: centre of the footprint, at the top of the soil disc (median height of up-facing
# verts in the inner area), so placing it at terrain height buries only the base
P = np.empty(len(me.vertices) * 3)
me.vertices.foreach_get("co", P)
P = P.reshape(-1, 3)
N = np.empty(len(me.vertices) * 3)
me.vertices.foreach_get("normal", N)
N = N.reshape(-1, 3)
cx, cy = (P[:, 0].min() + P[:, 0].max()) / 2, (P[:, 1].min() + P[:, 1].max()) / 2
inner = (np.hypot(P[:, 0] - cx, P[:, 1] - cy) < 0.3) & (N[:, 2] > 0.8)
ground = float(np.median(P[inner, 2])) if inner.any() else float(P[:, 2].min())
me.transform(Matrix.Translation(Vector((-cx, -cy, -ground))))
me.update()
print("@@GROUND", round(ground, 3), "depth below", round(ground - P[:, 2].min(), 3))

mat = me.materials[0]
mat.name = "M_GrassPatch"
for n in mat.node_tree.nodes:
    if n.type == "TEX_IMAGE":
        n.image.scale(*((2048, 2048) if n.image.colorspace_settings.name == "sRGB" else (1024, 1024)))

qa = qa_check.run(objects=[ob.name], profile="render")
print("@@QA", qa.get("pass"), len(qa.get("errors") or []), "issues", "tris", sum(len(p.vertices) - 2 for p in me.polygons),
      "dims", tuple(round(d, 3) for d in ob.dimensions))
export_asset.run(preset="web", objects=[ob.name], out=OUT, set=["export_animations=False"])
print("@@EXPORT", OUT, os.path.getsize(OUT) // 1024, "KB")
