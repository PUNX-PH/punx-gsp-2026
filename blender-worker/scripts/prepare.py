"""Prepare Model: a GLB, FBX or OBJ becomes one small GLB in flat colors.

    blender -b --factory-startup --disable-autoexec -noaudio --python-exit-code 1 -P prepare.py -- \
        --in model.fbx --format fbx --triangles 2000 --color original|#rrggbb --out out.glb --stats stats.json

Steps: an empty scene; import by format (Blender converts the file's axes, so the export below can be Y up); keep the meshes and join
them into one object (cameras, lights, rigs and animations are dropped); triangulate; decimate to at most the budget; flatten the
materials; export a GLB. Exit 3 when the file holds no 3D shape, 4 when it could not be read.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
import common  # noqa: E402

MAX_DECIMATE_ROUNDS = 8


def configure(parser):
    parser.add_argument("--in", dest="input", required=True)
    parser.add_argument("--format", choices=["glb", "fbx", "obj"], required=True)
    parser.add_argument("--triangles", type=int, required=True)
    parser.add_argument("--color", required=True)


def import_model(path, fmt):
    """Imports the file, or exits 4. The importers' own defaults convert FBX and OBJ (Y up, or whatever the file says) to Blender's Z up."""
    try:
        if fmt == "glb":
            result = bpy.ops.import_scene.gltf(filepath=path)
        elif fmt == "fbx":
            result = bpy.ops.import_scene.fbx(filepath=path)
        else:
            result = bpy.ops.wm.obj_import(filepath=path)
    except Exception:
        sys.exit(common.EXIT_BAD_FORMAT)
    if "FINISHED" not in result:
        sys.exit(common.EXIT_BAD_FORMAT)


def join_meshes():
    """Everything that is not a mesh is deleted, every mesh is freed from its parents and modifiers, and the meshes are joined into
    one object with its transforms applied. Exits 3 when no mesh with faces is left."""
    for obj in list(bpy.data.objects):
        if obj.type != "MESH":
            bpy.data.objects.remove(obj, do_unlink=True)
    meshes = [obj for obj in bpy.data.objects if obj.type == "MESH" and len(obj.data.polygons) > 0]
    for obj in list(bpy.data.objects):
        if obj not in meshes:
            bpy.data.objects.remove(obj, do_unlink=True)
    if not meshes:
        sys.exit(common.EXIT_EMPTY)

    for obj in meshes:
        world = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = world
        for modifier in list(obj.modifiers):
            obj.modifiers.remove(modifier)
        if obj.data.shape_keys is not None:
            obj.shape_key_clear()

    active = meshes[0]
    if len(meshes) > 1:
        with bpy.context.temp_override(active_object=active, object=active, selected_objects=meshes, selected_editable_objects=meshes):
            bpy.ops.object.join()
    common.apply_transforms(active)
    return active


def decimate_to(obj, budget):
    """Collapse-decimates until the mesh has at most `budget` triangles. Exits with a plain failure if it cannot get there."""
    triangles = common.triangle_count(obj)
    if triangles <= budget:
        return
    ratio = budget / triangles
    for _ in range(MAX_DECIMATE_ROUNDS):
        modifier = obj.modifiers.new("decimate", "DECIMATE")
        modifier.decimate_type = "COLLAPSE"
        modifier.ratio = max(0.01, min(1.0, ratio))
        modifier.use_collapse_triangulate = True
        with bpy.context.temp_override(active_object=obj, object=obj, selected_objects=[obj], selected_editable_objects=[obj]):
            bpy.ops.object.modifier_apply(modifier=modifier.name)
        triangles = common.triangle_count(obj)
        if triangles <= budget:
            return
        ratio = (budget / triangles) * 0.95  # the next round works on what is left
    raise RuntimeError("could not reach the triangle budget")


def main():
    args = common.parse_args(configure)
    common.reset_scene()
    import_model(args.input, args.format)

    obj = join_meshes()
    before = common.triangle_count(obj)
    common.triangulate(obj)
    decimate_to(obj, args.triangles)

    if args.color != "original" and not common.HEX.match(args.color):
        raise ValueError("bad color")
    common.flatten_materials(obj, None if args.color == "original" else args.color.lower())

    common.export_glb(args.out)
    common.write_stats(args.stats, common.triangle_count(obj), before)


main()
