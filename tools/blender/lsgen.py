"""Little Spirit asset toolkit for Blender (run inside Blender, live via MCP or headless).

Shared helpers for the build_*.py scripts: mesh construction from Python data,
procedural parts (tubes, blobs, chiselled rocks, bells, leaves), vertex colouring,
reference image planes and GLB export.

Conventions (Blender space): Z up, asset "front" faces -Y (glTF +Z), origin at the
ground contact point, metres. Exported node name prefixes understood by the game:
  COL_*    invisible convex collision proxies
  LIGHT_*  empties where the game spawns a point light (custom prop "color")
  GLOW_*   empties for additive glow sprites
  BOUNCE_* collision proxies that bounce the player
"""
import bpy, bmesh, math, os
import numpy as np
from mathutils import Vector, Matrix, noise

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
MODELS = os.path.join(ROOT, "public", "models")
REFS = os.path.join(ROOT, "little_spirit_assets_24_individual_pngs")


# ------------------------------------------------------------------ colour
def srgb(h):
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def mix(a, b, t):
    t = max(0.0, min(1.0, t))
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def scale_col(a, s):
    return tuple(x * s for x in a)


def sstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def n3(x, y, z, seed=0.0):
    """Perlin noise in [-1, 1]."""
    return noise.noise(Vector((x + seed * 17.3, y - seed * 9.1, z + seed * 3.7)))


def fbm(x, y, z, seed=0.0, octaves=3):
    s, a, f, norm = 0.0, 0.5, 1.0, 0.0
    for _ in range(octaves):
        s += a * n3(x * f, y * f, z * f, seed)
        norm += a
        a *= 0.5
        f *= 2.1
    return s / norm


# ------------------------------------------------------------------ scene
def collection(name, clear=True, parent=None):
    coll = bpy.data.collections.get(name)
    if coll is None:
        coll = bpy.data.collections.new(name)
        (parent or bpy.context.scene.collection).children.link(coll)
    if clear:
        for ob in list(coll.objects):
            data = ob.data
            bpy.data.objects.remove(ob, do_unlink=True)
            if data is not None and data.users == 0 and isinstance(data, bpy.types.Mesh):
                bpy.data.meshes.remove(data)
    return coll


def empty(name, coll, loc=(0, 0, 0), parent=None, size=0.2, **props):
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_size = size
    ob.location = loc
    coll.objects.link(ob)
    if parent:
        ob.parent = parent
    for k, v in props.items():
        ob[k] = v
    return ob


def mesh_obj(name, verts, faces, coll, parent=None, smooth=True, mat=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    me.validate(clean_customdata=False)
    me.update()
    for p in me.polygons:
        p.use_smooth = smooth
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    if parent:
        ob.parent = parent
    if mat:
        me.materials.append(mat)
    return ob


def bm_to_obj(name, bm, coll, parent=None, smooth=True, mat=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = smooth
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    if parent:
        ob.parent = parent
    if mat:
        me.materials.append(mat)
    return ob


def material(name, rough=0.8, emit=None, strength=0.0, vcol=True, base=(1, 1, 1), metal=0.0, alpha=1.0):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        if n.type not in ("BSDF_PRINCIPLED", "OUTPUT_MATERIAL"):
            nt.nodes.remove(n)
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    bsdf.inputs["Base Color"].default_value = (*base, 1)
    if vcol:
        ca = nt.nodes.new("ShaderNodeVertexColor")
        ca.layer_name = "Col"
        nt.links.new(ca.outputs["Color"], bsdf.inputs["Base Color"])
    if emit is not None:
        bsdf.inputs["Emission Color"].default_value = (*emit, 1)
        bsdf.inputs["Emission Strength"].default_value = strength
    if alpha < 1.0:
        bsdf.inputs["Alpha"].default_value = alpha
    return mat


def paint(ob, fn):
    """fn(co: Vector (world), normal: Vector (world)) -> linear rgb."""
    me = ob.data
    mw = ob.matrix_world
    nm = mw.to_3x3().inverted_safe().transposed()
    attr = me.color_attributes.get("Col") or me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    cols = np.empty(len(me.vertices) * 4, dtype=np.float32)
    for i, v in enumerate(me.vertices):
        c = fn(mw @ v.co, (nm @ v.normal).normalized())
        cols[i * 4:i * 4 + 4] = (*c, 1.0)
    attr.data.foreach_set("color", cols)
    me.color_attributes.active_color = attr


def flat_color(ob, col):
    paint(ob, lambda co, n: col)


# ------------------------------------------------------------------ curves
def catmull(points, n):
    P = [Vector(p) for p in points]
    P = [P[0] * 2 - P[1]] + P + [P[-1] * 2 - P[-2]]
    out = []
    segs = len(points) - 1
    for i in range(n + 1):
        u = i / n * segs
        k = min(int(u), segs - 1)
        t = u - k
        p0, p1, p2, p3 = P[k], P[k + 1], P[k + 2], P[k + 3]
        t2, t3 = t * t, t * t * t
        out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    return out


def frames(P):
    T = []
    for i in range(len(P)):
        a = P[max(i - 1, 0)]
        b = P[min(i + 1, len(P) - 1)]
        T.append((b - a).normalized())
    ref = Vector((0, 0, 1)) if abs(T[0].z) < 0.9 else Vector((1, 0, 0))
    N = [(ref - T[0] * ref.dot(T[0])).normalized()]
    for i in range(1, len(P)):
        n = N[-1] - T[i] * N[-1].dot(T[i])
        N.append(n.normalized())
    B = [t.cross(n) for t, n in zip(T, N)]
    return T, N, B


def tube(points, radius, n=24, radial=12, cap=True):
    """Return (verts, faces, rings) for a tube along a Catmull-Rom spline.

    radius(t, ang, centre, dir) -> r ; ang is the world-space azimuth of dir.
    """
    P = catmull(points, n)
    T, N, B = frames(P)
    verts, faces = [], []
    for i, c in enumerate(P):
        t = i / n
        for j in range(radial):
            a = j / radial * math.tau
            d = N[i] * math.cos(a) + B[i] * math.sin(a)
            r = radius(t, math.atan2(d.y, d.x), c, d)
            verts.append(c + d * r)
    for i in range(n):
        for j in range(radial):
            a = i * radial + j
            b = i * radial + (j + 1) % radial
            faces.append((a, b, b + radial, a + radial))
    if cap:
        tip = len(verts)
        verts.append(P[-1] + T[-1] * radius(1.0, 0, P[-1], N[-1]) * 0.6)
        base = n * radial
        for j in range(radial):
            faces.append((base + j, base + (j + 1) % radial, tip))
    return verts, faces, P


def icosphere(subdiv=3, radius=1.0):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=radius)
    verts = [v.co.copy() for v in bm.verts]
    faces = [[v.index for v in f.verts] for f in bm.faces]
    bm.free()
    return verts, faces


def blob(name, centre, size, coll, seed=0.0, rough=0.25, freq=1.8, subdiv=3, parent=None, mat=None, flatten=None, lumps=0.08):
    """Lumpy cauliflower-like volume (canopy clump, moss cushion, bush)."""
    vs, fs = icosphere(subdiv)
    out = []
    sx, sy, sz = size
    for v in vs:
        n = v.normalized()
        d = 1 + rough * fbm(n.x * freq, n.y * freq, n.z * freq, seed) * 1.6 + lumps * n3(n.x * 6, n.y * 6, n.z * 6, seed + 5)
        p = Vector((n.x * sx * d, n.y * sy * d, n.z * sz * d))
        if flatten is not None and p.z < -flatten * sz:
            p.z = -flatten * sz + (p.z + flatten * sz) * 0.15
        out.append(p + Vector(centre))
    return mesh_obj(name, out, fs, coll, parent=parent, mat=mat)


def chisel_rock(name, size, coll, seed=0, cuts=9, parent=None, mat=None, loc=(0, 0, 0)):
    """Stylised faceted boulder: an icosphere flattened by random planar cuts."""
    rnd = np.random.default_rng(seed)
    vs, fs = icosphere(4)
    planes = []
    for _ in range(cuts):
        d = Vector(rnd.normal(size=3)).normalized()
        d.z = abs(d.z) * 0.6 + d.z * 0.4
        planes.append((d.normalized(), 0.62 + rnd.random() * 0.25))
    out = []
    for v in vs:
        p = v.copy()
        for d, off in planes:
            h = p.dot(d)
            if h > off:
                p -= d * (h - off) * 0.97
        p *= 1 + 0.035 * n3(p.x * 4, p.y * 4, p.z * 4, seed)
        p = Vector((p.x * size[0], p.y * size[1], p.z * size[2]))
        if p.z < -0.35 * size[2]:
            p.z = -0.35 * size[2] + (p.z + 0.35 * size[2]) * 0.3
        out.append(p + Vector(loc))
    return mesh_obj(name, out, fs, coll, parent=parent, mat=mat)


def lathe(name, profile, coll, radial=16, parent=None, mat=None):
    """Revolve [(r, z), ...] around Z."""
    verts, faces = [], []
    for r, z in profile:
        for j in range(radial):
            a = j / radial * math.tau
            verts.append((r * math.cos(a), r * math.sin(a), z))
    for i in range(len(profile) - 1):
        for j in range(radial):
            a = i * radial + j
            b = i * radial + (j + 1) % radial
            faces.append((a, b, b + radial, a + radial))
    return mesh_obj(name, verts, faces, coll, parent=parent, mat=mat)


def leaf(name, length, width, coll, curl=0.25, parent=None, mat=None, segs=8):
    """Lanceolate leaf blade along +Y, curling down toward the tip."""
    verts, faces = [], []
    for i in range(segs + 1):
        t = i / segs
        w = width * math.sin(math.pi * min(1, t * 1.05)) ** 0.8 * (1 - 0.15 * t)
        y = t * length
        z = -curl * length * t * t
        fold = 0.25 * w
        verts += [(-w, y, z + fold * 0.3), (0, y, z - fold * 0.1), (w, y, z + fold * 0.3)]
    for i in range(segs):
        a = i * 3
        faces += [(a, a + 1, a + 4, a + 3), (a + 1, a + 2, a + 5, a + 4)]
    return mesh_obj(name, verts, faces, coll, parent=parent, mat=mat)


def box(name, size, coll, loc=(0, 0, 0), parent=None, mat=None, bevel=0.02, warp=0.0, seed=0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges) + list(bm.verts), offset=bevel, segments=2, affect="EDGES")
    bmesh.ops.subdivide_edges(bm, edges=[e for e in bm.edges if e.calc_length() > max(size) * 0.3], cuts=3, use_grid_fill=True)
    for v in bm.verts:
        if warp:
            v.co += Vector((n3(v.co.x * 2, v.co.y * 2, v.co.z * 2, seed), n3(v.co.y * 2, v.co.z * 2, v.co.x * 2, seed), 0)) * warp
        v.co += Vector(loc)
    return bm_to_obj(name, bm, coll, parent=parent, mat=mat, smooth=False)


def collider_hull(name, ob_or_points, coll, parent=None):
    """Convex hull proxy (named COL_*) from an object's verts or a point list."""
    if isinstance(ob_or_points, bpy.types.Object):
        bpy.context.view_layer.update()
        m = ob_or_points.matrix_world
        if parent:
            m = parent.matrix_world.inverted() @ m
        pts = [m @ v.co for v in ob_or_points.data.vertices]
    else:
        pts = [Vector(p) for p in ob_or_points]  # already in parent space
    bm = bmesh.new()
    for p in pts:
        bm.verts.new(p)
    bmesh.ops.convex_hull(bm, input=bm.verts)
    bmesh.ops.dissolve_limit(bm, angle_limit=0.2, verts=bm.verts, edges=bm.edges)
    ob = bm_to_obj(name, bm, coll, parent=parent, smooth=False)
    ob.display_type = "WIRE"
    ob.hide_render = True
    return ob


# ------------------------------------------------------------------ refs / export
def ref_plane(filename, coll, loc, height=3.0, rot_z=0.0):
    path = os.path.join(REFS, filename)
    img = bpy.data.images.get(filename) or bpy.data.images.load(path)
    w, h = img.size
    sx = height * w / h
    name = "REF_" + os.path.splitext(filename)[0]
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=0.5)
    uv = bm.loops.layers.uv.new()
    for f in bm.faces:
        for l in f.loops:
            l[uv].uv = (l.vert.co.x + 0.5, l.vert.co.y + 0.5)
    for v in bm.verts:
        v.co = Vector((v.co.x * sx, 0, (v.co.y + 0.5) * height))
    ob = bm_to_obj(name, bm, coll, smooth=False)
    ob.location = loc
    ob.rotation_euler = (0, 0, rot_z)
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = img
    em = nt.nodes.new("ShaderNodeEmission")
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(tex.outputs["Color"], em.inputs["Color"])
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    ob.data.materials.append(mat)
    return ob


def export(root, filename):
    """Export root and its descendants as a GLB in public/models (root temporarily at origin)."""
    saved = root.location.copy()
    root.location = (0, 0, 0)
    bpy.context.view_layer.update()
    for ob in bpy.context.view_layer.objects:
        ob.select_set(False)
    for ob in [root] + list(root.children_recursive):
        ob.select_set(True)
    os.makedirs(MODELS, exist_ok=True)
    path = os.path.join(MODELS, filename)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True, export_apply=True,
        export_vertex_color="MATERIAL", export_extras=True, export_yup=True,
        export_texcoords=False, export_lights=False, export_cameras=False,
    )
    for ob in [root] + list(root.children_recursive):
        ob.select_set(False)
    root.location = saved
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in root.children_recursive
               if o.type == "MESH" and not o.name.startswith(("COL_", "BOUNCE_")))
    return {"file": path, "tris": tris, "kb": os.path.getsize(path) // 1024}
