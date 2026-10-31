"""Prepare the painted glow-mushroom cluster (mushroom-new.glb) for runtime.

Source:  mushroom-new.glb  (2M tris, 8K base colour + metal/rough, UVs; 1 m cube, base at z=-0.5)
Output:  public/models/glow_mushroom.glb  (~24k tris, 2K base colour + emissive glow map, base at origin)

Run:  blender -b --factory-startup --python tools/blender/prepare_mushroom_new.py

blender-workflow-recipes #5 (AI asset cleanup): weld, decimate to budget, QA, web export.
The emissive map lights the warm gills/stems strongly and the blue caps softly.
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

SRC = os.path.join(ROOT, "mushroom-new.glb")
OUT = os.path.join(ROOT, "public", "models", "glow_mushroom.glb")
TRIS = 24000

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o)
bpy.ops.import_scene.gltf(filepath=SRC)
ob = next(o for o in bpy.data.objects if o.type == "MESH")
ob.data.transform(ob.matrix_world)
ob.matrix_world = Matrix.Identity(4)
ob.name = ob.data.name = "GlowMushroom"
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

# base centre on the origin (stem axis from the vertices near the ground)
P = np.empty(len(me.vertices) * 3)
me.vertices.foreach_get("co", P)
P = P.reshape(-1, 3)
zmin = P[:, 2].min()
foot = P[P[:, 2] < zmin + 0.06]
me.transform(Matrix.Translation(Vector((-foot[:, 0].mean(), -foot[:, 1].mean(), -zmin))))
me.update()

mat = me.materials[0]
mat.name = "M_GlowMushroom"
nt = mat.node_tree
bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
texs = [n for n in nt.nodes if n.type == "TEX_IMAGE"]
bc = next(n for n in texs if n.image.colorspace_settings.name == "sRGB").image
bc.scale(2048, 2048)
for n in texs:
    if n.image is not bc:
        n.image.scale(1024, 1024)
px = np.empty(2048 * 2048 * 4, dtype=np.float32)
bc.pixels.foreach_get(px)
px = px.reshape(-1, 4)
r, g, b = px[:, 0], px[:, 1], px[:, 2]
lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
warm = np.clip((lum - 0.45) * 3.0, 0, 1) * np.clip(1.2 - (b - r) * 4.0, 0, 1)   # pale gills / stems
blue = np.clip((b - r - 0.12) * 3.0, 0, 1) * 0.35                                # caps, soft
mask = np.maximum(warm, blue)
em = np.zeros_like(px)
em[:, :3] = px[:, :3] * mask[:, None]
em[:, 3] = 1
emi = bpy.data.images.new("GlowMushroom_Emissive", 2048, 2048)
emi.pixels.foreach_set(em.ravel())
emi.pack()
en = nt.nodes.new("ShaderNodeTexImage")
en.image = emi
nt.links.new(en.outputs["Color"], bsdf.inputs["Emission Color"])
bsdf.inputs["Emission Strength"].default_value = 1.0
print("@@GLOW warm", round(float((warm > 0.3).mean()), 3), "blue", round(float((blue > 0.1).mean()), 3))

qa = qa_check.run(objects=[ob.name], profile="render")
print("@@QA", qa.get("pass"), (qa.get("errors") or [])[:3], "tris", sum(len(p.vertices) - 2 for p in me.polygons),
      "dims", tuple(round(d, 3) for d in ob.dimensions))
export_asset.run(preset="web", objects=[ob.name], out=OUT, set=["export_animations=False"])
print("@@EXPORT", OUT, os.path.getsize(OUT) // 1024, "KB")
