"""Reusable prop parts shared by several Little Spirit assets."""
import math
import numpy as np
from mathutils import Vector
import lsgen as L

IRON = L.srgb("#2c2622")
WOOD = L.srgb("#7a5534")
WOOD_LIGHT = L.srgb("#a27a4e")
WOOD_DARK = L.srgb("#4a3221")
VINE = L.srgb("#4f8a2a")
VINE_LIGHT = L.srgb("#94c447")


def wood_color(co, n, seed=0.0):
    grain = L.fbm(co.x * 1.5, co.y * 1.5, co.z * 14, seed)
    c = L.mix(WOOD_DARK, WOOD_LIGHT, 0.5 + grain * 1.1)
    return L.mix(c, L.srgb("#6f8f35"), L.sstep(0.55, 0.9, n.z) * 0.5)


def lantern(name, coll, parent, hang, rope=1.0, scale=1.0):
    """Hanging lantern: rope from `hang` down, iron cage, warm emissive glass."""
    iron = L.material("LS_Iron", rough=0.55, metal=0.6)
    glass = L.material("LS_LanternGlass", rough=0.3, emit=L.srgb("#ffb24d"), strength=8.0, vcol=False, base=L.srgb("#ffd79a"))
    hang = Vector(hang)
    top = hang - Vector((0, 0, rope))
    s = scale
    rv, rf, _ = L.tube([hang, (hang + top) / 2 + Vector((0.02, 0, 0)), top], lambda *a: 0.012 * s, n=6, radial=5, cap=False)
    L.flat_color(L.mesh_obj(f"{name}_Rope", rv, rf, coll, parent=parent, mat=iron), L.srgb("#3a2e24"))
    c = top - Vector((0, 0, 0.26 * s))
    roof = L.lathe(f"{name}_Roof", [(0.02 * s, 0.17 * s), (0.17 * s, 0.05 * s), (0.18 * s, 0.03 * s), (0.12 * s, 0.03 * s)], coll, radial=6, parent=parent, mat=iron)
    roof.location = c + Vector((0, 0, 0.12 * s))
    L.flat_color(roof, IRON)
    base = L.lathe(f"{name}_Base", [(0.13 * s, 0.0), (0.14 * s, -0.03 * s), (0.09 * s, -0.07 * s), (0.0, -0.08 * s)], coll, radial=6, parent=parent, mat=iron)
    base.location = c - Vector((0, 0, 0.12 * s))
    L.flat_color(base, IRON)
    g = L.lathe(f"{name}_Glass", [(0.0, -0.12 * s), (0.11 * s, -0.12 * s), (0.12 * s, 0.0), (0.105 * s, 0.12 * s), (0.0, 0.12 * s)], coll, radial=6, parent=parent, mat=glass)
    g.location = c
    for k in range(6):
        a = k / 6 * math.tau + math.pi / 6
        p = c + Vector((math.cos(a), math.sin(a), 0)) * 0.125 * s
        bv, bf, _ = L.tube([p - Vector((0, 0, 0.13 * s)), p + Vector((0, 0, 0.13 * s))], lambda *a: 0.008 * s, n=1, radial=4, cap=False)
        L.flat_color(L.mesh_obj(f"{name}_Bar{k}", bv, bf, coll, parent=parent, mat=iron), IRON)
    L.empty(f"GLOW_{name}", coll, loc=c, parent=parent, color="#ffb45a", size=1.4 * s)
    return c


def vine(name, coll, parent, points, seed=0, leaves=14, radius=0.018, leaf_size=0.09):
    rnd = np.random.default_rng(seed)
    mat = L.material("LS_Foliage", rough=0.8)
    vv, vf, VP = L.tube(points, lambda *a: radius, n=max(8, len(points) * 6), radial=5)
    ob = L.mesh_obj(name, vv, vf, coll, parent=parent, mat=mat)
    L.flat_color(ob, VINE)
    for k in range(leaves):
        p = VP[int(rnd.random() * (len(VP) - 1))]
        lf = L.leaf(f"{name}_Leaf{k}", leaf_size * (0.7 + rnd.random() * 0.6), leaf_size * 0.45, coll, curl=0.3, parent=parent, mat=mat, segs=4)
        lf.location = p
        lf.rotation_euler = (rnd.random() * 1.2 - 0.3, rnd.random() * 0.6 - 0.3, rnd.random() * math.tau)
        L.paint(lf, lambda co, n, k=k: L.mix(VINE, VINE_LIGHT, 0.3 + 0.5 * ((k * 0.37) % 1)))
    return ob


def grass_tuft(name, coll, parent, loc, seed=0, blades=9, height=0.28):
    rnd = np.random.default_rng(seed)
    mat = L.material("LS_Foliage", rough=0.8)
    verts, faces = [], []
    for b in range(blades):
        a = rnd.random() * math.tau
        tilt = 0.25 + rnd.random() * 0.35
        h = height * (0.6 + rnd.random() * 0.6)
        w = 0.022
        d = Vector((math.cos(a), math.sin(a), 0))
        side = Vector((-d.y, d.x, 0))
        o = len(verts)
        for i in range(4):
            t = i / 3
            c = Vector(loc) + d * (tilt * h * t * t) + Vector((0, 0, h * t))
            ww = w * (1 - t) + 0.002
            verts += [c - side * ww, c + side * ww]
        for i in range(3):
            faces.append((o + i * 2, o + i * 2 + 1, o + i * 2 + 3, o + i * 2 + 2))
    ob = L.mesh_obj(name, verts, faces, coll, parent=parent, mat=mat)
    L.paint(ob, lambda co, n: L.mix(L.srgb("#3f7a26"), L.srgb("#9cc84c"), L.sstep(0, height, co.z - loc[2])))
    return ob
