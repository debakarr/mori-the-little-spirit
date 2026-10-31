"""Small props for the clearing, each matched to a reference sheet.

  moss_rocks.glb   (15_moss_rock)    rock_big, rock_tall, rock_flat, rock_small, pebbles
  lantern_post.glb (22_signpost)     wooden post with vines and a hanging lantern
  fence.glb        (21_wooden_fence) two-post rail fence with creeping vines
  lily.glb         (12_flower)       lily-of-the-valley plant (instanced in the game)
  rune_stone.glb   (20_stone_ruin)   mossy standing stone with a glowing spirit rune
"""
import math
import numpy as np
from mathutils import Vector
import lsgen as L
import parts

STONE = L.srgb("#8b8d84")
STONE_LIGHT = L.srgb("#b5b6aa")
STONE_DARK = L.srgb("#55584f")
MOSS = L.srgb("#6c9a2b")
MOSS_LIGHT = L.srgb("#b0d04c")


def stone_color(co, n, seed=0.0, moss=0.0):
    f = L.fbm(co.x * 2.2, co.y * 2.2, co.z * 2.2, seed)
    c = L.mix(STONE_DARK, STONE_LIGHT, 0.5 + f * 1.2)
    c = L.scale_col(c, 0.75 + 0.25 * L.sstep(-0.6, 0.4, n.z))
    m = L.sstep(0.45, 0.8, n.z + moss + 0.3 * L.fbm(co.x * 3, co.y * 3, co.z * 3, seed + 4))
    return L.mix(c, L.mix(MOSS, MOSS_LIGHT, 0.5 + L.n3(co.x * 5, co.y * 5, co.z * 5, seed)), m)


def moss_cap(name, coll, parent, rock, seed, thickness=0.12, coverage=0.5):
    """Moss shell grown out of the rock's own surface so it drapes like reference 15.

    Verts on up-facing areas are pushed out along the normal (lumpy), the rest are
    tucked just inside the rock, giving soft overhanging moss edges.
    """
    thr = 0.75 - coverage
    me = rock.data
    verts = []
    for v in me.vertices:
        p, n = v.co, v.normal
        mask = L.sstep(thr - 0.12, thr + 0.12, n.z + 0.4 * L.fbm(p.x * 2.2, p.y * 2.2, p.z * 2.2, seed + 11))
        lump = 0.6 + 0.4 * L.n3(p.x * 7, p.y * 7, p.z * 7, seed)
        verts.append(p + n * (thickness * mask * lump - 0.03 * (1 - mask)))
    faces = [list(f.vertices) for f in me.polygons]
    ob = L.mesh_obj(name, verts, faces, coll, parent=rock.parent, mat=L.material("LS_Moss", rough=0.95))
    L.paint(ob, lambda co, n: L.mix(MOSS, MOSS_LIGHT, L.sstep(-0.1, 0.9, n.z) * 0.75 + 0.3 * L.n3(co.x * 6, co.y * 6, co.z * 6, seed)))
    return ob


def build_rocks(display=(0, 0, 0)):
    coll = L.collection("LS_MossRocks")
    root = L.empty("MossRocks", coll, loc=display, size=0.5)
    mat = L.material("LS_Stone", rough=0.9)
    specs = [("rock_big", (1.15, 1.0, 1.25), 11, 0.5), ("rock_tall", (0.6, 0.55, 1.15), 23, 0.45),
             ("rock_flat", (1.1, 0.9, 0.45), 37, 0.75), ("rock_small", (0.45, 0.4, 0.38), 41, 0.6)]
    out = {}
    for k, (name, size, seed, cov) in enumerate(specs):
        node = L.empty(name, coll, loc=(k * 3.2, 0, 0), parent=root, size=0.3)
        r = L.chisel_rock(f"{name}_stone", size, coll, seed=seed, cuts=14, parent=node, mat=mat, loc=(0, 0, size[2] * 0.62))
        L.paint(r, lambda co, n, s=seed: stone_color(co, n, s))
        bpy_update()
        moss_cap(f"{name}_moss", coll, node, r, seed, thickness=0.05 + size[2] * 0.06, coverage=cov)
        L.collider_hull(f"COL_{name}", r, coll, parent=node)
        # little pebbles and grass at the foot of the bigger rocks
        rnd = np.random.default_rng(seed)
        if size[0] > 0.5:
            for p in range(5):
                a = rnd.random() * math.tau
                d = size[0] * (1.0 + rnd.random() * 0.35)
                pb = L.chisel_rock(f"{name}_pebble{p}", (0.09 + rnd.random() * 0.08,) * 2 + (0.07,), coll, seed=seed + p, cuts=5, parent=node, mat=mat,
                                   loc=(math.cos(a) * d, math.sin(a) * d, 0.03))
                L.paint(pb, lambda co, n, s=seed + p: stone_color(co, n, s, moss=-0.4))
            for g in range(4):
                a = rnd.random() * math.tau
                d = size[0] * (0.9 + rnd.random() * 0.2)
                parts.grass_tuft(f"{name}_tuft{g}", coll, node, (math.cos(a) * d, math.sin(a) * d, 0), seed=seed + g)
    return L.export(root, "moss_rocks.glb")


def bpy_update():
    import bpy
    bpy.context.view_layer.update()


def build_lantern_post(display=(0, 0, 0)):
    coll = L.collection("LS_LanternPost")
    root = L.empty("LanternPost", coll, loc=display, size=0.5)
    wood = L.material("LS_Wood", rough=0.85)
    post = L.box("Post", (0.16, 0.16, 2.1), coll, loc=(0, 0, 1.0), parent=root, mat=wood, bevel=0.025, warp=0.012, seed=1)
    arm = L.box("Arm", (1.05, 0.13, 0.14), coll, loc=(0.38, 0, 1.92), parent=root, mat=wood, bevel=0.02, warp=0.01, seed=2)
    brace = L.box("Brace", (0.55, 0.09, 0.09), coll, parent=root, mat=wood, bevel=0.015, seed=3)
    brace.location = (0.22, 0, 1.66)
    brace.rotation_euler = (0, math.radians(-40), 0)
    for ob, s in ((post, 1), (arm, 2), (brace, 3)):
        L.paint(ob, lambda co, n, s=s: parts.wood_color(co, n, s))
    parts.lantern("Lantern", coll, root, (0.78, 0, 1.84), rope=0.18, scale=1.2)
    L.empty("LIGHT_post", coll, loc=(0.78, 0, 1.35), parent=root, color="#ffb45a", intensity=7.0, distance=8.0)
    pts = [(0.09 * math.cos(t * 2.4), 0.09 * math.sin(t * 2.4), 0.05 + t * 0.29) for t in np.linspace(0, 6, 14)]
    parts.vine("Vine", coll, root, pts, seed=5, leaves=22)
    parts.grass_tuft("Tuft", coll, root, (0.05, 0.05, 0), seed=3, blades=12, height=0.32)
    L.collider_hull("COL_post", post, coll, parent=root)
    return L.export(root, "lantern_post.glb")


def build_fence(display=(0, 0, 0)):
    coll = L.collection("LS_Fence")
    root = L.empty("Fence", coll, loc=display, size=0.5)
    wood = L.material("LS_Wood", rough=0.85)
    obs = []
    for k, x in enumerate((-1.1, 1.1)):
        obs.append(L.box(f"Post{k}", (0.17, 0.17, 1.15), coll, loc=(x, 0, 0.5), parent=root, mat=wood, bevel=0.03, warp=0.015, seed=k))
    for k, z in enumerate((0.45, 0.82)):
        rail = L.box(f"Rail{k}", (2.6, 0.1, 0.13), coll, parent=root, mat=wood, bevel=0.02, warp=0.02, seed=10 + k)
        rail.location = (0, -0.1, z)
        rail.rotation_euler = (0, math.radians(2 - 4 * k), 0)
        obs.append(rail)
    for k, ob in enumerate(obs):
        L.paint(ob, lambda co, n, k=k: parts.wood_color(co, n, k))
    parts.vine("Vine0", coll, root, [(-1.2, -0.18, 0.55), (-0.5, -0.17, 0.95), (0.3, -0.17, 0.8), (1.1, -0.17, 0.95)], seed=2, leaves=26)
    parts.vine("Vine1", coll, root, [(-1.0, -0.17, 0.0), (-0.95, -0.18, 0.4), (-0.4, -0.16, 0.5), (0.4, -0.17, 0.42)], seed=7, leaves=16)
    for g in range(5):
        parts.grass_tuft(f"Tuft{g}", coll, root, (-1.2 + g * 0.6, -0.05, 0), seed=g, blades=10)
    L.collider_hull("COL_fence", [(-1.25, -0.2, 0), (1.25, -0.2, 0), (-1.25, 0.1, 0), (1.25, 0.1, 0),
                                  (-1.25, -0.2, 1.1), (1.25, -0.2, 1.1), (-1.25, 0.1, 1.1), (1.25, 0.1, 1.1)], coll, parent=root)
    return L.export(root, "fence.glb")


def build_lily(display=(0, 0, 0)):
    coll = L.collection("LS_Lily")
    root = L.empty("Lily", coll, loc=display, size=0.2)
    foliage = L.material("LS_Foliage", rough=0.8)
    bell_mat = L.material("LS_LilyBell", rough=0.5, emit=L.srgb("#fff3d6"), strength=0.6)
    rnd = np.random.default_rng(12)
    for s, (dx, h, lean) in enumerate(((0.0, 0.34, 0.16), (0.05, 0.27, -0.12))):
        stem = [(dx, 0, 0), (dx + lean * 0.2, 0, h * 0.6), (dx + lean * 0.75, 0, h * 0.95), (dx + lean * 1.25, 0, h * 0.85)]
        sv, sf, SP = L.tube(stem, lambda *a: 0.006, n=24, radial=5)
        L.flat_color(L.mesh_obj(f"Stem{s}", sv, sf, coll, parent=root, mat=foliage), L.srgb("#5d9a33"))
        for b in range(4 if s == 0 else 3):
            p = SP[8 + b * 4 + s]
            tip = p + Vector((0.025 * (1 if lean > 0 else -1), (rnd.random() - 0.5) * 0.03, -0.04))
            pv, pf, _ = L.tube([p, (p + tip) / 2 + Vector((0, 0, 0.012)), tip], lambda *a: 0.003, n=4, radial=4)
            L.flat_color(L.mesh_obj(f"Pedicel{s}{b}", pv, pf, coll, parent=root, mat=foliage), L.srgb("#6aa53a"))
            r = 0.028 - b * 0.002
            bell = L.lathe(f"Bell{s}{b}", [(0.0, 0.0), (r * 0.45, -0.004), (r * 0.9, -r * 0.6), (r, -r * 1.25), (r * 1.25, -r * 1.55), (r * 1.1, -r * 1.45), (r * 0.6, -r * 1.2)],
                           coll, radial=12, parent=root, mat=bell_mat)
            bell.location = tip
            # scalloped rim
            for v in bell.data.vertices:
                a = math.atan2(v.co.y, v.co.x)
                if v.co.z < -r * 1.4:
                    v.co.z -= 0.004 * (0.5 + 0.5 * math.cos(a * 6))
            L.paint(bell, lambda co, n: L.mix(L.srgb("#ffffff"), L.srgb("#f2ecc8"), 0.3))
    for k, (rot, size) in enumerate(((0.4, 0.3), (2.6, 0.26), (4.6, 0.22))):
        lf = L.leaf(f"Leaf{k}", size, size * 0.24, coll, curl=0.35, parent=root, mat=foliage, segs=10)
        lf.rotation_euler = (math.radians(55), 0, rot)
        L.paint(lf, lambda co, n: L.mix(L.srgb("#2f7a2a"), L.srgb("#6cb43c"), L.sstep(0, 0.2, co.z)))
    return L.export(root, "lily.glb")


def build_rune_stone(display=(0, 0, 0)):
    coll = L.collection("LS_RuneStone")
    root = L.empty("RuneStone", coll, loc=display, size=0.5)
    mat = L.material("LS_Stone", rough=0.9)
    main = L.chisel_rock("Slab", (0.75, 0.42, 1.25), coll, seed=77, cuts=10, parent=root, mat=mat, loc=(0, 0, 1.0))
    L.paint(main, lambda co, n: stone_color(co, n, 77, moss=-0.05))
    side = []
    for k, (x, h) in enumerate(((-0.95, 0.75), (0.95, 0.6))):
        p = L.chisel_rock(f"Pillar{k}", (0.3, 0.3, h), coll, seed=80 + k, cuts=7, parent=root, mat=mat, loc=(x, 0.1, h * 0.7))
        L.paint(p, lambda co, n, k=k: stone_color(co, n, 80 + k))
        side.append(p)
    steps = []
    for k in range(2):
        st = L.box(f"Step{k}", (1.1 - k * 0.25, 0.42, 0.16), coll, loc=(0, -0.55 + k * 0.3, 0.08 + k * 0.15), parent=root, mat=mat, bevel=0.04, warp=0.02, seed=k)
        L.paint(st, lambda co, n, k=k: stone_color(co, n, 90 + k, moss=-0.35))
        steps.append(st)
    bpy_update()
    moss_cap("Moss_top", coll, root, main, 5, thickness=0.1, coverage=0.3)
    for k, p in enumerate(side):
        moss_cap(f"Moss_p{k}", coll, root, p, 6 + k, thickness=0.06, coverage=0.35)
    rune = L.material("LS_Rune", rough=0.3, emit=L.srgb("#6ff2ff"), strength=7.0, vcol=False, base=L.srgb("#a8f6ff"))
    ring_v, ring_f = [], []
    R, rr = 0.24, 0.025
    for i in range(48):
        a = i / 48 * math.tau
        for j in range(6):
            b = j / 6 * math.tau
            ring_v.append((math.cos(a) * (R + rr * math.cos(b)), -rr * math.sin(b), math.sin(a) * (R + rr * math.cos(b))))
    for i in range(48):
        for j in range(6):
            a, b = i * 6 + j, i * 6 + (j + 1) % 6
            c, d = ((i + 1) % 48) * 6 + (j + 1) % 6, ((i + 1) % 48) * 6 + j
            ring_f.append((a, b, c, d))
    ring = L.mesh_obj("Rune_ring", ring_v, ring_f, coll, parent=root, mat=rune)
    front_y = min(v.co.y for v in main.data.vertices if abs(v.co.z - 1.15) < 0.15 and abs(v.co.x) < 0.2)
    ring.location = (0, front_y - 0.005, 1.15)
    eye = L.lathe("Rune_eye", [(0.0, 0.0), (0.07, 0.0), (0.075, 0.01), (0.0, 0.02)], coll, radial=24, parent=root, mat=rune)
    eye.rotation_euler = (math.pi / 2, 0, 0)
    eye.location = (0, front_y - 0.01, 1.15)
    L.empty("LIGHT_rune", coll, loc=(0, front_y - 0.5, 1.1), parent=root, color="#7ff4ff", intensity=4.0, distance=5.0)
    L.empty("GLOW_rune", coll, loc=(0, front_y - 0.05, 1.15), parent=root, color="#7ff4ff", size=1.4)
    L.empty("INTERACT_rune", coll, loc=(0, front_y - 0.9, 0.6), parent=root, label="Touch the rune")
    for k, ob in enumerate([main] + side + steps):
        L.collider_hull(f"COL_rune_{k}", ob, coll, parent=root)
    for g in range(6):
        a = g / 6 * math.tau + 0.3
        parts.grass_tuft(f"Tuft{g}", coll, root, (math.cos(a) * 1.0, math.sin(a) * 0.6 + 0.1, 0), seed=g, blades=11)
    return L.export(root, "rune_stone.glb")


def build_all(offset=(0, 0, 0)):
    ox, oy, oz = offset
    return {
        "rocks": build_rocks((ox, oy, oz)),
        "lantern_post": build_lantern_post((ox + 14, oy, oz)),
        "fence": build_fence((ox + 17, oy, oz)),
        "lily": build_lily((ox + 20, oy, oz)),
        "rune_stone": build_rune_stone((ox + 23, oy, oz)),
    }
