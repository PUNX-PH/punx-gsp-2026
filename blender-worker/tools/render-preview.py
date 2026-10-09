"""blender -b --factory-startup -P blender-worker/tools/render-preview.py -- <in.glb> <out.png> [size] [azimuth]

Loads a GLB and renders it from a three-quarter view on a plain floor, lit by one sun and a soft fill, with Cycles on the CPU (so it needs no GPU and runs
headless). It is for LOOKING at what the builder makes (the art gate, slice 9): the same lighting for every model, so two models are comparable. It
never reaches the worker or a game.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1 :]
src, dst = args[0], args[1]
size = int(args[2]) if len(args) > 2 else 900
azimuth = float(args[3]) if len(args) > 3 else 35.0

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

# the model's box, in world space, over every mesh
low = Vector((1e9, 1e9, 1e9))
high = Vector((-1e9, -1e9, -1e9))
for obj in bpy.context.scene.objects:
    if obj.type != "MESH":
        continue
    for corner in obj.bound_box:
        point = obj.matrix_world @ Vector(corner)
        low = Vector((min(low[i], point[i]) for i in range(3)))
        high = Vector((max(high[i], point[i]) for i in range(3)))
center = (low + high) / 2
extent = max((high - low).length, 0.5)

# the floor, just under the model
bpy.ops.mesh.primitive_plane_add(size=extent * 14, location=(center.x, center.y, low.z - 0.001))
floor = bpy.context.active_object
floor_material = bpy.data.materials.new("floor")
floor_material.use_nodes = True
floor_material.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.42, 0.44, 0.5, 1)
floor_material.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.9
floor.data.materials.append(floor_material)

# the camera: three-quarter, a little above, looking at the middle of the model
camera_data = bpy.data.cameras.new("camera")
camera_data.lens = 55
camera = bpy.data.objects.new("camera", camera_data)
bpy.context.collection.objects.link(camera)
distance = extent * 1.9
elevation = math.radians(20)
theta = math.radians(azimuth)
camera.location = center + Vector((math.sin(theta) * math.cos(elevation), -math.cos(theta) * math.cos(elevation), math.sin(elevation))) * distance
direction = center - camera.location
camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
bpy.context.scene.camera = camera

# one sun with soft shadows and a dim sky
sun_data = bpy.data.lights.new("sun", "SUN")
sun_data.energy = 4.0
sun_data.angle = math.radians(6)
sun = bpy.data.objects.new("sun", sun_data)
sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(-35))
bpy.context.collection.objects.link(sun)

world = bpy.data.worlds.new("world")
world.use_nodes = True
background = world.node_tree.nodes["Background"]
background.inputs["Color"].default_value = (0.62, 0.68, 0.8, 1)
background.inputs["Strength"].default_value = 0.9
bpy.context.scene.world = world

scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 48
scene.cycles.use_denoising = True
scene.render.resolution_x = size
scene.render.resolution_y = size
scene.render.resolution_percentage = 100
scene.view_settings.view_transform = "Standard"
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = os.path.abspath(dst)
bpy.ops.render.render(write_still=True)
print("rendered", dst)
