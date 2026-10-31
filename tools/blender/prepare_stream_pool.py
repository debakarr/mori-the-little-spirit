"""Prepare the painted stream-pool diorama (stream.glb) for runtime.

Source:  stream.glb  (2M tris, 2 JPEG textures, UVs; round pool ~1 m wide, 0.21 m tall, centred)
Output:  public/models/stream_pool.glb  (~24k tris, 2K base colour, origin at the painted water level,
         COL_ convex hulls around the boulders)

Run:  blender -b --factory-startup --python tools/blender/prepare_stream_pool.py

blender-workflow-recipes #5 (AI asset cleanup): weld, decimate, QA, web export. The game drops it
into the stream so its painted water sits just under the live water surface (water.js).
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

SRC = os.path.join(ROOT, "stream.glb")
OUT = os.path.join(ROOT, "public", "models", "stream_pool.glb")
TRIS = 24000
ROCK_MIN = 0.045   # m above the water (source units) that counts as a boulder to collide with
CELL = 0.02        # grid cell for grouping boulder points into separate hulls

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o)
bpy.ops.import_scene.gltf(filepath=SRC)
ob = next(o for o in bpy.data.objects if o.type == "MESH")
ob.data.transform(ob.matrix_world)
ob.matrix_world = Matrix.Identity(4)
ob.name = ob.data.name = "StreamPool"
me = ob.data

bm = bmesh.new()
bm.from_mesh(me)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
bm.to_mesh(me)
bm.free()
dec = ob.modifiers.new("Decimate", "DECIMATE")
dec.ratio = TRIS / max(1, sum(len(p.vertices) - 2 for p in me.polygons))
with bpy.context.temp_override(object=ob, active_object=ob, selected_objects=[ob], selected_editable_objects=[ob]):
    assert bpy.ops.object.modifier_apply(modifier=dec.name) == {"FINISHED"}
for p in me.polygons:
    p.use_smooth = True

# origin: footprint centre, at the painted water level (median height of the flat up-facing
# verts in the middle of the pool)
P = np.empty(len(me.vertices) * 3)
me.vertices.foreach_get("co", P)
P = P.reshape(-1, 3)
N = np.empty(len(me.vertices) * 3)
me.vertices.foreach_get("normal", N)
N = N.reshape(-1, 3)
cx, cy = (P[:, 0].min() + P[:, 0].max()) / 2, (P[:, 1].min() + P[:, 1].max()) / 2
inner = (np.hypot(P[:, 0] - cx, P[:, 1] - cy) < 0.2) & (N[:, 2] > 0.9)
water = float(np.median(P[inner, 2]))
me.transform(Matrix.Translation(Vector((-cx, -cy, -water))))
me.update()
P -= (cx, cy, water)
print("@@WATER", round(water, 3), "bottom", round(float(P[:, 2].min()), 3), "top", round(float(P[:, 2].max()), 3))

mat = me.materials[0]
mat.name = "M_StreamPool"
for n in mat.node_tree.nodes:
    if n.type == "TEX_IMAGE":
        n.image.scale(*((2048, 2048) if n.image.colorspace_settings.name == "sRGB" else (1024, 1024)))

# ---- boulder hulls: points well above the water, grouped by 2D grid connectivity
hi = P[P[:, 2] > ROCK_MIN]
keys = {tuple(k) for k in np.floor(hi[:, :2] / CELL).astype(int)}
label, groups = {}, []
for k in keys:
    if k in label:
        continue
    stack, members = [k], []
    label[k] = len(groups)
    while stack:
        c = stack.pop()
        members.append(c)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                nb = (c[0] + dx, c[1] + dy)
                if nb in keys and nb not in label:
                    label[nb] = len(groups)
                    stack.append(nb)
    groups.append(members)
cell_of = np.floor(hi[:, :2] / CELL).astype(int)
gid = np.array([label[tuple(c)] for c in cell_of])


def split(pts, size=0.2):
    """k-means in xy until every cluster fits in `size` m, so arcs of rocks don't hull over the water."""
    ext = pts[:, :2].max(0) - pts[:, :2].min(0)
    k = int(np.ceil(ext[0] / size) * np.ceil(ext[1] / size))
    if k <= 1:
        return [pts]
    rng = np.random.default_rng(1)
    c = pts[rng.choice(len(pts), k, replace=False), :2]
    for _ in range(25):
        a = np.argmin(((pts[:, None, :2] - c[None]) ** 2).sum(-1), 1)
        c = np.array([pts[a == i, :2].mean(0) if (a == i).any() else c[i] for i in range(k)])
    return [q for i in range(k) for q in split(pts[a == i], size) if len(q)] if k > 1 else [pts]


hulls = []
clusters = [q for g in range(len(groups)) for q in split(hi[gid == g])]
for pts in clusters:
    if len(pts) < 25:
        continue
    # extend each hull down to below the water so Mori can't slip under it
    base = pts.copy()
    base[:, 2] = -0.08
    cloud = np.vstack([pts, base])
    hm = bpy.data.meshes.new(f"COL_pool_rock_{len(hulls)}")
    hb = bmesh.new()
    for v in cloud:
        hb.verts.new(v)
    bmesh.ops.convex_hull(hb, input=hb.verts)
    hb.to_mesh(hm)
    hb.free()
    ho = bpy.data.objects.new(hm.name, hm)
    bpy.context.scene.collection.objects.link(ho)
    ho.parent = ob
    hulls.append(ho)
print("@@HULLS", len(hulls), [tuple(round(d, 2) for d in h.dimensions) + tuple(round(c, 2) for c in (sum((Vector(b) for b in h.bound_box), Vector()) / 8)[:2]) for h in hulls])

qa = qa_check.run(objects=[ob.name], profile="render")
print("@@QA", qa.get("pass"), len(qa.get("errors") or []), "issues", "tris", sum(len(p.vertices) - 2 for p in me.polygons),
      "dims", tuple(round(d, 3) for d in ob.dimensions))
export_asset.run(preset="web", objects=[ob.name] + [h.name for h in hulls], out=OUT, set=["export_animations=False"])
print("@@EXPORT", OUT, os.path.getsize(OUT) // 1024, "KB")
