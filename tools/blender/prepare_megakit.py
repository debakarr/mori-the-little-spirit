"""Pack the Quaternius Stylized Nature MegaKit (CC0) into one GLB for the forest.

Source:  art/megakit_src/unzipped/glTF  (the free Standard pack's glTF folder, from
         https://quaternius.itch.io/stylized-nature-megakit; License_Standard.txt alongside)
Output:  public/models/megakit.glb  (one node per model, named as in the kit, origin at its base)

Run:  blender -b --factory-startup --python tools/blender/prepare_megakit.py

- materials that the kit duplicates per file (Leaves.003 ...) are merged so models share textures
- bark normal maps are dropped (the game's world-space breakup does that job) and textures shrunk
- the twisted-tree leaves (also on Bush_Common) ship painted autumn red; the white mask goes in instead
- the kit's vertex colour is an ambient-occlusion ramp (black at grass roots, dark trunk bases);
  it is softened so the game's own lighting still reads on the lower half
The game swaps in its own materials by name (src/world/megakit.js): alpha-tested cards and wind.
"""
import bpy, os, re, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SRC = os.path.join(ROOT, "art", "megakit_src", "unzipped", "glTF")
OUT = os.path.join(ROOT, "public", "models", "megakit.glb")
sys.path.append(os.path.join(ROOT, ".claude", "skills", "blender-asset-qa", "scripts"))
import qa_check  # noqa: E402

MODELS = [
    "CommonTree_1", "CommonTree_2", "CommonTree_3", "CommonTree_4", "CommonTree_5",
    "Pine_1", "Pine_2", "Pine_3", "Pine_5", "TwistedTree_1", "TwistedTree_3",
    "Bush_Common", "Bush_Common_Flowers", "Fern_1", "Plant_1", "Plant_1_Big", "Plant_7_Big",
    "Flower_3_Group", "Flower_4_Group", "Clover_2", "Grass_Wispy_Tall", "Mushroom_Common",
    "Rock_Medium_1", "Rock_Medium_2", "Rock_Medium_3", "Pebble_Round_1", "Pebble_Round_2", "Pebble_Round_3",
]
TEX_SIZE = {"Bark": 512, "Leaves": 1024, "Leaf": 1024, "Rocks": 1024, "Grass": 512, "Mushrooms": 512, "PathRocks": 512}
TINTED = {"Leaves_TwistedTree": "Leaves_TwistedTree.png"}
AO_FLOOR = 0.45  # vertex colour c becomes AO_FLOOR + (1 - AO_FLOOR) * c

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o)

kept = []
for name in MODELS:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(SRC, name + ".gltf"))
    new = [o for o in bpy.data.objects if o not in before]
    ob = next(o for o in new if o.type == "MESH")
    mw = ob.matrix_world.copy()
    ob.parent = None
    ob.data.transform(mw)
    ob.matrix_world.identity()
    for o in new:
        if o is not ob:
            bpy.data.objects.remove(o)
    ob.name = ob.data.name = name
    kept.append(ob)

# ---- one material per kit material name, rebuilt as base colour (+ alpha) only
shared = {}
for ob in kept:
    for slot in ob.material_slots:
        src = slot.material
        base = re.sub(r"\.\d+$", "", src.name)
        if base not in shared:
            img = next(n.image for n in src.node_tree.nodes if n.type == "TEX_IMAGE" and n.label == "BASE COLOR")
            if base in TINTED:  # white leaf mask instead of the painted (red, autumn) variant; the game tints it
                img = bpy.data.images.load(os.path.join(SRC, TINTED[base]))
            prefix = re.match(r"[A-Za-z]+", img.name).group(0)
            size = TEX_SIZE.get(prefix, 1024)
            if max(img.size) > size:
                img.scale(size, size)
            m = bpy.data.materials.new("MK_" + base)
            nt = m.node_tree
            bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
            tex = nt.nodes.new("ShaderNodeTexImage")
            tex.image = img
            nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
            if not base.startswith(("Rocks", "PathRocks", "Grass", "Mushrooms")):
                nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
            bsdf.inputs["Roughness"].default_value = 1.0
            shared[base] = m
        slot.material = shared[base]

# ---- soften the AO vertex colour
for ob in kept:
    for a in ob.data.color_attributes:
        c = np.empty(len(a.data) * 4, np.float32)
        a.data.foreach_get("color", c)
        c = c.reshape(-1, 4)
        c[:, :3] = AO_FLOOR + (1 - AO_FLOOR) * c[:, :3]
        a.data.foreach_set("color", c.ravel())
    for p in ob.data.polygons:
        p.use_smooth = True

for m in list(bpy.data.materials):
    if not m.name.startswith("MK_"):
        bpy.data.materials.remove(m)
for img in list(bpy.data.images):
    if img.users == 0:
        bpy.data.images.remove(img)

qa = qa_check.run(objects=[o.name for o in kept], profile="game")
tris = {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in kept}
print("@@QA", qa.get("pass"), (qa.get("errors") or [])[:3])
print("@@TRIS", sum(tris.values()), tris)
print("@@MATS", sorted(shared), sorted((i.name, tuple(i.size)) for i in bpy.data.images))

bpy.ops.export_scene.gltf(filepath=OUT, use_selection=False, export_format="GLB", export_image_format="WEBP",  # the scene holds only the kit
                          export_animations=False, export_yup=True, export_vertex_color="ACTIVE")
print("@@EXPORT", OUT, os.path.getsize(OUT) // 1024, "KB")
