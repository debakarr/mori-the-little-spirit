"""Anime (cel) look helpers for Mori, used by rig_mori_mesh2motion.py and in the live session.

smooth_normals(ob)  diffuses vertex normals over the welded surface and stores them as custom normals,
                    so a cel ramp draws a few clean shapes instead of every lump of the sculpt
                    (the usual anime-character trick; the exported GLB carries these normals).
preview(ob)         Blender-only look-dev: EEVEE Shader-to-RGB ramp with cool shadows, a rim and an
                    inverted-hull outline, close to what src/player/toonMaterial.js draws in game.

Live:  python3 tools/blender/mcp_run.py --toon     (imports public/models/mori.glb into a "Mori Toon" scene)
"""
import bpy
import numpy as np

SHADOW = (0.55, 0.52, 0.78)  # cool lilac shadow tint, as in the game shader
OUTLINE = (0.07, 0.05, 0.12)


def smooth_normals(ob, iterations=12, keep=0.35):
    """Average each vertex normal with its neighbours `iterations` times (UV-seam copies welded by
    position so seams stay invisible), then blend `keep` of the original back in."""
    me = ob.data
    nv = len(me.vertices)
    P = np.empty(nv * 3); me.vertices.foreach_get("co", P); P = P.reshape(-1, 3)
    N = np.empty(nv * 3); me.vertices.foreach_get("normal", N); N = N.reshape(-1, 3)
    _, weld = np.unique(np.round(P, 5), axis=0, return_inverse=True)
    weld = weld.ravel()
    nu = weld.max() + 1
    E = np.empty(len(me.edges) * 2, int); me.edges.foreach_get("vertices", E)
    E = weld[E.reshape(-1, 2)]
    E = E[E[:, 0] != E[:, 1]]
    base = np.zeros((nu, 3)); np.add.at(base, weld, N)
    base /= np.linalg.norm(base, axis=1, keepdims=True) + 1e-9
    n = base.copy()
    for _ in range(iterations):
        acc = n.copy()
        np.add.at(acc, E[:, 0], n[E[:, 1]])
        np.add.at(acc, E[:, 1], n[E[:, 0]])
        n = acc / (np.linalg.norm(acc, axis=1, keepdims=True) + 1e-9)
    n = n * (1 - keep) + base * keep
    n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-9
    for p in me.polygons:
        p.use_smooth = True
    me.normals_split_custom_set_from_vertices(n[weld].tolist())
    return {"verts": nv, "welded": int(nu), "iterations": iterations}


def _rgba(node, name, out=False):
    """Colour socket `name` of a Mix node (it also has float/vector sockets of the same name)."""
    return next(s for s in (node.outputs if out else node.inputs) if s.name == name and s.type == "RGBA")


def _toon_material(src):
    """Shader-to-RGB cel ramp over the painted base colour of `src` (Principled material)."""
    m = bpy.data.materials.new(src.name + "_Toon")
    nt = m.node_tree
    nt.nodes.clear()
    bsdf = next(n for n in src.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    base = bsdf.inputs["Base Color"].links
    tex = base[0].from_node if base and base[0].from_node.type == "TEX_IMAGE" else None
    N = nt.nodes.new
    out = N("ShaderNodeOutputMaterial")
    diff = N("ShaderNodeBsdfDiffuse")
    s2r = N("ShaderNodeShaderToRGB")
    ramp = N("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "EASE"
    e = ramp.color_ramp.elements
    e[0].position, e[0].color = 0.05, (*SHADOW, 1)
    e[1].position, e[1].color = 0.12, (1, 1, 1, 1)
    mul = N("ShaderNodeMix"); mul.data_type = "RGBA"; mul.blend_type = "MULTIPLY"; mul.inputs["Factor"].default_value = 1
    lw = N("ShaderNodeLayerWeight"); lw.inputs["Blend"].default_value = 0.35
    rim = N("ShaderNodeMapRange"); rim.inputs["From Min"].default_value = 0.55; rim.inputs["From Max"].default_value = 0.62
    add = N("ShaderNodeMix"); add.data_type = "RGBA"; add.blend_type = "ADD"
    _rgba(add, "B").default_value = (0.35, 0.85, 1.0, 1)
    emit = N("ShaderNodeEmission")
    L = nt.links.new
    L(diff.outputs[0], s2r.inputs[0]); L(s2r.outputs["Color"], ramp.inputs["Fac"])
    if tex:
        t = N("ShaderNodeTexImage"); t.image = tex.image
        L(t.outputs["Color"], _rgba(mul, "A"))
    L(ramp.outputs["Color"], _rgba(mul, "B"))
    L(lw.outputs["Facing"], rim.inputs["Value"])
    L(rim.outputs["Result"], add.inputs["Factor"])
    L(_rgba(mul, "Result", True), _rgba(add, "A"))
    L(_rgba(add, "Result", True), emit.inputs["Color"])
    L(emit.outputs[0], out.inputs["Surface"])
    return m


def preview(ob):
    """Toon look-dev on `ob`: cel material plus an inverted-hull outline (Solidify, flipped, backface)."""
    src = ob.material_slots[0].material
    ob.material_slots[0].material = _toon_material(src)
    line = bpy.data.materials.new("Mori_Outline")
    line.use_backface_culling = True
    nt = line.node_tree; nt.nodes.clear()
    em = nt.nodes.new("ShaderNodeEmission"); em.inputs["Color"].default_value = (*OUTLINE, 1)
    nt.links.new(em.outputs[0], nt.nodes.new("ShaderNodeOutputMaterial").inputs["Surface"])
    ob.data.materials.append(line)
    sol = ob.modifiers.new("Outline", "SOLIDIFY")
    sol.thickness, sol.offset = 0.004, 1
    sol.use_flip_normals, sol.use_rim = True, False
    sol.material_offset = len(ob.data.materials) - 1
    return ob
