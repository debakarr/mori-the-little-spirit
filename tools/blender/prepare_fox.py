"""Prepare the painted fox-form Mori (fox-mori.glb) for rigging.

Source:  fox-mori.glb  (2M tris, 8K base colour + metal/rough, UVs; standing, faces -Y, nose at y=-0.5,
         a big cyan flame tail curling up behind)
Output:  art/mesh2motion/fox_unrigged.glb  (40k tris, 2K base colour + painted-glow emissive map, paws
         on the origin under the body centre, FOX_HEIGHT tall), rigged by rig_fox_mesh2motion.py

Run:  blender -b --factory-startup --python tools/blender/prepare_fox.py [-- --debug DIR]

Same cleanup as prepare_mori_new.py (blender-workflow-recipes #5): weld, drop duplicate shells,
decimate to budget, shrink textures, glow mask from the painted cyan.
"""
import bpy, bmesh, os, sys, math
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SKILLS = os.path.join(ROOT, ".claude", "skills")
sys.path.append(os.path.join(SKILLS, "blender-asset-qa", "scripts"))
import qa_check  # noqa: E402

SRC = os.path.join(ROOT, "fox-mori.glb")
OUT = os.path.join(ROOT, "art", "mesh2motion", "fox_unrigged.glb")
TRIS = 40000
FOX_HEIGHT = 0.8   # ear tips; the spirit form is 0.75 m, the fox reads a little bigger
BODY_Y = -0.2      # source y of the body centre (between front and back paws): becomes the pivot
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
DEBUG = argv[argv.index("--debug") + 1] if "--debug" in argv else None

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o)
bpy.ops.import_scene.gltf(filepath=SRC)
ob = next(o for o in bpy.data.objects if o.type == "MESH")
ob.data.transform(ob.matrix_world)
ob.matrix_world = Matrix.Identity(4)
ob.name = ob.data.name = "Fox"
me = ob.data

bm = bmesh.new()
bm.from_mesh(me)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
seen, dupes = set(), []
for f in bm.faces:
    key = frozenset(v.index for v in f.verts)
    if key in seen:
        dupes.append(f)
    seen.add(key)
bmesh.ops.delete(bm, geom=dupes, context="FACES")
bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-6)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
print("@@CLEAN duplicate faces removed", len(dupes))
bm.to_mesh(me)
bm.free()
dec = ob.modifiers.new("Decimate", "DECIMATE")
dec.ratio = TRIS / max(1, sum(len(p.vertices) - 2 for p in me.polygons))
with bpy.context.temp_override(object=ob, active_object=ob, selected_objects=[ob], selected_editable_objects=[ob]):
    assert bpy.ops.object.modifier_apply(modifier=dec.name) == {"FINISHED"}
for p in me.polygons:
    p.use_smooth = True

# ---- textures: 2K base colour, 1K metal/rough, emissive = base colour where it is painted cyan
mat = me.materials[0]
nt = mat.node_tree
bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
texs = [n for n in nt.nodes if n.type == "TEX_IMAGE"]
bc_node = next(n for n in texs if n.image.colorspace_settings.name == "sRGB")
bc = bc_node.image
bc.scale(2048, 2048)
for n in texs:
    if n is not bc_node:
        n.image.scale(1024, 1024)
px = np.empty(2048 * 2048 * 4, dtype=np.float32)
bc.pixels.foreach_get(px)
px = px.reshape(-1, 4)
r, g, b = px[:, 0], px[:, 1], px[:, 2]
cyan = np.clip(((g + b) * 0.5 - r - 0.06) * 4.0, 0, 1) * np.clip((np.maximum(g, b) - 0.18) * 3.0, 0, 1)
em = np.zeros_like(px)
em[:, :3] = px[:, :3] * cyan[:, None]
em[:, 3] = 1
emi = bpy.data.images.new("Fox_Emissive", 2048, 2048)
emi.pixels.foreach_set(em.ravel())
emi.pack()
en = nt.nodes.new("ShaderNodeTexImage")
en.image = emi
nt.links.new(en.outputs["Color"], bsdf.inputs["Emission Color"])
bsdf.inputs["Emission Strength"].default_value = 1.0
mat.name = "M_Fox"
print("@@GLOW coverage", round(float((cyan > 0.3).mean()), 3))

# ---- paws on the origin under the body centre, scaled to FOX_HEIGHT
zmin = min(v.co.z for v in me.vertices)
s = FOX_HEIGHT / (ob.dimensions.z or 1.0)
me.transform(Matrix.Scale(s, 4) @ Matrix.Translation((0, -BODY_Y, -zmin)))
me.update()

qa = qa_check.run(objects=["Fox"], profile="game")
print("@@QA", qa.get("pass"), (qa.get("errors") or [])[:3], "tris", sum(len(p.vertices) - 2 for p in me.polygons),
      "dims", tuple(round(d, 3) for d in ob.dimensions))

if DEBUG:  # gridded ortho views (10 cm grid) to read joint landmarks off
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.display.shading.light = "STUDIO"
    sc.display.shading.color_type = "TEXTURE"
    sc.render.resolution_x = sc.render.resolution_y = 600
    grid = bpy.data.objects.new("grid", bpy.data.meshes.new("grid"))
    gb = bmesh.new()
    for i in range(-10, 11):  # three axis-aligned grids through the paws' origin
        t = i * 0.1
        for p, q in (((t, -1, 0), (t, 1, 0)), ((-1, t, 0), (1, t, 0)), ((t, 0, -0.2), (t, 0, 1.2)), ((-1, 0, t + 0.5), (1, 0, t + 0.5)),
                     ((0, t, -0.2), (0, t, 1.2)), ((0, -1, t + 0.5), (0, 1, t + 0.5))):
            gb.edges.new((gb.verts.new(p), gb.verts.new(q)))
    gb.to_mesh(grid.data)
    gb.free()
    sc.collection.objects.link(grid)
    grid.modifiers.new("skin", "SKIN")
    for v in grid.data.skin_vertices[0].data:
        v.radius = (0.0015, 0.0015)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam.data.type, cam.data.ortho_scale = "ORTHO", 1.3
    for name, loc, rot in (("side", (3, 0, 0.4), (math.pi / 2, 0, math.pi / 2)), ("front", (0, -3, 0.4), (math.pi / 2, 0, 0)),
                           ("top", (0, 0, 3), (0, 0, 0))):
        cam.location, cam.rotation_euler = loc, rot
        sc.render.filepath = os.path.join(DEBUG, f"fox_grid_{name}.png")
        bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(grid)
    bpy.data.objects.remove(cam)

with bpy.context.temp_override(selected_objects=[ob], active_object=ob):
    bpy.ops.export_scene.gltf(filepath=OUT, use_selection=True, export_format="GLB", export_image_format="JPEG",
                              export_animations=False, export_yup=True)
print("@@EXPORT", OUT, os.path.getsize(OUT) // 1024, "KB")
