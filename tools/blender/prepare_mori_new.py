"""Prepare the painted Mori sculpt (mori-new.glb) as the runtime hero character.

Source:  mori-new.glb  (2M tris, 8K base colour + metal/rough, UVs, no normals, no rig; faces -Y)
Output:  public/models/mori.glb  (~40k tris, 2K textures + painted-glow emissive map,
         12-bone rig matching src/player/CharacterAnimator.js, feet at origin, 0.75 m tall)

Run:  blender -b --factory-startup --python tools/blender/prepare_mori_new.py [-- --debug DIR]

Follows blender-workflow-recipes #5 (cleaning AI-generated assets): weld, decimate to budget,
QA, then rig (envelope weights from anatomy landmarks) and export with the web preset.
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

SRC = os.path.join(ROOT, "mori-new.glb")
OUT = os.path.join(ROOT, "public", "models", "mori.glb")
TRIS = 40000
HEIGHT = 0.75
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
DEBUG = argv[argv.index("--debug") + 1] if "--debug" in argv else None
UNRIGGED = argv[argv.index("--unrigged") + 1] if "--unrigged" in argv else None

# Anatomy in the source's space (faces -Y, tail toward -X/+Y, Z up, -0.5..0.5 tall).
# name: (head, tail, parent, envelope radius) - same bone names as the first Mori rig.
BONES = {
    "body":   ((0.04, 0.06, -0.36), (0.04, -0.10, -0.22), None, 0.13),
    "head":   ((0.04, -0.06, -0.21), (0.04, -0.08, 0.25), "body", 0.24),
    "ear_L":  ((-0.17, -0.10, 0.27), (-0.26, -0.18, 0.47), "head", 0.07),
    "ear_R":  ((0.26, -0.10, 0.27), (0.37, -0.18, 0.47), "head", 0.07),
    "leg_FL": ((-0.06, -0.18, -0.24), (-0.06, -0.21, -0.49), "body", 0.07),
    "leg_FR": ((0.14, -0.18, -0.24), (0.14, -0.21, -0.49), "body", 0.07),
    "leg_BL": ((-0.14, 0.06, -0.30), (-0.14, 0.04, -0.49), "body", 0.08),
    "leg_BR": ((0.22, 0.06, -0.30), (0.22, 0.04, -0.49), "body", 0.08),
    "tail_1": ((-0.05, 0.18, -0.38), (-0.22, 0.28, -0.36), "body", 0.08),
    "tail_2": ((-0.22, 0.28, -0.36), (-0.36, 0.34, -0.28), "tail_1", 0.10),
    "tail_3": ((-0.36, 0.34, -0.28), (-0.40, 0.37, -0.14), "tail_2", 0.10),
    "tail_4": ((-0.40, 0.37, -0.14), (-0.37, 0.35, -0.02), "tail_3", 0.08),
}
FEET_CENTRE = Vector((0.04, -0.05, -0.5))

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o)
bpy.ops.import_scene.gltf(filepath=SRC)
ob = next(o for o in bpy.data.objects if o.type == "MESH")
ob.data.transform(ob.matrix_world)
ob.matrix_world = Matrix.Identity(4)
ob.name = ob.data.name = "Mori"
me = ob.data

# ---- weld (trimesh splits verts at every UV seam), then decimate to budget (UVs survive)
bm = bmesh.new()
bm.from_mesh(me)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
# QA fixes (blender-asset-qa table): duplicate faces left by welding double shells -> z-fighting;
# inconsistent winding -> recalc normals outward.
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
emi = bpy.data.images.new("Mori_Emissive", 2048, 2048)
emi.pixels.foreach_set(em.ravel())
emi.pack()
en = nt.nodes.new("ShaderNodeTexImage")
en.image = emi
nt.links.new(en.outputs["Color"], bsdf.inputs["Emission Color"])
bsdf.inputs["Emission Strength"].default_value = 1.0
mat.name = "M_Mori"
print("@@GLOW coverage", float((cyan > 0.3).mean()))

# ---- re-centre: feet on the origin, scaled to HEIGHT (already faces -Y = glTF +Z)
s = HEIGHT / (ob.dimensions.z or 1.0)
M = Matrix.Scale(s, 4) @ Matrix.Translation(-FEET_CENTRE)
me.transform(M)
me.update()

if UNRIGGED:  # plain textured mesh for rigging/animating in mesh2motion (no meshopt: its loader can't read it)
    with bpy.context.temp_override(selected_objects=[ob], active_object=ob):
        bpy.ops.export_scene.gltf(filepath=UNRIGGED, use_selection=True, export_format="GLB", export_image_format="JPEG",
                                  export_animations=False, export_yup=True)
    print("@@UNRIGGED", UNRIGGED, os.path.getsize(UNRIGGED) // 1024, "KB")
    sys.exit(0)

# ---- rig: armature + envelope-style weights (softmin over distance to bone segments)
nv = len(me.vertices)
P = np.empty(nv * 3)
me.vertices.foreach_get("co", P)
P = P.reshape(-1, 3)
names = list(BONES)
D = []
for n in names:
    a, t, _, rad = BONES[n]
    a = np.array(M @ Vector(a)); t = np.array(M @ Vector(t)); ab = t - a
    u = np.clip(((P - a) @ ab) / (ab @ ab), 0, 1)
    D.append(np.linalg.norm(P - (a + u[:, None] * ab), axis=1) - rad * s)
D = np.array(D)
W = np.exp(-(D - D.min(0)) / 0.014)
order = np.argsort(-W, axis=0)
keep = np.zeros_like(W, bool)
for k in range(3):
    keep[order[k], np.arange(nv)] = True
W = np.where(keep, W, 0)
W /= W.sum(0)

arm_data = bpy.data.armatures.new("MoriRig")
arm = bpy.data.objects.new("MoriRig", arm_data)
bpy.context.scene.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode="EDIT")
for n, (h, t, _, _) in BONES.items():
    eb = arm_data.edit_bones.new(n)
    eb.head, eb.tail, eb.roll = M @ Vector(h), M @ Vector(t), 0
for n, (_, _, parent, _) in BONES.items():
    if parent:
        arm_data.edit_bones[n].parent = arm_data.edit_bones[parent]
bpy.ops.object.mode_set(mode="OBJECT")
for bi, n in enumerate(names):
    vg = ob.vertex_groups.new(name=n)
    for i in np.where(W[bi] > 1e-4)[0]:
        vg.add([int(i)], float(W[bi, i]), "REPLACE")
ob.parent = arm
ob.modifiers.new("Armature", "ARMATURE").object = arm

if DEBUG:  # colour-by-bone ortho renders to check the landmarks
    import math
    pal = np.array([[.6,.6,.6],[1,.2,.2],[1,1,0],[1,.6,0],[0,.3,1],[0,.8,1],[0,1,.3],[.4,1,.6],[1,0,1],[.6,0,1],[.4,.3,.8],[1,.6,.8]])
    ca = me.color_attributes.new("dbg", "FLOAT_COLOR", "POINT")
    ca.data.foreach_set("color", np.hstack([pal[W.argmax(0)], np.ones((nv, 1))]).ravel())
    me.color_attributes.active_color = ca
    sc = bpy.context.scene
    cam = bpy.data.objects.new("dbgcam", bpy.data.cameras.new("dbgcam")); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.type, cam.data.ortho_scale = "ORTHO", 0.9
    sc.render.engine = "BLENDER_WORKBENCH"; sc.display.shading.light = "STUDIO"; sc.display.shading.color_type = "VERTEX"
    sc.render.resolution_x = sc.render.resolution_y = 400
    for name, loc, rot in (("front", (0, -2, 0.37), (math.pi / 2, 0, 0)), ("side", (2, 0, 0.37), (math.pi / 2, 0, math.pi / 2)),
                           ("back", (0, 2, 0.37), (math.pi / 2, 0, math.pi))):
        cam.location, cam.rotation_euler = loc, rot
        sc.render.filepath = os.path.join(DEBUG, f"mori_new_bones_{name}.png")
        bpy.ops.render.render(write_still=True)
    me.color_attributes.remove(me.color_attributes["dbg"])
    bpy.data.objects.remove(cam)

qa = qa_check.run(objects=["Mori"], profile="game")
print("@@QA", qa.get("pass"), (qa.get("errors") or [])[:4], "tris", sum(len(p.vertices) - 2 for p in me.polygons),
      "dims", tuple(round(d, 3) for d in ob.dimensions))
r = export_asset.run(preset="web", objects=[arm.name], out=OUT, set=["export_animations=False"])
print("@@EXPORT", OUT, os.path.getsize(OUT) // 1024, "KB", {k: v for k, v in r.items() if k in ("ok", "warnings")})
