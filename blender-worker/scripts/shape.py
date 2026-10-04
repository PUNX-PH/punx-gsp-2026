"""Make Shape: one of seven simple low-poly shapes, in one flat color, as a GLB.

    blender -b --factory-startup --disable-autoexec -noaudio --python-exit-code 1 -P shape.py -- \
        --shape sphere --color #06d6a0 --out out.glb --stats stats.json

Every shape is one object with one flat material, centered on the origin and 1.0 units tall in the GLB (Y up). The coin and the ring
stand on edge, their flat sides facing the GLB's +Z (the way the runner looks at them); their Y extent is their diameter, 1.0.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
import common  # noqa: E402

SHAPES = ["cube", "sphere", "cone", "cylinder", "pyramid", "coin", "ring"]


def configure(parser):
    parser.add_argument("--shape", choices=SHAPES, required=True)
    parser.add_argument("--color", required=True)


def stand_on_edge(obj):
    """Turns a shape whose axis is Blender's Z so that its axis is Blender's Y (the GLB's Z), and bakes that in."""
    obj.rotation_euler = (math.pi / 2, 0.0, 0.0)
    common.apply_transforms(obj)


def build(shape):
    if shape == "cube":
        bpy.ops.mesh.primitive_cube_add(size=1.0)
    elif shape == "sphere":
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=0.5)  # 80 triangles
    elif shape == "cone":
        bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=0.5, radius2=0.0, depth=1.0)
    elif shape == "cylinder":
        bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=0.5, depth=1.0)
    elif shape == "pyramid":
        # a cone with four sides: its corners are on a circle of radius 0.5, so its base fits the same unit box as the other shapes
        bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=0.5, radius2=0.0, depth=1.0)
    elif shape == "coin":
        bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=0.5, depth=0.15)
        stand_on_edge(bpy.context.active_object)
    else:  # ring
        bpy.ops.mesh.primitive_torus_add(major_segments=12, minor_segments=6, major_radius=0.35, minor_radius=0.15)
        stand_on_edge(bpy.context.active_object)
    return bpy.context.active_object


def main():
    args = common.parse_args(configure)
    if not common.HEX.match(args.color):
        raise ValueError("bad color")
    common.reset_scene()

    obj = build(args.shape)
    common.triangulate(obj)
    common.flatten_materials(obj, args.color.lower())

    common.export_glb(args.out)
    common.write_stats(args.stats, common.triangle_count(obj))


main()
