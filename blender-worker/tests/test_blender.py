"""Tests of the Blender scripts (prepare.py and shape.py), run inside Blender:

    blender -b --factory-startup --python-exit-code 1 -P blender-worker/tests/test_blender.py

Each test builds its inputs with bpy in a temporary folder, runs a script the way the wrapper does (a fresh headless Blender through
subprocess), and reads the GLB it wrote straight from its JSON chunk: triangle counts, bounds, materials, images.
"""
import json
import math
import os
import struct
import subprocess
import sys
import tempfile
import unittest

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.join(HERE, "..", "scripts")

EXPECTED_TRIANGLES = {"cube": 12, "sphere": 80, "cone": 14, "cylinder": 28, "pyramid": 6, "coin": 44, "ring": 144}


# ---- running a script, and reading what it wrote ----


def run_script(name, *args):
    command = [
        bpy.app.binary_path, "-b", "--factory-startup", "--disable-autoexec", "-noaudio", "--python-exit-code", "1",
        "-P", os.path.join(SCRIPTS, name), "--", *args,
    ]
    return subprocess.run(command, capture_output=True, text=True, timeout=180)


def read_glb(path):
    """The GLB's JSON part, after checking its header."""
    with open(path, "rb") as handle:
        data = handle.read()
    magic, version, length = struct.unpack_from("<4sII", data, 0)
    assert magic == b"glTF" and version == 2 and length == len(data), "not a valid GLB header"
    json_length, json_type = struct.unpack_from("<I4s", data, 12)
    assert json_type == b"JSON"
    return json.loads(data[20 : 20 + json_length])


def triangles(gltf):
    total = 0
    for mesh in gltf["meshes"]:
        for primitive in mesh["primitives"]:
            assert primitive.get("mode", 4) == 4, "not triangles"
            total += gltf["accessors"][primitive["indices"]]["count"] // 3
    return total


def extents(gltf):
    """(x, y, z) size of everything, from the POSITION accessors' min and max (glTF is Y up)."""
    low, high = [math.inf] * 3, [-math.inf] * 3
    for mesh in gltf["meshes"]:
        for primitive in mesh["primitives"]:
            accessor = gltf["accessors"][primitive["attributes"]["POSITION"]]
            for i in range(3):
                low[i] = min(low[i], accessor["min"][i])
                high[i] = max(high[i], accessor["max"][i])
    return tuple(high[i] - low[i] for i in range(3))


def base_colors(gltf):
    return [material["pbrMetallicRoughness"]["baseColorFactor"][:3] for material in gltf.get("materials", [])]


def linear_to_srgb(value):
    return value * 12.92 if value <= 0.0031308 else 1.055 * value ** (1 / 2.4) - 0.055


def hex_of(linear_rgb):
    return "#" + "".join(f"{round(linear_to_srgb(c) * 255):02x}" for c in linear_rgb)


# ---- building inputs ----


def fresh():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def make_material(name, linear_rgb, texture=False):
    material = bpy.data.materials.new(name)
    if material.node_tree is None:
        material.use_nodes = True
    bsdf = next(node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*linear_rgb, 1.0)
    if texture:
        image = bpy.data.images.new("tex", 4, 4)
        image.pixels = [0.3] * 64
        image.pack()
        node = material.node_tree.nodes.new("ShaderNodeTexImage")
        node.image = image
        material.node_tree.links.new(node.outputs["Color"], bsdf.inputs["Base Color"])
    return material


def add_cube(location=(0, 0, 0), scale=(1, 1, 1), material=None):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=location)
    obj = bpy.context.active_object
    obj.scale = scale
    with bpy.context.temp_override(active_object=obj, object=obj, selected_objects=[obj], selected_editable_objects=[obj]):
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if material is not None:
        obj.data.materials.append(material)
    return obj


def export(path, kind):
    if kind == "obj":
        bpy.ops.wm.obj_export(filepath=path)
    elif kind == "fbx":
        bpy.ops.export_scene.fbx(filepath=path)
    else:
        bpy.ops.export_scene.gltf(filepath=path, export_format="GLB")


class BlenderScripts(unittest.TestCase):
    def setUp(self):
        self._folder = tempfile.TemporaryDirectory()
        self.dir = self._folder.name
        self.out = os.path.join(self.dir, "out.glb")
        self.stats = os.path.join(self.dir, "stats.json")

    def tearDown(self):
        self._folder.cleanup()

    def path(self, name):
        return os.path.join(self.dir, name)

    def prepare(self, source, fmt, triangles_budget=2000, color="original"):
        return run_script(
            "prepare.py", "--in", source, "--format", fmt, "--triangles", str(triangles_budget), "--color", color,
            "--out", self.out, "--stats", self.stats,
        )

    def stats_json(self):
        with open(self.stats, encoding="utf-8") as handle:
            return json.load(handle)

    def assertOk(self, result):
        self.assertEqual(result.returncode, 0, msg=f"stdout:\n{result.stdout[-1500:]}\nstderr:\n{result.stderr[-1500:]}")

    # ---- Prepare Model ----

    def test_a_cube_obj_keeps_its_twelve_triangles_and_its_size_and_gets_one_flat_material(self):
        fresh()
        add_cube()
        source = self.path("cube.obj")
        export(source, "obj")

        self.assertOk(self.prepare(source, "obj"))

        gltf = read_glb(self.out)
        self.assertEqual(self.stats_json(), {"before": 12, "after": 12})
        self.assertEqual(triangles(gltf), 12)
        for size in extents(gltf):
            self.assertAlmostEqual(size, 1.0, places=3)
        self.assertEqual(len(base_colors(gltf)), 1)

    def test_a_dense_obj_is_cut_down_to_the_budget_and_no_further_than_it_needs(self):
        fresh()
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=5, radius=0.5)
        source = self.path("dense.obj")
        export(source, "obj")

        self.assertOk(self.prepare(source, "obj", triangles_budget=200))

        gltf = read_glb(self.out)
        stats = self.stats_json()
        self.assertEqual(stats["before"], 5120)
        self.assertLessEqual(stats["after"], 200)
        self.assertGreaterEqual(stats["after"], 20)
        self.assertEqual(triangles(gltf), stats["after"])

    def test_a_z_up_fbx_comes_out_y_up(self):
        fresh()
        add_cube(scale=(1, 1, 4))  # 4 tall along Blender's Z
        source = self.path("tall.fbx")
        export(source, "fbx")

        self.assertOk(self.prepare(source, "fbx"))

        x, y, z = extents(read_glb(self.out))
        self.assertAlmostEqual(y, 4.0, delta=0.01)
        self.assertAlmostEqual(x, 1.0, delta=0.01)
        self.assertAlmostEqual(z, 1.0, delta=0.01)

    def test_a_glb_in_gives_a_glb_out_with_its_material_color_kept(self):
        fresh()
        add_cube(material=make_material("red", (0.8, 0.0, 0.0)))
        source = self.path("red.glb")
        export(source, "glb")

        self.assertOk(self.prepare(source, "glb"))

        gltf = read_glb(self.out)
        self.assertEqual(triangles(gltf), 12)
        colors = base_colors(gltf)
        self.assertEqual(len(colors), 1)
        for got, want in zip(colors[0], (0.8, 0.0, 0.0)):
            self.assertAlmostEqual(got, want, delta=0.01)

    def _two_colored_cubes(self, kind):
        fresh()
        add_cube(location=(0, 0, 0), material=make_material("red", (0.8, 0.0, 0.0)))
        add_cube(location=(3, 0, 0), material=make_material("blue", (0.0, 0.0, 0.8)))
        source = self.path(f"two.{kind}")
        export(source, kind)
        return source

    def test_one_palette_color_paints_the_whole_model(self):
        source = self._two_colored_cubes("glb")

        self.assertOk(self.prepare(source, "glb", color="#06d6a0"))

        colors = base_colors(read_glb(self.out))
        self.assertEqual(len(colors), 1)
        self.assertEqual(hex_of(colors[0]), "#06d6a0")

    def test_the_models_own_colors_keep_one_material_each(self):
        source = self._two_colored_cubes("glb")

        self.assertOk(self.prepare(source, "glb", color="original"))

        gltf = read_glb(self.out)
        self.assertEqual(triangles(gltf), 24)
        self.assertEqual(sorted(hex_of(c) for c in base_colors(gltf)), sorted([hex_of((0.8, 0.0, 0.0)), hex_of((0.0, 0.0, 0.8))]))

    def test_textures_are_dropped(self):
        fresh()
        add_cube(material=make_material("textured", (0.5, 0.5, 0.5), texture=True))
        source = self.path("textured.glb")
        export(source, "glb")
        self.assertIn("images", read_glb(source), "the input should have a texture for this test to mean anything")

        self.assertOk(self.prepare(source, "glb"))

        gltf = read_glb(self.out)
        for key in ("images", "textures", "samplers"):
            self.assertNotIn(key, gltf)

    def test_a_scene_with_no_mesh_exits_3(self):
        source = self.path("empty.obj")
        with open(source, "w", encoding="utf-8") as handle:
            handle.write("# nothing here\n")

        result = self.prepare(source, "obj")

        self.assertEqual(result.returncode, 3)
        self.assertFalse(os.path.exists(self.out))

    def test_a_file_that_cannot_be_read_exits_4(self):
        fbx = self.path("broken.fbx")
        with open(fbx, "wb") as handle:
            handle.write(b"Kaydara FBX Binary  \x00\x1a\x00" + struct.pack("<I", 7400) + b"\xff" * 64)
        glb = self.path("broken.glb")
        with open(glb, "wb") as handle:
            handle.write(b"glTF" + b"\xff" * 64)

        self.assertEqual(self.prepare(fbx, "fbx").returncode, 4)
        self.assertEqual(self.prepare(glb, "glb").returncode, 4)

    def test_a_bad_color_or_a_missing_argument_is_a_plain_failure_not_exit_3_or_4(self):
        fresh()
        add_cube()
        source = self.path("cube.obj")
        export(source, "obj")
        self.assertNotIn(self.prepare(source, "obj", color="red").returncode, (0, 3, 4))
        self.assertNotIn(run_script("prepare.py", "--out", self.out).returncode, (0, 3, 4))

    # ---- Make Shape ----

    def make_shape(self, shape, color="#06d6a0"):
        return run_script("shape.py", "--shape", shape, "--color", color, "--out", self.out, "--stats", self.stats)

    def test_each_shape_is_a_valid_one_color_glb_of_the_expected_size(self):
        for shape, expected in EXPECTED_TRIANGLES.items():
            with self.subTest(shape=shape):
                self.assertOk(self.make_shape(shape))
                gltf = read_glb(self.out)
                self.assertEqual(self.stats_json(), {"after": expected})
                self.assertEqual(triangles(gltf), expected)
                self.assertEqual(len(gltf["meshes"]), 1)
                colors = base_colors(gltf)
                self.assertEqual(len(colors), 1)
                self.assertEqual(hex_of(colors[0]), "#06d6a0")
                x, y, z = extents(gltf)
                self.assertAlmostEqual(y, 1.0, delta=0.01)  # one unit tall (the coin and the ring: their diameter)
                if shape == "coin":
                    self.assertAlmostEqual(z, 0.15, delta=0.01)
                    self.assertAlmostEqual(x, 1.0, delta=0.01)
                if shape == "ring":
                    self.assertAlmostEqual(z, 0.26, delta=0.01)  # 2 * 0.15 * sin(60 degrees): the tube has six sides
                    self.assertAlmostEqual(x, 1.0, delta=0.01)

    def test_a_shape_glb_reads_back_into_blender_as_one_mesh(self):
        for shape in ("cube", "ring"):
            with self.subTest(shape=shape):
                self.assertOk(self.make_shape(shape))
                fresh()
                self.assertIn("FINISHED", bpy.ops.import_scene.gltf(filepath=self.out))
                self.assertEqual(len([o for o in bpy.data.objects if o.type == "MESH"]), 1)

    def test_a_shape_takes_any_color_and_refuses_a_bad_one(self):
        self.assertOk(self.make_shape("cube", "#FF6F59"))
        self.assertEqual(hex_of(base_colors(read_glb(self.out))[0]), "#ff6f59")
        self.assertNotIn(self.make_shape("cube", "orange").returncode, (0, 3, 4))
        self.assertNotEqual(self.make_shape("torus").returncode, 0)


if __name__ == "__main__":
    # Test names can follow a "--" (blender ... -P test_blender.py -- BlenderScripts.test_one_palette_color_paints_the_whole_model).
    names = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    outcome = unittest.main(argv=["blender-worker tests", *names], exit=False, verbosity=2)
    sys.exit(0 if outcome.result.wasSuccessful() else 1)
