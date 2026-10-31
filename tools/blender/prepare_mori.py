"""Prepare Mori (spirit form) for runtime.

Source:  mori-base-spirit.fbx  (untextured, unrigged, no UVs)
Output:  public/models/mori.glb (vertex-coloured, skinned, Y-up, faces +Z, feet at origin)

Run:  blender -b --factory-startup --python tools/blender/prepare_mori.py [-- --preview DIR]

Steps:
  1. paint vertex colours procedurally (charcoal body, ivory face, turquoise eyes)
  2. bake a cavity term into the colours so the sculpt reads under soft lighting
  3. write a `_glow` float attribute (tail plume + eyes) used as an emissive mask
  4. build a small armature and compute envelope-style skin weights
  5. re-orient / scale and export GLB
"""
import bpy, bmesh, sys, os, math
import numpy as np
from collections import deque
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
from mori_landmarks import BONES, FACE_CENTER, FACE_RADII, EYES, NOSE

SRC = os.path.join(ROOT, "mori-base-spirit.fbx")
OUT = os.path.join(ROOT, "public", "models", "mori.glb")
HEIGHT = 0.75  # metres
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
PREVIEW = argv[argv.index("--preview") + 1] if "--preview" in argv else None


def srgb(h):
    c = np.array([int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)])
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


CHARCOAL = srgb("#2e3039")
CHARCOAL_DEEP = srgb("#1c1d24")
IVORY = srgb("#f3ecdc")
IRIS_TOP = srgb("#0f7f8f")
IRIS_BOT = srgb("#59e6e0")
PUPIL = srgb("#0a1f29")
TAIL_GLOW = srgb("#7ff4ff")
NOSE_COL = srgb("#2a2229")

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=SRC)
obj = [o for o in bpy.data.objects if o.type == "MESH"][0]
obj.data.transform(obj.matrix_world)
obj.matrix_world = Matrix.Identity(4)
me = obj.data
for p in me.polygons:
    p.use_smooth = True

nv = len(me.vertices)
P = np.empty(nv * 3); me.vertices.foreach_get("co", P); P = P.reshape(-1, 3)
N = np.empty(nv * 3); me.vertices.foreach_get("normal", N); N = N.reshape(-1, 3)
E = np.empty(len(me.edges) * 2, dtype=np.int64); me.edges.foreach_get("vertices", E); E = E.reshape(-1, 2)
adj = [[] for _ in range(nv)]
for a, b in E:
    adj[a].append(b); adj[b].append(a)

# ---------------------------------------------------------------- face mask
fy, fz = FACE_CENTER
ry, rz = FACE_RADII
ell = ((P[:, 1] - fy) / ry) ** 2 + ((P[:, 2] - fz) / rz) ** 2
front = (N[:, 0] > 0.15) & (P[:, 0] > 0.12)
cand = np.where(front & (ell < 0.15))[0]
seed = cand[np.argmax(P[cand, 0])]
face = np.zeros(nv, bool); face[seed] = True
q = deque([seed])
while q:
    i = q.popleft()
    for j in adj[i]:
        if face[j] or ell[j] > 1.3 or not front[j]:
            continue
        if N[i] @ N[j] < 0.80:
            continue
        face[j] = True; q.append(j)
# close small holes in the mask (eye-socket rims, nostril) by majority vote
for _ in range(3):
    f = face.astype(float)
    avg = np.array([f[a].mean() if a else 0 for a in adj])
    face = np.where(ell < 1.15, (avg > 0.5) | face, face)

col = np.tile(CHARCOAL, (nv, 1))
col[face] = IVORY
glow = np.zeros(nv)

# ---------------------------------------------------------------- eyes
for ey, ez, er in EYES:
    d = np.hypot(P[:, 1] - ey, P[:, 2] - ez) / er
    m = (d < 1.0) & (P[:, 0] > 0.15) & (N[:, 0] > -0.2)
    t = np.clip((ez + er - P[:, 2]) / (2 * er), 0, 1)[:, None]  # 0 top -> 1 bottom
    iris = IRIS_TOP * (1 - t) + IRIS_BOT * t
    c = np.where((d < 0.5)[:, None], PUPIL, iris)
    c = np.where((d > 0.9)[:, None], CHARCOAL_DEEP, c)
    hl1 = np.hypot(P[:, 1] - (ey - 0.30 * er), P[:, 2] - (ez + 0.32 * er)) / er < 0.24
    hl2 = np.hypot(P[:, 1] - (ey + 0.28 * er), P[:, 2] - (ez - 0.30 * er)) / er < 0.11
    c = np.where((hl1 | hl2)[:, None], np.array([1.0, 1.0, 1.0]), c)
    col[m] = c[m]
    glow[m] = np.where(hl1 | hl2, 0.6, np.where(d < 0.5, 0.05, 0.45))[m]
    face[m] = False

ny, nz, nr = NOSE
nose = (np.hypot(P[:, 1] - ny, P[:, 2] - nz) < nr) & (P[:, 0] > 0.2)
col[nose] = NOSE_COL

# ---------------------------------------------------------------- skin weights
names = list(BONES)
D = []
for n in names:
    a, b, _, r = BONES[n]
    a, b = np.array(a), np.array(b); ab = b - a
    t = np.clip(((P - a) @ ab) / (ab @ ab), 0, 1)
    D.append(np.linalg.norm(P - (a + t[:, None] * ab), axis=1) - r)
D = np.array(D)
W = np.exp(-(D - D.min(0)) / 0.018)
order = np.argsort(-W, axis=0)
keep = np.zeros_like(W, bool)
for k in range(3):
    keep[order[k], np.arange(nv)] = True
W = np.where(keep, W, 0); W /= W.sum(0)

# tail glow: grows along the tail chain, brighter on convex fur tips
tail_ids = [names.index(n) for n in ("tail_1", "tail_2", "tail_3", "tail_4")]
along = sum(W[i] * (k + 0.5) / 4 for k, i in enumerate(tail_ids))
tailw = W[tail_ids].sum(0)

# cavity (mean neighbour offset along normal) -> darken creases, lift ridges
cav = np.zeros(nv)
for i in range(nv):
    if adj[i]:
        cav[i] = ((P[adj[i]] - P[i]) @ N[i]).mean()
for _ in range(2):
    cav = np.array([0.5 * cav[i] + 0.5 * cav[a].mean() if a else cav[i] for i, a in enumerate(adj)])
cav = cav / (np.abs(cav).std() * 3)
convex = np.clip(-cav, 0, 1)
shade = np.clip(1.0 - 0.55 * np.clip(cav, 0, 1) + 0.25 * convex, 0.4, 1.3)

tg = np.clip((along - 0.35) / 0.55, 0, 1) * tailw
tg = np.clip(tg * (0.75 + 0.6 * convex), 0, 1)
col = col * (1 - tg[:, None] * 0.85) + TAIL_GLOW * tg[:, None] * 0.85
glow = np.maximum(glow, tg)
# ear tips pick up a faint cyan rim like the reference art
ear = W[names.index("ear_L")] + W[names.index("ear_R")]
col = col * shade[:, None]

ca = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
ca.data.foreach_set("color", np.hstack([col, np.ones((nv, 1))]).ravel())
me.color_attributes.active_color = ca
ga = me.attributes.new("_glow", "FLOAT", "POINT")
ga.data.foreach_set("value", glow.astype(np.float32))

# ---------------------------------------------------------------- re-orient
# face +X -> -Y (glTF +Z), feet to origin, scale to HEIGHT
zmin = P[:, 2].min()
centre = Vector((0.05, 0.11, zmin))
s = HEIGHT / (P[:, 2].max() - zmin)
M = Matrix.Scale(s, 4) @ Matrix.Rotation(-math.pi / 2, 4, "Z") @ Matrix.Translation(-centre)
me.transform(M)
me.update()

# ---------------------------------------------------------------- armature
arm_data = bpy.data.armatures.new("MoriRig")
arm = bpy.data.objects.new("MoriRig", arm_data)
bpy.context.scene.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode="EDIT")
for n, (h, t, parent, _) in BONES.items():
    eb = arm_data.edit_bones.new(n)
    eb.head = M @ Vector(h); eb.tail = M @ Vector(t)
    eb.roll = 0
for n, (_, _, parent, _) in BONES.items():
    if parent:
        arm_data.edit_bones[n].parent = arm_data.edit_bones[parent]
bpy.ops.object.mode_set(mode="OBJECT")

for bi, n in enumerate(names):
    vg = obj.vertex_groups.new(name=n)
    idx = np.where(W[bi] > 1e-4)[0]
    for i in idx:
        vg.add([int(i)], float(W[bi, i]), "REPLACE")
obj.parent = arm
mod = obj.modifiers.new("Armature", "ARMATURE"); mod.object = arm
obj.name = "Mori"

mat = bpy.data.materials.new("MoriSkin")
mat.use_nodes = True
nt = mat.node_tree
bsdf = nt.nodes["Principled BSDF"]
vc = nt.nodes.new("ShaderNodeVertexColor"); vc.layer_name = "Col"
nt.links.new(vc.outputs["Color"], bsdf.inputs["Base Color"])
bsdf.inputs["Roughness"].default_value = 0.75
me.materials.clear(); me.materials.append(mat)

if PREVIEW:
    sc = bpy.context.scene
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.type = "ORTHO"; cam.data.ortho_scale = 1.0
    sc.render.engine = "BLENDER_WORKBENCH"; sc.display.shading.light = "STUDIO"
    sc.display.shading.color_type = "VERTEX"
    sc.render.resolution_x = sc.render.resolution_y = 600
    for name, loc, rot in [("front", (0, -2, 0.37), (math.pi / 2, 0, 0)),
                           ("q", (1.4, -1.4, 0.9), (math.radians(70), 0, math.radians(45))),
                           ("back", (0, 2, 0.37), (math.pi / 2, 0, math.pi))]:
        cam.location = loc; cam.rotation_euler = rot
        sc.render.filepath = os.path.join(PREVIEW, f"mori_{name}.png")
        bpy.ops.render.render(write_still=True)

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=OUT, export_format="GLB", use_selection=False,
    export_vertex_color="ACTIVE", export_attributes=True,
    export_skins=True, export_animations=False, export_yup=True,
    export_texcoords=False, export_normals=True,
)
print("EXPORTED", OUT, "tris", sum(len(p.vertices) - 2 for p in me.polygons), "face verts", int(face.sum()))
