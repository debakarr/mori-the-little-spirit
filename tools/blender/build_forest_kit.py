"""Background forest kit: two tree variants and three bushes.

Exports public/models/forest_kit.glb with top-level nodes tree_a, tree_b,
bush_a, bush_b, bush_c. The game instances these around the clearing.
"""
import math
import numpy as np
from mathutils import Vector
import lsgen as L
from build_ancient_tree import bark_color, LEAF_TOP, LEAF_MID, LEAF_DARK


def canopy_color(seed, z0, z1):
    def fn(co, n):
        up = n.z * 0.5 + 0.5
        spec = L.n3(co.x * 3, co.y * 3, co.z * 3, seed)
        c = L.mix(LEAF_DARK, LEAF_MID, L.sstep(0.05, 0.6, up + spec * 0.25))
        c = L.mix(c, LEAF_TOP, L.sstep(0.65, 0.98, up + spec * 0.2) * 0.8)
        return L.scale_col(c, 0.7 + 0.3 * L.sstep(z0, z1, co.z))
    return fn


def tree(name, coll, root, x, seed, height, spread):
    rnd = np.random.default_rng(seed)
    node = L.empty(name, coll, loc=(x, 0, 0), parent=root, size=0.5)
    bark = L.material("LS_Bark", rough=0.92)
    leaf = L.material("LS_Canopy", rough=0.85)
    lean = Vector((rnd.normal() * 0.3, rnd.normal() * 0.3, 0))
    spine = [(0, 0, -0.5), (0, 0, height * 0.3), Vector((0, 0, height * 0.6)) + lean, Vector((0, 0, height * 0.82)) + lean * 1.4]
    v, f, P = L.tube(spine, lambda t, a, c, d: (0.45 - 0.28 * t) + 0.35 * math.exp(-max(c.z, 0) * 2) * (0.5 + 0.5 * math.cos(a * 5)) ** 3, n=16, radial=14)
    L.paint(L.mesh_obj(f"{name}_trunk", v, f, coll, parent=node, mat=bark), lambda co, n: bark_color(co, n, seed))
    clumps = [(P[-1] + Vector((0, 0, 1.0)), spread * 0.8)]
    for k in range(4):
        a = k / 4 * math.tau + rnd.random()
        h = height * (0.55 + rnd.random() * 0.2)
        d = Vector((math.cos(a), math.sin(a), 0))
        base = Vector((0, 0, h))
        tip = base + d * spread * (0.8 + rnd.random() * 0.4) + Vector((0, 0, 1.3))
        bv, bf, BP = L.tube([base, base + d * spread * 0.4 + Vector((0, 0, 0.9)), tip], lambda t, *a: 0.22 * (1 - 0.8 * t), n=8, radial=7)
        L.paint(L.mesh_obj(f"{name}_limb{k}", bv, bf, coll, parent=node, mat=bark), lambda co, n: bark_color(co, n, seed + k))
        clumps.append((tip + Vector((0, 0, 0.5)), spread * (0.6 + rnd.random() * 0.2)))
    for k, (c, r) in enumerate(clumps):
        b = L.blob(f"{name}_leaf{k}", c, (r, r, r * 0.75), coll, seed=seed * 3 + k, rough=0.22, freq=2.0, subdiv=3, parent=node, mat=leaf)
        L.paint(b, canopy_color(seed + k, height * 0.4, height * 1.1))
        b["canopy"] = 1
    return node


def bush(name, coll, root, x, seed, size):
    rnd = np.random.default_rng(seed)
    node = L.empty(name, coll, loc=(x, 0, 0), parent=root, size=0.3)
    leaf = L.material("LS_Canopy", rough=0.85)
    for k in range(3 + int(size > 1)):
        a = rnd.random() * math.tau
        d = rnd.random() * size * 0.5
        r = size * (0.55 + rnd.random() * 0.3)
        b = L.blob(f"{name}_{k}", (math.cos(a) * d, math.sin(a) * d, r * 0.45), (r, r * 0.9, r * 0.7), coll, seed=seed + k, rough=0.25,
                   freq=2.4, subdiv=3, parent=node, mat=leaf, flatten=0.4)
        L.paint(b, canopy_color(seed + k, -0.2, size * 1.2))
        b["canopy"] = 1
    return node


def build(display=(0, 0, 0)):
    coll = L.collection("LS_ForestKit")
    root = L.empty("ForestKit", coll, loc=display, size=1.0)
    tree("tree_a", coll, root, 0, 101, 11.0, 3.2)
    tree("tree_b", coll, root, 9, 202, 9.0, 2.6)
    bush("bush_a", coll, root, 15, 7, 1.3)
    bush("bush_b", coll, root, 18, 8, 0.9)
    bush("bush_c", coll, root, 20.5, 9, 0.6)
    return L.export(root, "forest_kit.glb")
