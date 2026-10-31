"""Prepare the painted bird-form Mori (mori-bird.glb) for rigging.

Source:  art/blend/mori-bird_decoded.glb  (mori-bird.glb run through tools/decode_glb.mjs: the original is
         meshopt-compressed, which Blender's importer can't read. 2M tris, upright chibi bird, wings
         spread, faces -Y, cyan-tipped wing and tail feathers)
Output:  art/mesh2motion/bird_unrigged.glb  (40k tris, 2K base colour + painted-glow emissive map, feet on
         the origin, BIRD_HEIGHT tall), rigged by rig_mori_mesh2motion.py --form bird

Run:  node tools/decode_glb.mjs mori-bird.glb art/blend/mori-bird_decoded.glb
      blender -b --factory-startup --python tools/blender/prepare_bird.py

Space: the source is first normalised (bounding box centred, largest side 1), then FEET (normalised
coords) moves to the origin and everything scales by BIRD_HEIGHT / height. rig_mori_mesh2motion.py
reads its bird landmarks in the same normalised coords and converts them with to_game().
Same cleanup as prepare_fox.py: weld, drop duplicate shells, decimate, shrink textures, glow mask.
"""
import bpy, bmesh, os, sys
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.append(os.path.join(ROOT, ".claude", "skills", "blender-asset-qa", "scripts"))
import qa_check  # noqa: E402

SRC = os.path.join(ROOT, "art", "blend", "mori-bird_decoded.glb")
OUT = os.path.join(ROOT, "art", "mesh2motion", "bird_unrigged.glb")
TRIS = 40000
NORM_HEIGHT = 0.74          # normalised height of the source (wingspan is 1)
FEET = (0.0, -0.05, -0.335)  # normalised point between the feet, on the ground
BIRD_HEIGHT = 0.55          # metres, tuft tip to tail tip; wingspan ~0.74 m


def to_game(p):
    """Normalised source coords -> game-ready coords (shared with rig_mori_mesh2motion.py)."""
    s = BIRD_HEIGHT / NORM_HEIGHT
    return tuple((p[i] - FEET[i]) * s for i in range(3))


if __name__ == "__main__":
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    bpy.ops.import_scene.gltf(filepath=SRC)
    ob = next(o for o in bpy.data.objects if o.type == "MESH")
    ob.data.transform(ob.matrix_world)
    ob.parent = None
    ob.matrix_world = Matrix.Identity(4)
    for o in [o for o in bpy.data.objects if o is not ob]:
        bpy.data.objects.remove(o)
    ob.name = ob.data.name = "Bird"
    me = ob.data

    P = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", P)
    P = P.reshape(-1, 3)
    lo, hi = P.min(0), P.max(0)
    me.transform(Matrix.Scale(1 / (hi - lo).max(), 4) @ Matrix.Translation(Vector(-(lo + hi) / 2)))
    s = BIRD_HEIGHT / NORM_HEIGHT
    me.transform(Matrix.Scale(s, 4) @ Matrix.Translation(-Vector(FEET)))

    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    seen, dupes = set(), []
    for f in bm.faces:
        key = frozenset(v.index for v in f.verts)
        if key in seen:
            dupes.append(f)
        seen.add(key)
    bmesh.ops.delete(bm, geom=dupes, context="FACES")
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    print("@@CLEAN duplicate faces removed", len(dupes))
    bm.to_mesh(me)
    bm.free()
    dec = ob.modifiers.new("Decimate", "DECIMATE")
    dec.ratio = TRIS / max(1, sum(len(p.vertices) - 2 for p in me.polygons))
    with bpy.context.temp_override(object=ob, active_object=ob, selected_objects=[ob], selected_editable_objects=[ob]):
        assert bpy.ops.object.modifier_apply(modifier=dec.name) == {"FINISHED"}
    for p in me.polygons:
        p.use_smooth = True

    # ---- textures: 2K base colour, 1K the rest, emissive = base colour where it is painted cyan
    mat = me.materials[0]
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    texs = [n for n in nt.nodes if n.type == "TEX_IMAGE"]
    bc_node = next(n for n in texs if n.image.colorspace_settings.name == "sRGB")
    bc = bc_node.image
    bc.scale(2048, 2048)
    for n in texs:
        if n is not bc_node:
            n.image.scale(1024, 1024)
    px = np.empty(2048 * 2048 * 4, dtype=np.float32)
    bc.pixels.foreach_get(px)
    px = px.reshape(-1, 4)
    r, g, b = px[:, 0], px[:, 1], px[:, 2]
    cyan = np.clip(((g + b) * 0.5 - r - 0.06) * 4.0, 0, 1) * np.clip((np.maximum(g, b) - 0.18) * 3.0, 0, 1)
    em = np.zeros_like(px)
    em[:, :3] = px[:, :3] * cyan[:, None]
    em[:, 3] = 1
    emi = bpy.data.images.new("Bird_Emissive", 2048, 2048)
    emi.pixels.foreach_set(em.ravel())
    emi.pack()
    en = nt.nodes.new("ShaderNodeTexImage")
    en.image = emi
    nt.links.new(en.outputs["Color"], bsdf.inputs["Emission Color"])
    bsdf.inputs["Emission Strength"].default_value = 1.0
    mat.name = "M_Bird"
    print("@@GLOW coverage", round(float((cyan > 0.3).mean()), 3))

    qa = qa_check.run(objects=["Bird"], profile="game")
    print("@@QA", qa.get("pass"), (qa.get("errors") or [])[:3], "tris", sum(len(p.vertices) - 2 for p in me.polygons),
          "dims", tuple(round(d, 3) for d in ob.dimensions))
    bpy.ops.export_scene.gltf(filepath=OUT, use_selection=False, export_format="GLB", export_image_format="JPEG",
                              export_animations=False, export_yup=True)
    print("@@EXPORT", OUT, os.path.getsize(OUT) // 1024, "KB")
