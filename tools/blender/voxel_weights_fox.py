"""Skin weights for the fox form from Voxel Heat Diffuse Skinning (Mesh Online), for rig_mori_mesh2motion.py.

Run:  blender -b --factory-startup --python tools/blender/voxel_weights_fox.py [-- --form fox --resolution 256]
Needs the Voxel Heat Diffuse Skinning add-on installed in this Blender's user add-ons (only its bundled
command-line solver, bin/<OS>/vhd, is used: the add-on's own operator is modal and needs a window).
Output: art/mesh2motion/fox_arp_weights.npz  (the weights file rig_mori_mesh2motion.py --form fox picks up;
        same layout as arp_weights_mori.py's: weights, bone names, and the vertex positions they belong to)

1. rig_mori_mesh2motion.py --dump-seg gives the deforming bones as the game skeleton's segments (fitted to
   the fox), so the weights land on exactly the bones the game animates.
2. The unrigged fox and those segments go to the solver, which voxelises the mesh (the overlapping fur and
   flame shells that defeat Blender's bone heat become one solid) and diffuses heat from each bone.
3. Top 4 influences per vertex, normalised, written next to the vertex positions.
Then: blender -b --factory-startup --python tools/blender/rig_mori_mesh2motion.py -- --form fox
"""
import bpy, json, os, shutil, stat, subprocess, sys, tempfile
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
FORM = argv[argv.index("--form") + 1] if "--form" in argv else "fox"
RES = int(argv[argv.index("--resolution") + 1]) if "--resolution" in argv else 256
ADDON = os.path.join(bpy.utils.resource_path("USER"), "scripts", "addons", "voxel_skinning")
SOLVER = {"Darwin": "bin/Darwin/vhd", "Linux": "bin/Linux/x64/vhd", "Windows": "bin/Windows/x64/vhd.exe"}

work = tempfile.mkdtemp(prefix="vhd_")
seg_file = os.path.join(work, "segments.json")
subprocess.run([bpy.app.binary_path, "-b", "--factory-startup", "--python", os.path.join(HERE, "rig_mori_mesh2motion.py"),
                "--", "--form", FORM, "--dump-seg", seg_file], check=True, stdout=subprocess.DEVNULL)
spec = json.load(open(seg_file))

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o)
bpy.ops.import_scene.gltf(filepath=spec["mesh"])
ob = next(o for o in bpy.data.objects if o.type == "MESH")
me = ob.data
P = np.array([v.co[:] for v in me.vertices])  # local coords: what the rig script skins and checks against

with open(os.path.join(work, "mesh.txt"), "w") as f:
    f.write("# voxel heat diffuse mesh export.\n")
    for x, y, z in P:
        f.write(f"v,{x},{y},{z}\n")
    for poly in me.polygons:
        f.write("f," + ",".join(str(i) for i in poly.vertices) + "\n")
names = list(spec["segments"])
with open(os.path.join(work, "bone.txt"), "w") as f:
    f.write("# voxel heat diffuse bone export.\n")
    for n in names:
        (hx, hy, hz), (tx, ty, tz) = spec["segments"][n]
        f.write(f"b,{n},{hx},{hy},{hz},{tx},{ty},{tz}\n")

import platform  # noqa: E402
solver = os.path.join(work, os.path.basename(SOLVER[platform.system()]))
shutil.copy(os.path.join(ADDON, SOLVER[platform.system()]), solver)  # run a copy: leave the add-on untouched
os.chmod(solver, os.stat(solver).st_mode | stat.S_IEXEC)
print("@@VHD", len(P), "verts", len(me.polygons), "faces", len(names), "bones, resolution", RES)
subprocess.run([solver, "mesh.txt", "bone.txt", "weight.txt", str(RES), "5", "64", "4", "0.2", "y", "n"], cwd=work, check=True)

W = np.zeros((len(P), len(names)))
bones = []
for line in open(os.path.join(work, "weight.txt")):
    t = line.strip().split(",")
    if t[0] == "b":
        bones.append(t[1])
    elif t[0] == "w":
        W[int(t[1]), names.index(bones[int(t[2])])] = float(t[3])
missing = int((W.sum(1) <= 0).sum())
top4 = np.zeros_like(W, bool)
np.put_along_axis(top4, np.argsort(-W, axis=1)[:, :4], True, axis=1)
W = np.where(top4 & (W > 0.01), W, 0)
W /= np.maximum(W.sum(1, keepdims=True), 1e-9)
np.savez_compressed(spec["out"], weights=W.astype(np.float32), bones=np.array(names), positions=P.astype(np.float32))
print("@@WEIGHTS", spec["out"], "unweighted verts", missing, "verts per bone", {n: int((W.argmax(1) == i).sum()) for i, n in enumerate(names)})
shutil.rmtree(work, ignore_errors=True)
