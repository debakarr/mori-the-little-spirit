"""Skin weights for Mori from Auto-Rig Pro, for rig_mori_mesh2motion.py.

Run in the live Blender session (ARP needs the UI context and the user's ARP install):
    python3 tools/blender/mcp_run.py --file tools/blender/arp_weights_mori.py
Output: art/mesh2motion/mori_arp_weights.npz  (per-vertex weights on the game's fox skeleton bones,
        plus the vertex positions they belong to). Leaves a "Mori ARP" scene to inspect.

1. ARP's dog rig is appended and its reference bones fitted to Mori's sitting landmarks (the joints
   rig_mori_mesh2motion.J uses), then Match to Rig builds the control rig.
2. Blender's bone heat (ARP's Heat Map engine) finds no solution on the raw sculpt, whose fur tufts are
   overlapping open shells, so ARP binds a watertight voxel-remeshed copy instead.
3. ARP's deform bones are merged onto the game skeleton (every face bone onto Head) and the weights
   carried to the real mesh by closest point on the copy's surface, top 4 influences.
The game keeps mesh2motion's skeleton and clips; only the skinning comes from ARP.
"""
import bpy, os, re
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT = "/Users/debroy/Source/Mori The Little Spirit"
MESH = os.path.join(ROOT, "art", "mesh2motion", "mori_unrigged.glb")
OUT = os.path.join(ROOT, "art", "mesh2motion", "mori_arp_weights.npz")

# ARP reference chains on Mori's sitting landmarks: head of each bone, last point = tail of the last
CHAINS = {
    "spine": (["root_ref.x", "spine_01_ref.x", "spine_02_ref.x", "spine_03_ref.x", "neck_ref.x", "head_ref.x"],
              [(0, 0.15, 0.07), (0, 0.10, 0.11), (0, 0.05, 0.15), (0, 0.0, 0.18), (0, -0.05, 0.21), (0, -0.07, 0.26), (0, -0.07, 0.55)]),
    "tail": (["tail_00_ref.x", "tail_01_ref.x", "tail_02_ref.x", "tail_03_ref.x"],
             [(-0.04, 0.15, 0.07), (-0.17, 0.24, 0.08), (-0.27, 0.29, 0.12), (-0.30, 0.29, 0.22), (-0.27, 0.27, 0.36)]),
    "ear": (["ear_01_ref.l", "ear_02_ref.l"], [(0.13, -0.07, 0.52), (0.17, -0.10, 0.63), (0.22, -0.14, 0.74)]),
    "back": (["thigh_b_ref.l", "thigh_ref.l", "leg_ref.l", "foot_ref.l", "toes_ref.l"],
             [(0.07, 0.11, 0.14), (0.13, 0.10, 0.09), (0.16, -0.02, 0.10), (0.14, 0.10, 0.025), (0.14, 0.02, 0.012), (0.14, -0.04, 0.008)]),
    "front": (["thigh_b_ref_dupli_001.l", "thigh_ref_dupli_001.l", "leg_ref_dupli_001.l", "foot_ref_dupli_001.l", "toes_ref_dupli_001.l"],
              [(0.04, -0.04, 0.21), (0.08, -0.12, 0.17), (0.08, -0.135, 0.10), (0.08, -0.14, 0.035), (0.08, -0.155, 0.014), (0.08, -0.19, 0.008)]),
}
DOG_FACE, MORI_FACE = Vector((0, -0.72, 1.20)), Vector((0, -0.07, 0.33))  # the dog preset's face refs move here


def fox_bone(n):
    """Game-skeleton bone for an ARP deform bone."""
    side = "_L" if ".l" in n else "_R" if ".r" in n else ""
    leg = "Front_Leg_" if "_dupli_001" in n else "Back_Leg_"
    fixed = {"root.x": "Hips", "spine_01.x": "Spine_1", "spine_02.x": "Spine_2", "spine_03.x": "Spine_2.001", "neck.x": "Spine_3"}
    if n in fixed:
        return fixed[n]
    m = re.match(r"c_tail_0(\d)\.x", n)
    if m:
        return ["Tail_Base", "Tail_Mid", "Tail_Mid.001", "Tail_End"][int(m.group(1))]
    if n.startswith("c_ear_01"):
        return "Ear" + side
    if n.startswith("c_ear_02"):
        return "Ear_Tip" + side
    if n.startswith(("c_thigh_b", "thigh_twist", "thigh_stretch")):
        return leg + "Upper" + side
    if n.startswith(("leg_twist", "leg_stretch")):
        return leg + "Lower" + side
    if n.startswith("foot"):
        return leg + "Ankle" + side
    if n.startswith("toes"):
        return leg + "Foot" + side
    return "Head"  # head, skull, jaw and every facial bone


win = bpy.context.window_manager.windows[0]
area = next(a for a in win.screen.areas if a.type == "VIEW_3D")
UI = dict(window=win, area=area, region=next(r for r in area.regions if r.type == "WINDOW"))

old = bpy.data.scenes.get("Mori ARP")
if old:
    for o in list(old.objects):
        bpy.data.objects.remove(o)
    bpy.data.scenes.remove(old)
sc = bpy.data.scenes.new("Mori ARP")
win.scene = sc
UI["scene"] = sc
with bpy.context.temp_override(**UI):
    bpy.ops.import_scene.gltf(filepath=MESH)
mesh = next(o for o in sc.objects if o.type == "MESH")
root = mesh.parent
mw = mesh.matrix_world.copy()
mesh.parent = None
mesh.matrix_world = mw
if root:
    bpy.data.objects.remove(root)
mesh.name = "Mori_ARP_mesh"

# ---- 1. ARP dog rig fitted to Mori
with bpy.context.temp_override(**UI):
    bpy.ops.object.select_all(action="DESELECT")
    assert bpy.ops.arp.append_arp(rig_preset="dog") == {"FINISHED"}
rig = sc.objects["rig"]
bpy.context.view_layer.objects.active = rig
with bpy.context.temp_override(**UI):
    bpy.ops.object.mode_set(mode="EDIT")
eb = rig.data.edit_bones
old_head = {b.name: b.head.copy() for b in eb}
old_tail = {b.name: b.tail.copy() for b in eb}
for b in eb:
    if "_ref" in b.name and not b.name.startswith("ear_") and b.head.z > 0.9:
        b.head, b.tail = MORI_FACE + (b.head - DOG_FACE), MORI_FACE + (b.tail - DOG_FACE)
for bones, pts in CHAINS.values():
    for suffix, sx in ((".l", 1), (".r", -1)) if bones[0].endswith(".l") else ((".x", 1),):
        for i, n in enumerate(bones):
            b = eb[n[:-2] + suffix]
            b.use_connect = False
            b.head = Vector(pts[i]) * Vector((sx, 1, 1))
            b.tail = Vector(pts[i + 1]) * Vector((sx, 1, 1))
        for n in bones[1:]:
            eb[n[:-2] + suffix].use_connect = True
for side in (".l", ".r"):  # heel / bank helpers follow their foot, shrunk to paw size
    for dup in ("", "_dupli_001"):
        foot = f"foot_ref{dup}{side}"
        for h in ("foot_heel_ref", "foot_bank_01_ref", "foot_bank_02_ref"):
            nm = f"{h}{dup}{side}"
            if nm in eb:
                eb[nm].head = eb[foot].head + (old_head[nm] - old_head[foot]) * 0.25
                eb[nm].tail = eb[foot].head + (old_tail[nm] - old_head[foot]) * 0.25
with bpy.context.temp_override(**UI):
    bpy.ops.object.mode_set(mode="OBJECT")
    assert bpy.ops.arp.match_to_rig() == {"FINISHED"}

# ---- 2. bind a watertight copy with ARP's heat map
proxy = bpy.data.objects.new("Mori_ARP_proxy", mesh.data.copy())
sc.collection.objects.link(proxy)
for kind, setup in (("REMESH", dict(mode="VOXEL", voxel_size=0.008)), ("SMOOTH", dict(factor=0.5, iterations=4))):
    m = proxy.modifiers.new(kind, kind)
    for k, v in setup.items():
        setattr(m, k, v)
proxy.data = bpy.data.meshes.new_from_object(proxy.evaluated_get(bpy.context.evaluated_depsgraph_get()))
proxy.modifiers.clear()
m = proxy.modifiers.new("Decimate", "DECIMATE")
m.ratio = min(1.0, 30000 / len(proxy.data.polygons))
proxy.data = bpy.data.meshes.new_from_object(proxy.evaluated_get(bpy.context.evaluated_depsgraph_get()))
proxy.modifiers.clear()
for o in sc.objects:
    o.select_set(False)
proxy.select_set(True)
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
sc.arp_bind_engine, sc.arp_bind_split, sc.arp_bind_scale_fix = "HEAT_MAP", False, True
with bpy.context.temp_override(**UI):  # ARP switches the active object itself: don't pin it
    assert bpy.ops.arp.bind_to_rig("EXEC_DEFAULT") == {"FINISHED"}

# ---- 3. ARP groups -> game bones, carried to the real mesh
fox_names = sorted({fox_bone(g.name) for g in proxy.vertex_groups})
col = {g.index: fox_names.index(fox_bone(g.name)) for g in proxy.vertex_groups}
Wp = np.zeros((len(proxy.data.vertices), len(fox_names)))
for v in proxy.data.vertices:
    for g in v.groups:
        Wp[v.index, col[g.group]] += g.weight
assert (Wp.sum(1) > 0).all(), "ARP bind left vertices unweighted"
Wp /= Wp.sum(1, keepdims=True)
pm = proxy.data
pm.calc_loop_triangles()
tris = np.array([t.vertices[:] for t in pm.loop_triangles])
PV = np.array([v.co[:] for v in pm.vertices])
bvh = BVHTree.FromPolygons(PV.tolist(), tris.tolist())
MV = np.array([v.co[:] for v in mesh.data.vertices])
W = np.zeros((len(MV), len(fox_names)))
for i, co in enumerate(MV):
    loc, _, ti, _ = bvh.find_nearest(co)
    a, b, c = PV[tris[ti]]
    v0, v1, v2 = b - a, c - a, np.array(loc) - a
    d00, d01, d11, d20, d21 = v0 @ v0, v0 @ v1, v1 @ v1, v2 @ v0, v2 @ v1
    den = (d00 * d11 - d01 * d01) or 1e-12
    bv, bw = (d11 * d20 - d01 * d21) / den, (d00 * d21 - d01 * d20) / den
    bary = np.clip([1 - bv - bw, bv, bw], 0, 1)
    W[i] = (bary / bary.sum()) @ Wp[tris[ti]]
top4 = np.zeros_like(W, bool)
np.put_along_axis(top4, np.argsort(-W, axis=1)[:, :4], True, axis=1)
W = np.where(top4 & (W > 0.01), W, 0)
W /= W.sum(1, keepdims=True)
np.savez_compressed(OUT, weights=W.astype(np.float32), bones=np.array(fox_names), positions=MV.astype(np.float32))
for j, n in enumerate(fox_names):  # same weights on the live mesh, for weight painting / inspection
    vg = mesh.vertex_groups.new(name=n)
    for i in np.nonzero(W[:, j])[0]:
        vg.add([int(i)], float(W[i, j]), "REPLACE")
proxy.hide_set(True)
result = {"out": OUT, "bones": len(fox_names), "verts": len(MV), "proxy_verts": len(PV)}
