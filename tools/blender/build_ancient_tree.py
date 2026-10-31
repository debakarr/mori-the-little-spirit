"""Ancient tree (reference 14_ancient_tree.png).

Buttressed mossy trunk with an arched hollow doorway facing -Y, stone steps,
ground-hugging roots, spreading limbs, a clumpy cauliflower canopy and two
hanging lanterns. Exports public/models/ancient_tree.glb.
"""
import math
import numpy as np
from mathutils import Vector
import lsgen as L
import parts

DOOR_ANG = -math.pi / 2  # doorway faces -Y (game +Z)
BARK = L.srgb("#6e4c34")
BARK_LIGHT = L.srgb("#9a7653")
BARK_DARK = L.srgb("#3b2a1f")
MOSS = L.srgb("#6f9a2e")
MOSS_LIGHT = L.srgb("#a7c84a")
HOLLOW = L.srgb("#1a120d")
LEAF_TOP = L.srgb("#b4d65a")
LEAF_MID = L.srgb("#6aa338")
LEAF_DARK = L.srgb("#2d5a2a")


def angdiff(a, b):
    return (a - b + math.pi) % math.tau - math.pi


def bark_color(co, n, seed=0.0, moss_bias=0.0):
    streak = L.fbm(co.x * 2.5, co.y * 2.5, co.z * 0.35, seed)
    fine = L.n3(co.x * 9, co.y * 9, co.z * 1.5, seed + 2)
    c = L.mix(BARK_DARK, BARK_LIGHT, 0.45 + streak * 0.9 + fine * 0.15)
    moss = L.sstep(0.45, 0.85, n.z + 0.35 * L.fbm(co.x * 1.3, co.y * 1.3, co.z * 1.3, seed + 7) + moss_bias)
    moss = max(moss, L.sstep(0.6, 0.0, co.z) * L.sstep(0.0, 0.3, L.fbm(co.x * 1.1, co.y * 1.1, co.z * 2, seed + 3)))
    m = L.mix(MOSS, MOSS_LIGHT, 0.5 + L.n3(co.x * 4, co.y * 4, co.z * 4, seed + 9))
    return L.mix(c, m, moss)


CARVE = []  # per-vertex doorway mask, filled in vertex order while the trunk tube is built


def trunk_radius(t, ang, c, d):
    z = c.z
    base = 1.45 - 0.55 * t
    flare = 1.35 * math.exp(-max(z, 0.0) * 0.95)
    lobe = (0.5 + 0.5 * math.cos(ang * 6 + 0.5 * z + 0.4)) ** 4
    da = abs(angdiff(ang, DOOR_ANG))
    lobe *= L.sstep(0.35, 0.9, da)  # keep buttresses from hiding the doorway
    r = base + flare * (0.3 + 0.95 * lobe)
    r += 0.07 * L.n3(math.cos(ang) * 2, math.sin(ang) * 2, z * 1.4, 1)
    # arched hollow: straight jambs to 1.35 m, then a rounded arch closing at ~2.45 m
    half = 0.3 if z < 1.35 else 0.3 * max(0.0, 1 - ((z - 1.35) / 1.1) ** 2) ** 0.5
    k = 0.0
    if -0.3 < z < 2.6:
        k = L.sstep(half + 0.05, half - 0.03, da) * L.sstep(-0.3, -0.1, z)
        # bark lip framing the opening (jambs + arch)
        lip = math.exp(-((da - half - 0.07) / 0.06) ** 2) * L.sstep(2.7, 2.2, z)
        r = r * (1 - 0.6 * k) + 0.32 * lip * (1 - k)
    CARVE.append(k)
    return r


def build(coll_name="LS_AncientTree", display=(0, 0, 0)):
    coll = L.collection(coll_name)
    root = L.empty("AncientTree", coll, loc=display, size=1.0)
    bark_mat = L.material("LS_Bark", rough=0.92)
    leaf_mat = L.material("LS_Canopy", rough=0.85)
    stone_mat = L.material("LS_Stone", rough=0.9)

    # ---- trunk
    spine = [(0, 0, -0.8), (0.0, 0.05, 1.2), (0.2, -0.02, 3.0), (0.05, 0.14, 4.6), (-0.12, 0.05, 6.0), (-0.1, 0.1, 7.0)]
    CARVE.clear()
    v, f, P = L.tube(spine, trunk_radius, n=84, radial=96, cap=True)
    carve = CARVE[:len(v)]
    trunk = L.mesh_obj("Trunk", v, f, coll, parent=root, mat=bark_mat)


    def trunk_col(co, n, it=iter(range(len(v)))):
        k = carve[next(it)]
        c = bark_color(co, n)
        glow = L.sstep(1.6, 0.0, co.z) * 0.35
        return L.mix(c, L.mix(HOLLOW, L.srgb("#24464a"), glow), L.sstep(0.05, 0.6, k))
    L.paint(trunk, trunk_col)

    # ---- roots (none directly in front of the doorway)
    rnd = np.random.default_rng(4)
    root_angles = [DOOR_ANG + s * a for s, a in ((1, 0.8), (-1, 0.8), (1, 1.6), (-1, 1.7), (1, 2.5), (-1, 2.45), (1, 3.14))]
    root_cols = []
    for i, a in enumerate(root_angles):
        a += rnd.normal() * 0.08
        d = Vector((math.cos(a), math.sin(a), 0))
        side = Vector((-d.y, d.x, 0)) * rnd.normal() * 0.35
        L_ = 4.2 + rnd.random() * 1.6
        pts = [d * 1.0 + Vector((0, 0, 1.1)), d * 2.0 + Vector((0, 0, 0.45)), d * (L_ * 0.6) + side * 0.5 + Vector((0, 0, 0.12)),
               d * L_ * 0.85 + side + Vector((0, 0, -0.02)), d * L_ + side * 1.3 + Vector((0, 0, -0.35))]
        r0 = 0.55 + rnd.random() * 0.12
        rv, rf, RP = L.tube(pts, lambda t, ang, c, dd, r0=r0: (r0 * (1 - t) ** 1.25 + 0.035) * (1 + 0.08 * L.n3(c.x * 3, c.y * 3, ang, i)), n=20, radial=12)
        ro = L.mesh_obj(f"Root_{i}", rv, rf, coll, parent=root, mat=bark_mat)
        L.paint(ro, lambda co, n, i=i: bark_color(co, n, i, moss_bias=-0.12))
        # collision: two hull chunks along the exposed part of the root
        ring = 12
        for k, (s, e) in enumerate(((0, 8), (7, 14))):
            chunk = [rv[j] for j in range(s * ring, min(e * ring, len(rv) - 1))]
            root_cols.append((f"COL_root_{i}_{k}", chunk))

    # ---- limbs, sub-branches and canopy clumps
    clumps = []
    lanterns = []
    limb_specs = [(0.35, 4.9), (1.45, 5.5), (2.55, 5.0), (3.5, 5.7), (4.55, 5.1), (5.5, 5.6)]
    for i, (a, h) in enumerate(limb_specs):
        a += rnd.normal() * 0.1
        d = Vector((math.cos(a), math.sin(a), 0))
        length = 5.4 + rnd.random() * 1.6
        rise = 1.4 + rnd.random() * 0.8
        base = Vector((0, 0, h))
        pts = [base, base + d * 1.2 + Vector((0, 0, rise * 0.45)), base + d * length * 0.55 + Vector((0, 0, rise * 0.85)),
               base + d * length * 0.85 + Vector((0, 0, rise * 0.95)), base + d * length + Vector((0, 0, rise * 0.75))]
        lv, lf, LP = L.tube(pts, lambda t, ang, c, dd: 0.62 * (1 - t * 0.8) ** 1.3 * (1 + 0.06 * L.n3(c.x * 2, c.y * 2, c.z * 2, 5)), n=24, radial=14)
        limb = L.mesh_obj(f"Limb_{i}", lv, lf, coll, parent=root, mat=bark_mat)
        L.paint(limb, lambda co, n, i=i: bark_color(co, n, 10 + i, moss_bias=0.1))
        clumps.append((LP[-1] + Vector((0, 0, 0.7)), 2.0 + rnd.random() * 0.5))
        clumps.append((LP[13] + Vector((0, 0, 1.7)), 1.8 + rnd.random() * 0.4))
        for s, tt in ((1, 0.55), (-1, 0.78)):
            sp = LP[int(tt * 24)]
            sd = (d + Vector((-d.y, d.x, 0)) * s * 0.9).normalized()
            spts = [sp, sp + sd * 0.9 + Vector((0, 0, 0.7)), sp + sd * 1.9 + Vector((0, 0, 1.1))]
            sv, sf, SP = L.tube(spts, lambda t, ang, c, dd: 0.17 * (1 - t * 0.75), n=10, radial=8)
            sb = L.mesh_obj(f"Branch_{i}_{s}", sv, sf, coll, parent=root, mat=bark_mat)
            L.paint(sb, lambda co, n: bark_color(co, n, 20 + i))
            clumps.append((SP[-1] + Vector((0, 0, 0.55)), 1.5 + rnd.random() * 0.35))
        if i in (1, 4):
            lanterns.append(LP[10])
    # crown
    for s in (-1, 1):
        cp = [(0, 0, 6.0), (s * 1.0, 0.3, 8.3), (s * 1.7, 0.2, 9.6)]
        cv, cf, CP = L.tube(cp, lambda t, ang, c, dd: 0.42 * (1 - t * 0.8), n=12, radial=10)
        cr = L.mesh_obj(f"Crown_{s}", cv, cf, coll, parent=root, mat=bark_mat)
        L.paint(cr, lambda co, n: bark_color(co, n, 30))
        clumps.append((CP[-1] + Vector((0, 0, 0.8)), 2.6))
    clumps += [((0, 0, 11.0), 2.6), ((2.4, -1.8, 10.0), 2.1), ((-2.6, 1.5, 10.2), 2.2), ((1.8, 2.6, 9.8), 2.0), ((-2.0, -2.4, 9.7), 1.9)]

    for k, (c, r) in enumerate(clumps):
        b = L.blob(f"Canopy_{k}", c, (r, r, r * 0.62), coll, seed=k * 1.7, rough=0.2, freq=2.0, lumps=0.025, subdiv=3, parent=root, mat=leaf_mat)

        def leaf_col(co, n, k=k, c=Vector(c), r=r):
            up = n.z * 0.5 + 0.5
            spec = L.n3(co.x * 3.5, co.y * 3.5, co.z * 3.5, k)
            col = L.mix(LEAF_DARK, LEAF_MID, L.sstep(0.05, 0.6, up + spec * 0.25))
            col = L.mix(col, LEAF_TOP, L.sstep(0.62, 0.95, up + spec * 0.2))
            under = L.sstep(-0.1, -0.7, n.z)
            col = L.mix(col, L.scale_col(LEAF_DARK, 0.55), under * 0.8)
            occl = L.sstep(5.5, 11.0, co.z) * 0.3 + 0.7
            return L.scale_col(col, occl)
        L.paint(b, leaf_col)
        b["canopy"] = 1

    # ---- doorway: stone steps, inner glow
    for k in range(3):
        st = L.box(f"Step_{k}", (1.05 - k * 0.04, 0.5, 0.18), coll, loc=(0, -1.75 - k * 0.5, 0.24 - k * 0.12), parent=root, mat=stone_mat, bevel=0.04, warp=0.03, seed=k)
        L.paint(st, lambda co, n, k=k: L.mix(L.mix(L.srgb("#8d8a7c"), L.srgb("#b3ae9a"), 0.5 + L.n3(co.x * 5, co.y * 5, k, 2)), MOSS, L.sstep(0.55, 0.95, abs(co.x) * 1.3 + 0.2 * L.n3(co.x * 6, co.y * 6, 1, k))))
        L.collider_hull(f"COL_step_{k}", st, coll, parent=root)
    glow_mat = L.material("LS_SpiritGlow", rough=0.4, emit=L.srgb("#7ff4ff"), strength=6.0, vcol=False, base=L.srgb("#bff9ff"))
    orb = L.blob("SpiritOrb", (0, -0.9, 0.7), (0.11, 0.11, 0.11), coll, rough=0.05, subdiv=2, parent=root, mat=glow_mat)
    L.empty("LIGHT_door", coll, loc=(0, -1.5, 1.0), parent=root, color="#8ff3ff", intensity=2.5, distance=4.5)
    L.empty("GLOW_door", coll, loc=(0, -0.9, 0.7), parent=root, color="#8ff3ff", size=1.2)
    L.empty("INTERACT_door", coll, loc=(0, -2.2, 0.6), parent=root, label="Listen")

    # ---- lanterns hanging from two limbs
    for k, p in enumerate(lanterns):
        hang = Vector(p) - Vector((0, 0, 0.35))
        parts.lantern(f"Lantern_{k}", coll, root, hang, rope=1.1 + 0.3 * k)
        L.empty(f"LIGHT_lantern_{k}", coll, loc=hang - Vector((0, 0, 1.45 + 0.3 * k)), parent=root, color="#ffb45a", intensity=6.0, distance=7.0)

    # ---- collision
    trunk_pts = []
    for z in np.linspace(-0.5, 6.0, 9):
        r = 1.9 if z < 1.0 else 1.55 - 0.04 * z
        trunk_pts += [(r * math.cos(a), r * math.sin(a), z) for a in np.linspace(0, math.tau, 20, endpoint=False)]
    L.collider_hull("COL_trunk", trunk_pts, coll, parent=root)
    for name, pts in root_cols:
        L.collider_hull(name, pts, coll, parent=root)

    return L.export(root, "ancient_tree.glb")
