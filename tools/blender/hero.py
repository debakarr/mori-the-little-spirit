"""Hero-asset pass built on the blender-agent-skills scripts (.claude/skills).

Recipe 2 from blender-workflow-recipes ("game prop, high -> low baked"):
  parts --join--> X_high --voxel remesh + detail (sculpt_ops)--> procedural Cycles material
        --decimate (auto_retopo)--> SM_X --uv_pack--> bake BC/N/AO/R + ORM (bake_maps)
        --> build_pbr_material --> QA (qa_check) --> export (export_asset, preset web)
"""
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SKILLS = os.path.join(ROOT, ".claude", "skills")
for s in ("blender-sculpting", "blender-retopology-uv", "blender-texture-baking", "blender-pbr-materials",
          "blender-asset-qa", "blender-export-pipelines", "blender-game-optimization"):
    p = os.path.join(SKILLS, s, "scripts")
    if p not in sys.path:
        sys.path.append(p)

import sculpt_ops  # noqa: E402
import auto_retopo  # noqa: E402
import uv_pack  # noqa: E402
import bake_maps  # noqa: E402
import build_pbr_material  # noqa: E402
import qa_check  # noqa: E402
import export_asset  # noqa: E402

TEX_ROOT = os.path.join(ROOT, "art", "textures")
BLEND_ROOT = os.path.join(ROOT, "art", "blend")
MODELS = os.path.join(ROOT, "public", "models")


# ------------------------------------------------------------------ procedural materials
def _nodes(name):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    nt = mat.node_tree
    for n in list(nt.nodes):
        if n.type not in ("BSDF_PRINCIPLED", "OUTPUT_MATERIAL"):
            nt.nodes.remove(n)
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    return mat, nt, bsdf


def _ramp(nt, stops):
    r = nt.nodes.new("ShaderNodeValToRGB")
    el = r.color_ramp.elements
    while len(el) > len(stops):
        el.remove(el[-1])
    while len(el) < len(stops):
        el.new(0.5)
    for e, (pos, col) in zip(el, stops):
        e.position = pos
        e.color = (*col, 1.0)
    return r


def _srgb(h):
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def _coords(nt, scale=(1, 1, 1)):
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = scale
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    return mp.outputs["Vector"]


def _moss_mask(nt, lo=0.45, hi=0.8, noise_scale=2.5, ground=None):
    """Moss on up-facing surfaces, broken up with noise (and optionally near the ground)."""
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(geo.outputs["Normal"], sep.inputs["Vector"])
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = noise_scale
    nz.inputs["Detail"].default_value = 6
    nt.links.new(_coords(nt), nz.inputs["Vector"])
    add = nt.nodes.new("ShaderNodeMath"); add.operation = "ADD"
    nt.links.new(sep.outputs["Z"], add.inputs[0])
    off = nt.nodes.new("ShaderNodeMath"); off.operation = "MULTIPLY_ADD"
    nt.links.new(nz.outputs["Fac"], off.inputs[0])
    off.inputs[1].default_value = 0.8
    off.inputs[2].default_value = -0.4
    nt.links.new(off.outputs[0], add.inputs[1])
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = lo
    mr.inputs["From Max"].default_value = hi
    nt.links.new(add.outputs[0], mr.inputs["Value"])
    out = mr.outputs["Result"]
    if ground is not None:
        tc = nt.nodes.new("ShaderNodeTexCoord")
        sz = nt.nodes.new("ShaderNodeSeparateXYZ")
        nt.links.new(tc.outputs["Object"], sz.inputs["Vector"])
        g = nt.nodes.new("ShaderNodeMapRange")
        g.inputs["From Min"].default_value = ground
        g.inputs["From Max"].default_value = 0.0
        nt.links.new(sz.outputs["Z"], g.inputs["Value"])
        gm = nt.nodes.new("ShaderNodeMath"); gm.operation = "MULTIPLY"
        nt.links.new(g.outputs["Result"], gm.inputs[0])
        nt.links.new(nz.outputs["Fac"], gm.inputs[1])
        mx = nt.nodes.new("ShaderNodeMath"); mx.operation = "MAXIMUM"
        nt.links.new(out, mx.inputs[0])
        nt.links.new(gm.outputs[0], mx.inputs[1])
        out = mx.outputs[0]
    return out


def _mix(nt, fac, a, b):
    m = nt.nodes.new("ShaderNodeMix")
    m.data_type = "RGBA"
    nt.links.new(fac, m.inputs["Factor"])
    nt.links.new(a, m.inputs["A"])
    nt.links.new(b, m.inputs["B"])
    return m.outputs["Result"]


def mat_bark(name="P_Bark", ground=0.7):
    mat, nt, bsdf = _nodes(name)
    plates = nt.nodes.new("ShaderNodeTexVoronoi")
    plates.feature = "DISTANCE_TO_EDGE"
    plates.inputs["Scale"].default_value = 2.2
    nt.links.new(_coords(nt, (2.2, 2.2, 0.35)), plates.inputs["Vector"])
    crack = _ramp(nt, [(0.0, _srgb("#24170f")), (0.06, _srgb("#4b3424")), (0.2, _srgb("#7a573b"))])
    nt.links.new(plates.outputs["Distance"], crack.inputs["Fac"])
    streak = nt.nodes.new("ShaderNodeTexNoise")
    streak.inputs["Scale"].default_value = 5
    streak.inputs["Detail"].default_value = 8
    streak.inputs["Distortion"].default_value = 0.4
    nt.links.new(_coords(nt, (3, 3, 0.4)), streak.inputs["Vector"])
    tone = _ramp(nt, [(0.3, _srgb("#5a3f2b")), (0.7, _srgb("#9a7653"))])
    nt.links.new(streak.outputs["Fac"], tone.inputs["Fac"])
    mm = nt.nodes.new("ShaderNodeMix"); mm.data_type = "RGBA"; mm.blend_type = "MULTIPLY"
    mm.inputs["Factor"].default_value = 0.85
    nt.links.new(tone.outputs["Color"], mm.inputs["A"])
    nt.links.new(crack.outputs["Color"], mm.inputs["B"])
    bright = nt.nodes.new("ShaderNodeHueSaturation")
    bright.inputs["Value"].default_value = 1.9
    nt.links.new(mm.outputs["Result"], bright.inputs["Color"])
    moss_n = nt.nodes.new("ShaderNodeTexNoise")
    moss_n.inputs["Scale"].default_value = 18
    moss_n.inputs["Detail"].default_value = 4
    moss_c = _ramp(nt, [(0.35, _srgb("#4f7d24")), (0.7, _srgb("#9fc444"))])
    nt.links.new(moss_n.outputs["Fac"], moss_c.inputs["Fac"])
    mask = _moss_mask(nt, 0.5, 0.85, 2.0, ground)
    col = _mix(nt, mask, bright.outputs["Color"], moss_c.outputs["Color"])
    nt.links.new(col, bsdf.inputs["Base Color"])
    rough = nt.nodes.new("ShaderNodeMapRange")
    rough.inputs["To Min"].default_value = 0.78
    rough.inputs["To Max"].default_value = 0.95
    nt.links.new(streak.outputs["Fac"], rough.inputs["Value"])
    nt.links.new(rough.outputs["Result"], bsdf.inputs["Roughness"])
    return mat


def mat_stone(name="P_Stone", moss=(0.45, 0.8)):
    mat, nt, bsdf = _nodes(name)
    vor = nt.nodes.new("ShaderNodeTexVoronoi")
    vor.feature = "DISTANCE_TO_EDGE"
    vor.inputs["Scale"].default_value = 1.6  # a few large fracture lines, not a cobblestone grid
    nt.links.new(_coords(nt), vor.inputs["Vector"])
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 6
    nz.inputs["Detail"].default_value = 10
    nt.links.new(_coords(nt), nz.inputs["Vector"])
    tone = _ramp(nt, [(0.25, _srgb("#6d6f68")), (0.55, _srgb("#9a9b90")), (0.8, _srgb("#c2c1b2"))])
    nt.links.new(nz.outputs["Fac"], tone.inputs["Fac"])
    crack = _ramp(nt, [(0.0, _srgb("#cfd0c8")), (0.02, _srgb("#ffffff"))])  # faint fractures only (ref 15 is smooth)
    nt.links.new(vor.outputs["Distance"], crack.inputs["Fac"])
    mm = nt.nodes.new("ShaderNodeMix"); mm.data_type = "RGBA"; mm.blend_type = "MULTIPLY"
    mm.inputs["Factor"].default_value = 1.0
    nt.links.new(tone.outputs["Color"], mm.inputs["A"])
    nt.links.new(crack.outputs["Color"], mm.inputs["B"])
    lichen = nt.nodes.new("ShaderNodeTexVoronoi")
    lichen.inputs["Scale"].default_value = 14
    nt.links.new(_coords(nt), lichen.inputs["Vector"])
    lc = _ramp(nt, [(0.0, _srgb("#b8b98a")), (0.25, _srgb("#ffffff"))])
    nt.links.new(lichen.outputs["Distance"], lc.inputs["Fac"])
    mm2 = nt.nodes.new("ShaderNodeMix"); mm2.data_type = "RGBA"; mm2.blend_type = "MULTIPLY"
    mm2.inputs["Factor"].default_value = 0.6
    nt.links.new(mm.outputs["Result"], mm2.inputs["A"])
    nt.links.new(lc.outputs["Color"], mm2.inputs["B"])
    moss_n = nt.nodes.new("ShaderNodeTexNoise")
    moss_n.inputs["Scale"].default_value = 22
    moss_c = _ramp(nt, [(0.35, _srgb("#5a8a26")), (0.7, _srgb("#a9cc48"))])
    nt.links.new(moss_n.outputs["Fac"], moss_c.inputs["Fac"])
    mask = _moss_mask(nt, moss[0], moss[1], 2.2)
    nt.links.new(_mix(nt, mask, mm2.outputs["Result"], moss_c.outputs["Color"]), bsdf.inputs["Base Color"])
    rough = nt.nodes.new("ShaderNodeMapRange")
    rough.inputs["To Min"].default_value = 0.72
    rough.inputs["To Max"].default_value = 0.95
    nt.links.new(nz.outputs["Fac"], rough.inputs["Value"])
    nt.links.new(rough.outputs["Result"], bsdf.inputs["Roughness"])
    return mat


def mat_canopy(name="P_Canopy", top=1.0):
    """Painterly leaf clumps: voronoi cells with per-cell tone, lighter on top, darker below."""
    mat, nt, bsdf = _nodes(name)
    cells = nt.nodes.new("ShaderNodeTexVoronoi")
    cells.inputs["Scale"].default_value = 3.2
    nt.links.new(_coords(nt), cells.inputs["Vector"])
    leaves = nt.nodes.new("ShaderNodeTexVoronoi")
    leaves.feature = "DISTANCE_TO_EDGE"
    leaves.inputs["Scale"].default_value = 11
    nt.links.new(_coords(nt), leaves.inputs["Vector"])
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(cells.outputs["Color"], sep.inputs["Color"])
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    nz = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(geo.outputs["Normal"], nz.inputs["Vector"])
    up = nt.nodes.new("ShaderNodeMath"); up.operation = "MULTIPLY_ADD"
    nt.links.new(nz.outputs["Z"], up.inputs[0])
    up.inputs[1].default_value = 0.35 * top
    nt.links.new(sep.outputs["Red"], up.inputs[2])
    tone = _ramp(nt, [(0.0, _srgb("#24501f")), (0.35, _srgb("#4f8a2e")), (0.7, _srgb("#86b83f")), (1.0, _srgb("#c8de6a"))])
    nt.links.new(up.outputs[0], tone.inputs["Fac"])
    edge = _ramp(nt, [(0.0, _srgb("#1e3d1a")), (0.08, _srgb("#ffffff"))])
    nt.links.new(leaves.outputs["Distance"], edge.inputs["Fac"])
    mm = nt.nodes.new("ShaderNodeMix"); mm.data_type = "RGBA"; mm.blend_type = "MULTIPLY"
    mm.inputs["Factor"].default_value = 0.7
    nt.links.new(tone.outputs["Color"], mm.inputs["A"])
    nt.links.new(edge.outputs["Color"], mm.inputs["B"])
    nt.links.new(mm.outputs["Result"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.82
    return mat


def mat_wood(name="P_Wood"):
    mat, nt, bsdf = _nodes(name)
    wave = nt.nodes.new("ShaderNodeTexWave")
    wave.wave_type = "RINGS"
    wave.inputs["Scale"].default_value = 3
    wave.inputs["Distortion"].default_value = 6
    wave.inputs["Detail"].default_value = 4
    nt.links.new(_coords(nt, (6, 6, 0.4)), wave.inputs["Vector"])
    tone = _ramp(nt, [(0.2, _srgb("#5a3a22")), (0.6, _srgb("#8c6239")), (0.9, _srgb("#b0844f"))])
    nt.links.new(wave.outputs["Fac"], tone.inputs["Fac"])
    mask = _moss_mask(nt, 0.6, 0.9, 3.0)
    moss = _ramp(nt, [(0.0, _srgb("#6f9a2e")), (1.0, _srgb("#6f9a2e"))])
    nt.links.new(_mix(nt, mask, tone.outputs["Color"], moss.outputs["Color"]), bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.8
    return mat


# ------------------------------------------------------------------ pipeline
def clean_islands(ob, min_verts):
    """QA fix for 'floating/detached part': drop tiny loose islands, weld, dissolve degenerates."""
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-4)
    seen, kill = set(), []
    for v in bm.verts:
        if v in seen:
            continue
        stack, island = [v], []
        seen.add(v)
        while stack:
            cur = stack.pop()
            island.append(cur)
            for e in cur.link_edges:
                o = e.other_vert(cur)
                if o not in seen:
                    seen.add(o)
                    stack.append(o)
        if len(island) < min_verts:
            kill += island
    bmesh.ops.delete(bm, geom=kill, context="VERTS")
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    return len(kill)


def join(objs, name):
    """Join a list of mesh objects (applying their transforms) into one new object."""
    bpy.context.view_layer.update()
    import bmesh
    bm = bmesh.new()
    for o in objs:
        me = o.data.copy()
        me.transform(o.matrix_world)
        part = bmesh.new()
        part.from_mesh(me)
        # voxel remesh needs closed volumes: open tube ends are read as thin double shells,
        # which come back as folded sheets (dark shards in game)
        bmesh.ops.holes_fill(part, edges=part.edges, sides=0)
        bmesh.ops.recalc_face_normals(part, faces=part.faces)
        part.to_mesh(me)
        part.free()
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    objs[0].users_collection[0].objects.link(ob)
    return ob


def hero(name, parts, material, voxel, tris, res=1024, detail=None, smooth=3, displace=None, samples=32,
         extrusion=None, tex_dir=None, vcol=None):
    """parts -> fused, detailed high poly -> baked game mesh SM_<name>. Returns (low, report).

    vcol: optional fn(co, normal) -> linear rgb. Instead of a UV texture set, the game mesh gets
    vertex colours = vcol * AO baked high->low into vertex colours (no UVs, so no seams), with a
    vertex-colour material named LS_Bark that the game swaps for its detail-noise bark shader.
    """
    hi = join(parts, f"{name}_high")
    for p in parts:
        bpy.data.objects.remove(p, do_unlink=True)
    # 1. fuse + smooth the blockout
    sculpt_ops.run(objects=[hi.name], ops=[f"remesh={voxel}", f"smooth={smooth}", "apply"])
    clean_islands(hi, 400)
    # 2. UV the smooth, evenly-tessellated surface (recipe 1: "UV before detailing/reducing").
    #    Neighbouring faces agree here, so smart projection forms large islands; the UVs then
    #    survive the detail displacement and the decimation below.
    if vcol is None:
        uv_pack.run(objects=[hi.name], method="smart", angle=89.0, res=res, margin_px=10)
    # 3. tertiary detail on the high
    ops = []
    if detail:
        ops.append(f"detail={detail}")
    if ops:
        sculpt_ops.run(objects=[hi.name], ops=ops)
    if displace:  # (texture type, size, strength): leaf clumps / chisel facets
        kind, size, strength = displace
        tex = bpy.data.textures.new(f"{name}_disp", kind)
        tex.noise_scale = size
        d = hi.modifiers.new("Clumps", "DISPLACE")
        d.texture, d.strength, d.texture_coords = tex, strength, "LOCAL"
    sculpt_ops.run(objects=[hi.name], ops=["apply"])
    for poly in hi.data.polygons:
        poly.use_smooth = True
    hi.data.materials.clear()
    hi.data.materials.append(material)
    high_tris = sum(len(p.vertices) - 2 for p in hi.data.polygons)

    # 4. game mesh: collapse decimation keeps the UVs laid out in step 2 and already lies on the
    #    surface. (auto_retopo's decimate path finishes with a two-way shrinkwrap projection, which
    #    snaps verts across concave areas like the trunk hollow and leaves folded slivers.)
    low = hi.copy()
    low.data = hi.data.copy()
    hi.users_collection[0].objects.link(low)
    low.name = low.data.name = f"SM_{name}"
    dec = low.modifiers.new("Decimate", "DECIMATE")
    dec.decimate_type = "COLLAPSE"
    dec.ratio = min(1.0, tris / max(high_tris, 1))
    dec.use_collapse_triangulate = True
    for m in [m.name for m in low.modifiers]:
        with bpy.context.temp_override(object=low, active_object=low, selected_objects=[low], selected_editable_objects=[low]):
            bpy.ops.object.modifier_apply(modifier=m)
    clean_islands(low, 24)
    for poly in low.data.polygons:
        poly.use_smooth = True
    # auto_retopo hides the source; selected-to-active baking needs it visible. The low gets
    # its own throwaway material so bake target nodes never land in the high's shader.
    hi.hide_set(False)
    hi.hide_render = False
    if vcol is not None:
        report = bake_vertex_colors(low, hi, vcol, samples)
        report["high_tris"] = high_tris
        hi.hide_set(True)
        hi.hide_render = True
        return low, report
    low.data.materials.clear()
    low.data.materials.append(bpy.data.materials.new(f"{name}_bake_target"))
    tex_dir = tex_dir or os.path.join(TEX_ROOT, name)
    bake = bake_maps.run(low=low.name, high=[hi.name], maps=["basecolor", "normal", "ao", "roughness"], res=res,
                         samples=samples, out=tex_dir, name=name, pack_orm=True, extrusion=extrusion,
                         margin_px=max(16, res // 32))  # wide EXTEND margin: small islands must survive mip-mapping
    files = [os.path.join(tex_dir, f"T_{name}_{s}.png") for s in ("BC", "N", "ORM")]
    low.data.materials.clear()
    build_pbr_material.run(name=f"M_{name}", textures=files, objects=[low.name])
    hi.hide_set(True)
    hi.hide_render = True
    qa = qa_check.run(objects=[low.name], profile="render")
    report = {"high_tris": high_tris, "low_tris": sum(len(p.vertices) - 2 for p in low.data.polygons),
              "bake": {k: v for k, v in bake.items() if k in ("maps", "device", "seconds", "files")},
              "qa_pass": qa.get("pass"), "qa_errors": qa.get("errors")}
    return low, report


def bake_vertex_colors(low, hi, colour_fn, samples=64):
    """blender-texture-baking "Baking non-PBR data": AO high->low with target VERTEX_COLORS,
    multiplied into a procedural colour evaluated per vertex. Returns a QA'd report."""
    import numpy as np
    import lsgen as L
    me = low.data
    for a in list(me.color_attributes):
        me.color_attributes.remove(a)
    ao = me.color_attributes.new("AO", "FLOAT_COLOR", "POINT")
    me.color_attributes.active_color = ao
    low.data.materials.clear()
    low.data.materials.append(L.material("LS_Bark", rough=0.92))
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = samples
    try:
        sc.cycles.device = "GPU"
    except TypeError:
        pass
    bake = sc.render.bake
    bake.target = "VERTEX_COLORS"
    bake.use_selected_to_active = True
    ext = low.dimensions.length * 0.01
    bake.cage_extrusion, bake.max_ray_distance = ext, ext * 2
    for o in bpy.context.view_layer.objects:
        o.select_set(o in (low, hi))
    bpy.context.view_layer.objects.active = low
    assert bpy.ops.object.bake(type="AO") == {"FINISHED"}
    n = len(me.vertices)
    occ = np.empty(n * 4, dtype=np.float32)
    ao.data.foreach_get("color", occ)
    occ = occ.reshape(-1, 4)[:, 0]
    L.paint(low, lambda co, nrm: (0, 0, 0))  # creates the "Col" attribute the material reads
    col = me.color_attributes["Col"]
    mw = low.matrix_world
    nm = mw.to_3x3().inverted_safe().transposed()
    out = np.empty(n * 4, dtype=np.float32)
    for i, v in enumerate(me.vertices):
        c = colour_fn(mw @ v.co, (nm @ v.normal).normalized())
        k = 0.35 + 0.65 * float(occ[i])
        out[i * 4:i * 4 + 4] = (c[0] * k, c[1] * k, c[2] * k, 1.0)
    col.data.foreach_set("color", out)
    me.color_attributes.active_color = col
    me.color_attributes.remove(me.color_attributes["AO"])
    bake.target = "IMAGE_TEXTURES"
    qa = qa_check.run(objects=[low.name], profile="render")
    return {"low_tris": sum(len(p.vertices) - 2 for p in me.polygons), "ao_mean": round(float(occ.mean()), 3),
            "qa_pass": qa.get("pass"), "qa_errors": qa.get("errors")}


def export_web(root, filename):
    """Export root + children (COL_/LIGHT_/GLOW_ helpers keep their extras) with the skill's web preset."""
    saved = root.location.copy()
    root.location = (0, 0, 0)
    bpy.context.view_layer.update()
    hidden = [o for o in root.children_recursive if o.name.endswith("_high")]
    for o in hidden:
        o.parent = None
    out = os.path.join(MODELS, filename)
    r = export_asset.run(preset="web", objects=[root.name], out=out,
                         set=["export_extras=True", "export_vertex_color=MATERIAL", "export_animations=False"])
    root.location = saved
    return {"file": out, "kb": os.path.getsize(out) // 1024, "summary": r.get("summary", r.get("glb"))}


def save_blend(name):
    os.makedirs(BLEND_ROOT, exist_ok=True)
    path = os.path.join(BLEND_ROOT, f"{name}.blend")
    bpy.ops.wm.save_as_mainfile(filepath=path, copy=True)
    return path
