"""Helpers shared by prepare.py and shape.py. Run inside Blender (headless): `blender -b ... -P script.py -- <arguments>`.

Exit codes the wrapper (server.mjs) understands: 0 done, 3 no 3D shape in the file, 4 the file could not be read, anything else
(including an uncaught exception, because the wrapper passes --python-exit-code 1) a plain failure.
"""
import argparse
import json
import math
import re
import sys

import bmesh
import bpy

EXIT_EMPTY = 3
EXIT_BAD_FORMAT = 4

HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


def parse_args(configure):
    """The arguments after `--`. `configure(parser)` adds the ones a script takes."""
    rest = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--stats", required=True)
    configure(parser)
    return parser.parse_args(rest)


def reset_scene():
    """An empty factory scene: nothing of Blender's default startup file is left to end up in the export."""
    bpy.ops.wm.read_factory_settings(use_empty=True)


def srgb_to_linear(value):
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def hex_to_linear(color):
    """'#rrggbb' to Blender's linear (r, g, b)."""
    return tuple(srgb_to_linear(int(color[i : i + 2], 16) / 255) for i in (1, 3, 5))


def triangle_count(obj):
    """How many triangles the mesh makes once every face is triangulated (an n-gon counts as n - 2)."""
    return sum(len(polygon.vertices) - 2 for polygon in obj.data.polygons)


def triangulate(obj):
    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()


def apply_transforms(obj):
    with bpy.context.temp_override(active_object=obj, object=obj, selected_objects=[obj], selected_editable_objects=[obj]):
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def flat_material(name, linear_rgb):
    """A material that is one flat color: no textures, not shiny."""
    material = bpy.data.materials.new(name)
    if material.node_tree is None:
        material.use_nodes = True  # older Blender: nodes are off until asked for (newer ones always have them, and warn if asked)
    bsdf = next((node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED"), None)
    bsdf.inputs["Base Color"].default_value = (*linear_rgb, 1.0)
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = 1.0
    return material


def base_color(material):
    """A material's base color (linear r, g, b): the Principled BSDF's, else the viewport color, else light grey."""
    if material is None:
        return (0.8, 0.8, 0.8)
    if material.node_tree:
        bsdf = next((node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED"), None)
        if bsdf is not None:
            value = bsdf.inputs["Base Color"].default_value
            return (value[0], value[1], value[2])
    return tuple(material.diffuse_color[:3])


def flatten_materials(obj, color):
    """Every material becomes a flat color, textures dropped. With `color` ('#rrggbb') the whole model is that one color; with
    None each material keeps its own base color."""
    mesh = obj.data
    if color is not None:
        mesh.materials.clear()
        mesh.materials.append(flat_material("flat", hex_to_linear(color)))
        for polygon in mesh.polygons:
            polygon.material_index = 0
        return
    if len(mesh.materials) == 0:
        mesh.materials.append(flat_material("flat", base_color(None)))
        return
    for index, material in enumerate(list(mesh.materials)):
        mesh.materials[index] = flat_material(f"flat{index}", base_color(material))


def export_glb(path):
    """The scene as a GLB: Y up, modifiers applied, and nothing a game of this kind has no use for (no cameras, lights, animation,
    skins, morph targets, extras, texture coordinates, images or vertex colors)."""
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        use_selection=False,
        export_materials="EXPORT",
        export_image_format="NONE",
        export_vertex_color="NONE",
        export_texcoords=False,
        export_normals=True,
        export_attributes=False,
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_skins=False,
        export_morph=False,
        export_extras=False,
    )


def write_stats(path, after, before=None):
    stats = {"after": after}
    if before is not None:
        stats["before"] = before
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(stats, handle)


def single_mesh():
    """The one mesh object in the scene (a script's own shape)."""
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    return meshes[0]


__all__ = [name for name in dir() if not name.startswith("_")] + ["math"]
