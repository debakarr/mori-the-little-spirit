"""Rig and animate Mori with mesh2motion's fox skeleton and animation library.

Sources:  art/mesh2motion/mori_unrigged.glb  (prepare_mori_new.py --unrigged: 40k tris, textured, feet at origin)
          art/mesh2motion/fox-animations.glb (CC0, github.com/scottpetrovic/mesh2motion-app static/animations:
                                              the fox template skeleton plus its clip library)
Output:   public/models/mori.glb  (skinned to the 45-bone fox skeleton, clips listed in CLIPS,
                                   smoothed normals for the game's cel shading: toon_mori.py)

Run:  blender -b --factory-startup --python tools/blender/rig_mori_mesh2motion.py [-- --form fox] [--debug DIR]

--form fox rigs the fox form instead (art/mesh2motion/fox_unrigged.glb from prepare_fox.py ->
public/models/fox.glb). The fox stands like the template, so its bind pose is the template's rest
pose and the clips play unscaled: only the joints move to the chibi fox's proportions.

The mesh2motion app (app.mesh2motion.org) fits a template skeleton into a mesh, skins it and plays
its clip library on it. Mori is sculpted sitting, so the skeleton is fitted in the fox's own Sit pose:
1. bind pose = the fox's last Sit frame, with every joint moved into Mori's body (orientations kept),
2. skin to that pose: Auto-Rig Pro heat-map weights from art/mesh2motion/mori_arp_weights.npz
   (arp_weights_mori.py) when present, else distance-to-bone-segment weights; top 4 influences,
3. retarget each clip by copying the fox's per-frame bone orientations onto Mori's proportions;
   hips sway is scaled to Mori's size and the lowest foot is kept on the ground.
The Sit clip therefore lands exactly on the sculpt, and Walk/Run unfold Mori into a standing gait.
"""
import bpy, os, sys, math
import numpy as np
from mathutils import Matrix, Quaternion, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SKILLS = os.path.join(ROOT, ".claude", "skills")
for s in ("blender-asset-qa", "blender-export-pipelines"):
    sys.path.append(os.path.join(SKILLS, s, "scripts"))
import qa_check  # noqa: E402
import export_asset  # noqa: E402
sys.path.insert(0, HERE)
import toon_mori  # noqa: E402

MESH = os.path.join(ROOT, "art", "mesh2motion", "mori_unrigged.glb")
ANIMS = os.path.join(ROOT, "art", "mesh2motion", "fox-animations.glb")
OUT = os.path.join(ROOT, "public", "models", "mori.glb")
ARP_WEIGHTS = os.path.join(ROOT, "art", "mesh2motion", "mori_arp_weights.npz")
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
DEBUG = argv[argv.index("--debug") + 1] if "--debug" in argv else None
FORM = argv[argv.index("--form") + 1] if "--form" in argv else "spirit"
BIND_CLIP = "Sit"  # template clip whose last frame is the bind pose (None: the template's rest pose)

CLIPS = ["Idle", "Idle Alert", "Walk", "Run", "Jump", "Fall", "Sit", "Howl", "Sneak"]
SWAY = 0.19  # Mori leg length / fox leg length: scales the fox's hips travel
UNFOLD = {"Back_Leg": 0.45, "Hips": 0.7, "Spine_1": 0.7, "Spine_2": 0.7, "Stomach": 0.7, "Front_Leg": 0.9}  # by bone-name prefix
SWING = {"Back_Leg": 0.5, "Front_Leg": 0.8}  # share of the fox's leg motion: Mori takes short chibi steps
FEET = [f"{p}_{s}" for s in "LR" for p in ("Front_Leg_Foot", "Front_Leg_Tip", "Back_Leg_Foot", "Back_Leg_Foot_1", "Back_Leg_Tip")]

# Joints in the sitting sculpt (Blender space: Z up, faces -Y, +X is Mori's left, feet at z=0, 0.75 m tall),
# read off gridded ortho renders. Big round head on a small sitting body, tail curling up on the right.
J = {
    "root": (0, 0.03, 0),
    "Hips": (0, 0.12, 0.08), "Spine_1": (0, 0.07, 0.12), "Spine_2": (0, 0.01, 0.16),
    "Spine_2.001": (0, -0.06, 0.19), "Spine_3": (0, -0.08, 0.215), "Spine_4": (0, -0.08, 0.24),
    "Head": (0, -0.07, 0.27), "Nose": (0, -0.2, 0.34), "Head.tip": (0, -0.28, 0.32),
    "Chin": (0, -0.2, 0.29), "Chin_Tip": (0, -0.26, 0.27),
    "Ear_L": (0.14, -0.08, 0.57), "Ear_Tip_L": (0.19, -0.11, 0.66),
    "Stomach": (0, 0.0, 0.12), "Stomach_tip": (0, -0.02, 0.07),
    "Front_Leg_Shoulder_L": (0.03, -0.04, 0.19), "Front_Leg_Upper_L": (0.08, -0.13, 0.17),
    "Front_Leg_Lower_L": (0.08, -0.135, 0.10), "Front_Leg_Ankle_L": (0.08, -0.14, 0.035),
    "Front_Leg_Foot_L": (0.08, -0.15, 0.015), "Front_Leg_Tip_L": (0.08, -0.175, 0.01),
    "Back_Leg_Pelvis_L": (0.05, 0.1, 0.13), "Back_Leg_Upper_L": (0.13, 0.1, 0.08),
    "Back_Leg_Lower_L": (0.16, -0.02, 0.11), "Back_Leg_Ankle_L": (0.14, 0.1, 0.02),
    "Back_Leg_Foot_L": (0.14, 0.03, 0.015), "Back_Leg_Foot_1_L": (0.14, -0.01, 0.008),
    "Back_Leg_Tip_L": (0.14, -0.03, 0.01),
    "Tail_Base": (-0.06, 0.16, 0.07), "Tail_Mid": (-0.17, 0.24, 0.08), "Tail_Mid.001": (-0.27, 0.29, 0.12),
    "Tail_End": (-0.3, 0.29, 0.21), "Tail_Tip": (-0.28, 0.28, 0.29),
}

if FORM == "fox":
    MESH = os.path.join(ROOT, "art", "mesh2motion", "fox_unrigged.glb")
    OUT = os.path.join(ROOT, "public", "models", "fox.glb")
    ARP_WEIGHTS = os.path.join(ROOT, "art", "mesh2motion", "fox_arp_weights.npz")
    BIND_CLIP, UNFOLD, SWING = None, {}, {}
    SWAY = 0.2  # chibi fox leg (0.2 m) / template leg (1 m)
    # Joints in the standing fox (prepare_fox.py space: paws at z=0 under the body centre, 0.8 m tall,
    # faces -Y), read off its ortho renders: short legs, big head, the flame tail plume curls up behind.
    J = {
        "root": (0, 0.03, 0),
        "Hips": (0, 0.15, 0.21), "Spine_1": (0, 0.08, 0.21), "Spine_2": (0, 0.0, 0.21),
        "Spine_2.001": (0, -0.07, 0.22), "Spine_3": (0, -0.12, 0.25), "Spine_4": (0, -0.14, 0.29),
        "Head": (0, -0.15, 0.33), "Nose": (0, -0.28, 0.32), "Head.tip": (0, -0.34, 0.31),
        "Chin": (0, -0.26, 0.29), "Chin_Tip": (0, -0.30, 0.27),
        "Ear_L": (0.11, -0.15, 0.58), "Ear_Tip_L": (0.15, -0.16, 0.68),
        "Stomach": (0, 0.0, 0.15), "Stomach_tip": (0, 0.02, 0.11),
        "Front_Leg_Shoulder_L": (0.05, -0.08, 0.24), "Front_Leg_Upper_L": (0.08, -0.11, 0.19),
        "Front_Leg_Lower_L": (0.08, -0.11, 0.11), "Front_Leg_Ankle_L": (0.08, -0.115, 0.035),
        "Front_Leg_Foot_L": (0.08, -0.13, 0.015), "Front_Leg_Tip_L": (0.08, -0.16, 0.01),
        "Back_Leg_Pelvis_L": (0.04, 0.08, 0.24), "Back_Leg_Upper_L": (0.09, 0.15, 0.2),
        "Back_Leg_Lower_L": (0.09, 0.13, 0.13), "Back_Leg_Ankle_L": (0.09, 0.2, 0.08),
        "Back_Leg_Foot_L": (0.09, 0.19, 0.03), "Back_Leg_Foot_1_L": (0.09, 0.17, 0.012),
        "Back_Leg_Tip_L": (0.09, 0.15, 0.01),
        "Tail_Base": (0, 0.22, 0.24), "Tail_Mid": (0, 0.30, 0.23), "Tail_Mid.001": (0, 0.40, 0.27),
        "Tail_End": (0, 0.48, 0.38), "Tail_Tip": (0, 0.55, 0.55),
    }
    FOX_SEG = {
        "Hips": ("Spine_1", 0.08), "Spine_1": ("Spine_2", 0.08), "Spine_2": ("Spine_2.001", 0.08),
        "Spine_2.001": ("Spine_3", 0.07), "Spine_3": ("Head", 0.06),
        "Head": (((0, -0.13, 0.4), (0, -0.13, 0.46)), 0.16),
        "Tail_Base": ("Tail_Mid", 0.05), "Tail_Mid": ("Tail_Mid.001", 0.08), "Tail_Mid.001": ("Tail_End", 0.12),
        "Tail_End": ("Tail_Tip", 0.12), "Tail_Tip": ((0, 0.56, 0.7), 0.07),
    }
    for side, sx in (("L", 1), ("R", -1)):
        FOX_SEG |= {
            f"Ear_{side}": (f"Ear_Tip_{side}", 0.05), f"Ear_Tip_{side}": ((0.19 * sx, -0.17, 0.79), 0.035),
            f"Front_Leg_Upper_{side}": (f"Front_Leg_Lower_{side}", 0.04),
            f"Front_Leg_Lower_{side}": (f"Front_Leg_Ankle_{side}", 0.035),
            f"Front_Leg_Ankle_{side}": (f"Front_Leg_Foot_{side}", 0.03),
            f"Front_Leg_Foot_{side}": (f"Front_Leg_Tip_{side}", 0.025),
            f"Back_Leg_Upper_{side}": (f"Back_Leg_Lower_{side}", 0.06),
            f"Back_Leg_Lower_{side}": (f"Back_Leg_Ankle_{side}", 0.04),
            f"Back_Leg_Ankle_{side}": (f"Back_Leg_Foot_{side}", 0.03),
            f"Back_Leg_Foot_{side}": (f"Back_Leg_Tip_{side}", 0.025),
        }
for k in [k for k in J if k.endswith("_L")]:
    x, y, z = J[k]
    J[k[:-2] + "_R"] = (-x, y, z)

# Deforming bones: segment end (joint name or point) and radius. The rest only carry children.
SEG = {
    "Hips": ("Spine_1", 0.06), "Spine_1": ("Spine_2", 0.07), "Spine_2": ("Spine_2.001", 0.07),
    "Spine_2.001": ("Spine_3", 0.06), "Spine_3": ("Head", 0.05),
    "Head": (((0, -0.07, 0.42), (0, -0.07, 0.52)), 0.19),
    "Tail_Base": ("Tail_Mid", 0.05), "Tail_Mid": ("Tail_Mid.001", 0.065), "Tail_Mid.001": ("Tail_End", 0.07),
    "Tail_End": ("Tail_Tip", 0.06), "Tail_Tip": ((-0.27, 0.27, 0.36), 0.05),
}
for side, sx in (("L", 1), ("R", -1)):
    SEG |= {
        f"Ear_{side}": (f"Ear_Tip_{side}", 0.05), f"Ear_Tip_{side}": ((0.23 * sx, -0.15, 0.745), 0.035),
        f"Front_Leg_Upper_{side}": (f"Front_Leg_Lower_{side}", 0.035),
        f"Front_Leg_Lower_{side}": (f"Front_Leg_Ankle_{side}", 0.03),
        f"Front_Leg_Ankle_{side}": (f"Front_Leg_Foot_{side}", 0.03),
        f"Front_Leg_Foot_{side}": (f"Front_Leg_Tip_{side}", 0.025),
        f"Back_Leg_Upper_{side}": (f"Back_Leg_Lower_{side}", 0.06),
        f"Back_Leg_Lower_{side}": (f"Back_Leg_Ankle_{side}", 0.035),
        f"Back_Leg_Ankle_{side}": (f"Back_Leg_Foot_{side}", 0.03),
        f"Back_Leg_Foot_{side}": (f"Back_Leg_Tip_{side}", 0.025),
    }

if FORM == "fox":
    SEG = FOX_SEG

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o)
bpy.ops.import_scene.gltf(filepath=ANIMS)
fox = next(o for o in bpy.data.objects if o.type == "ARMATURE")
for o in [o for o in bpy.data.objects if o.type == "MESH"]:
    bpy.data.objects.remove(o)
for a in list(bpy.data.actions):
    if a.name in CLIPS:
        a.name = "fox_" + a.name
    else:
        bpy.data.actions.remove(a)
assert fox.matrix_world == Matrix.Identity(4)
assert not [b.name for b in fox.data.bones if b.name not in J]
sc = bpy.context.scene
fox.animation_data_create()


def fox_pose(action, frame):
    """Armature-space bone matrices of the fox at a (fractional) frame."""
    fox.animation_data.action = action
    fox.animation_data.action_slot = action.slots[0]
    sc.frame_set(int(math.floor(frame)), subframe=frame - math.floor(frame))
    return {pb.name: pb.matrix.copy() for pb in fox.pose.bones}


if BIND_CLIP:
    sit_act = bpy.data.actions["fox_" + BIND_CLIP]
    SIT = fox_pose(sit_act, sit_act.frame_range[1])
else:
    SIT = {b.name: b.matrix_local.copy() for b in fox.data.bones}

# ---- 1. Mori's rig: fox Sit orientations, joints at Mori's landmarks
rig = bpy.data.objects.new("MoriRig" if FORM == "spirit" else "FoxRig", bpy.data.armatures.new("MoriRig"))
sc.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="EDIT")
for b in fox.data.bones:
    eb = rig.data.edit_bones.new(b.name)
    eb.head, eb.tail = (0, 0, 0), (0, max(b.length * 0.15, 0.01), 0)
    eb.matrix = Matrix.LocRotScale(Vector(J[b.name]), SIT[b.name].to_quaternion(), None)
for b in fox.data.bones:
    if b.parent:
        rig.data.edit_bones[b.name].parent = rig.data.edit_bones[b.parent.name]
bpy.ops.object.mode_set(mode="OBJECT")
REST = {b.name: b.matrix_local.copy() for b in rig.data.bones}
ORDER = [b.name for b in rig.data.bones]  # parents before children
PARENT = {b.name: (b.parent.name if b.parent else None) for b in rig.data.bones}
LOCAL = {n: (REST[p].inverted() @ REST[n] if p else REST[n]) for n, p in PARENT.items()}

# ---- 3. retarget clips: fox orientations on Mori's proportions, hips sway scaled, feet grounded
rig.animation_data_create()
floor = min(J[f][2] for f in FEET)
# Base stance per bone: part-way from the sculpt's sitting pose to the fox's standing rest. Fully
# unfolding the sculpted haunches stretches the belly into a sack; a crouched chibi stance doesn't.
FOX_REST = {b.name: b.matrix_local.to_quaternion() for b in fox.data.bones}
STANCE = {}
for n, q_rest in FOX_REST.items():
    q_sit = SIT[n].to_quaternion()
    if q_sit.dot(q_rest) < 0:
        q_rest = -q_rest
    t = next((v for k, v in UNFOLD.items() if n.startswith(k)), 1.0)
    STANCE[n] = q_sit.slerp(q_rest, t)
for clip in CLIPS:
    src = bpy.data.actions["fox_" + clip]
    f0, f1 = src.frame_range
    act = bpy.data.actions.new(clip)
    act.use_fake_user = True
    rig.animation_data.action = act
    prev = {}
    for i in range(int(round(f1 - f0)) + 1):
        A = fox_pose(src, min(f0 + i, f1))
        W = {}
        for n in ORDER:
            p = PARENT[n]
            pos = (W[p] @ LOCAL[n]).translation if p else REST[n].translation
            if n == "Hips":
                pos = pos + (A[n].translation - SIT[n].translation) * SWAY
            q = A[n].to_quaternion()
            if clip != BIND_CLIP:  # the fox's motion relative to its standing rest, on Mori's crouched stance
                delta = q @ FOX_REST[n].inverted()
                if delta.w < 0:
                    delta.negate()
                q = Quaternion().slerp(delta, next((v for k, v in SWING.items() if n.startswith(k)), 1.0)) @ STANCE[n]
            W[n] = Matrix.LocRotScale(pos, q, None)
        dz = floor - min(min(W[f].translation.z, (W[f] @ Vector((0, rig.data.bones[f].length, 0))).z) for f in FEET)
        for n in ORDER:
            if n != "root":
                W[n] = Matrix.Translation((0, 0, dz)) @ W[n]
        for n in ORDER:
            p = PARENT[n]
            basis = ((W[p] @ LOCAL[n]) if p else REST[n]).inverted() @ W[n]
            loc, q, _ = basis.decompose()
            if n in prev and prev[n].dot(q) < 0:
                q.negate()
            prev[n] = q
            pb = rig.pose.bones[n]
            pb.rotation_mode = "QUATERNION"
            pb.location, pb.rotation_quaternion = loc, q
            pb.keyframe_insert("location", frame=i)
            pb.keyframe_insert("rotation_quaternion", frame=i)
    print("@@CLIP", clip, "frames", int(round(f1 - f0)) + 1)
rig.animation_data.action = None
for pb in rig.pose.bones:
    pb.location, pb.rotation_quaternion = (0, 0, 0), (1, 0, 0, 0)
bpy.data.objects.remove(fox)
for a in [a for a in bpy.data.actions if a.name.startswith("fox_")]:
    bpy.data.actions.remove(a)

# ---- 2. skin Mori in the bind (sitting) pose
bpy.ops.import_scene.gltf(filepath=MESH)
ob = next(o for o in bpy.data.objects if o.type == "MESH")
ob.name = ob.data.name = "Mori"
me = ob.data
nv = len(me.vertices)
P = np.empty(nv * 3)
me.vertices.foreach_get("co", P)
P = P.reshape(-1, 3)
names = list(SEG)
D = []
for n in names:
    end, rad = SEG[n]
    a, t = (np.array(end[0]), np.array(end[1])) if isinstance(end[0], tuple) else \
        (np.array(J[n]), np.array(J[end] if isinstance(end, str) else end))
    ab = t - a
    u = np.clip(((P - a) @ ab) / (ab @ ab), 0, 1)
    D.append(np.linalg.norm(P - (a + u[:, None] * ab), axis=1) - rad)
D = np.array(D)
W = np.exp(-(D - D.min(0)) / 0.012)
order = np.argsort(-W, axis=0)
keep = np.zeros_like(W, bool)
for k in range(4):
    keep[order[k], np.arange(nv)] = True
W = np.where(keep, W, 0)
W /= W.sum(0)
if os.path.exists(ARP_WEIGHTS):  # Auto-Rig Pro heat-map weights (tools/blender/arp_weights_mori.py) replace the distance ones
    arp = np.load(ARP_WEIGHTS)
    assert arp["positions"].shape == P.shape and np.abs(arp["positions"] - P).max() < 1e-4, "ARP weights are for another mesh"
    cols = {n: i for i, n in enumerate(arp["bones"])}
    W = np.array([arp["weights"][:, cols[n]] if n in cols else np.zeros(nv) for n in names])
    W /= np.maximum(W.sum(0), 1e-9)
    print("@@SKIN using Auto-Rig Pro weights", ARP_WEIGHTS, "unmapped:", sorted(set(cols) - set(names)))
for bi, n in enumerate(names):
    vg = ob.vertex_groups.new(name=n)
    for i in np.where(W[bi] > 1e-3)[0]:
        vg.add([int(i)], float(W[bi, i]), "REPLACE")
ob.parent = rig
ob.modifiers.new("Armature", "ARMATURE").object = rig
print("@@SKIN verts per bone", {n: int((W.argmax(0) == i).sum()) for i, n in enumerate(names)})

if DEBUG:  # weight colours in the bind pose, then frames of the main clips from the side
    pal = np.random.default_rng(3).uniform(0.15, 1, (len(names), 3))
    ca = me.color_attributes.new("dbg", "FLOAT_COLOR", "POINT")
    ca.data.foreach_set("color", np.hstack([pal[W.argmax(0)], np.ones((nv, 1))]).ravel())
    me.color_attributes.active_color = ca
    cam = bpy.data.objects.new("dbgcam", bpy.data.cameras.new("dbgcam")); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.type, cam.data.ortho_scale = "ORTHO", 1.0
    sc.render.engine = "BLENDER_WORKBENCH"; sc.display.shading.light = "STUDIO"
    sc.render.resolution_x = sc.render.resolution_y = 300
    aim = bpy.data.objects.new("aim", None); sc.collection.objects.link(aim); aim.location = (0, 0, 0.35)
    cam.constraints.new("TRACK_TO").target = aim
    views = {"front": (0, -2, 0.4), "side": (2, 0, 0.4), "back": (0, 2, 0.4), "q": (1.6, -1.6, 0.9)}
    sc.display.shading.single_color = (0.75, 0.72, 0.68)
    sc.display.shading.show_cavity = True

    def shot(name, view, color):
        sc.display.shading.color_type = color
        cam.location = views[view]
        sc.render.filepath = os.path.join(DEBUG, f"m2m_{name}.png")
        bpy.ops.render.render(write_still=True)

    for v in ("front", "side", "back"):
        shot(f"weights_{v}", v, "VERTEX")
    for clip in ("Idle", "Walk", "Run", "Jump", "Sit", "Howl"):
        act = bpy.data.actions[clip]
        rig.animation_data.action = act
        f0, f1 = act.frame_range
        for i, f in enumerate(np.linspace(f0, f1, 4, endpoint=False)):
            sc.frame_set(int(f))
            shot(f"{clip}_{i}", "side", "SINGLE")
            shot(f"{clip}_q{i}", "q", "SINGLE")
    rig.animation_data.action = None
    sc.frame_set(0)
    me.color_attributes.remove(me.color_attributes["dbg"])
    bpy.data.objects.remove(cam)
    bpy.data.objects.remove(aim)

print("@@NORMALS", toon_mori.smooth_normals(ob))  # clean cel-shading shapes (src/player/toonMaterial.js)
qa = qa_check.run(objects=["Mori"], profile="game")
print("@@QA", qa.get("pass"), (qa.get("errors") or [])[:3], "dims", tuple(round(d, 3) for d in ob.dimensions))
r = export_asset.run(preset="web", objects=[rig.name], out=OUT)
print("@@EXPORT", OUT, os.path.getsize(OUT) // 1024, "KB", {k: v for k, v in r.items() if k in ("ok", "warnings", "summary")})
