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
    # glTF leaves baseColorFactor out when it is the default, opaque white
    return [material["pbrMetallicRoughness"].get("baseColorFactor", [1, 1, 1, 1])[:3] for material in gltf.get("materials", [])]


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


# ---- build.py: models with a skeleton and named clips, from a recipe ----

RECIPES = os.path.join(HERE, "..", "fixtures", "recipes")
EXIT_BAD_RECIPE = 5


def recipe_fixture(name):
    with open(os.path.join(RECIPES, name), encoding="utf-8") as handle:
        return json.load(handle)


def read_glb_with_binary(path):
    """(the GLB's JSON, its binary part): accessor data lives in the binary part."""
    with open(path, "rb") as handle:
        data = handle.read()
    json_length, _ = struct.unpack_from("<I4s", data, 12)
    gltf = json.loads(data[20 : 20 + json_length])
    offset = 20 + json_length
    binary = b""
    if offset < len(data):
        bin_length, bin_type = struct.unpack_from("<I4s", data, offset)
        assert bin_type == b"BIN\x00"
        binary = data[offset + 8 : offset + 8 + bin_length]
    return gltf, binary


def accessor_values(gltf, binary, index):
    """The accessor's elements as tuples of floats (float32 only: animation times and rotations)."""
    accessor = gltf["accessors"][index]
    assert accessor["componentType"] == 5126
    width = {"SCALAR": 1, "VEC3": 3, "VEC4": 4}[accessor["type"]]
    view = gltf["bufferViews"][accessor["bufferView"]]
    start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    stride = view.get("byteStride", width * 4)
    return [struct.unpack_from("<" + "f" * width, binary, start + i * stride) for i in range(accessor["count"])]


def node_names(gltf):
    return [node.get("name") for node in gltf["nodes"]]


def parent_of(gltf):
    parents = {}
    for index, node in enumerate(gltf["nodes"]):
        for child in node.get("children", []):
            parents[child] = index
    return parents


def lowest_y(gltf):
    return min(gltf["accessors"][p["attributes"]["POSITION"]]["min"][1] for mesh in gltf["meshes"] for p in mesh["primitives"])


def animation_named(gltf, name):
    return next(a for a in gltf["animations"] if a["name"] == name)


def channels_of(gltf, animation, path):
    """{node name: (times, values)} for the channels of one kind (translation, rotation, scale) of an animation."""
    return {channel["target"]["node"]: channel for channel in animation["channels"] if channel["target"]["path"] == path}


class BuildScript(unittest.TestCase):
    def setUp(self):
        self._folder = tempfile.TemporaryDirectory()
        self.dir = self._folder.name
        self.out = os.path.join(self.dir, "out.glb")
        self.stats_path = os.path.join(self.dir, "stats.json")

    def tearDown(self):
        self._folder.cleanup()

    def build(self, body):
        """Writes the body as the wrapper does (a file of our own name) and runs build.py on it."""
        recipe_path = os.path.join(self.dir, "recipe.json")
        with open(recipe_path, "w", encoding="utf-8") as handle:
            json.dump(body, handle)
        return run_script("build.py", "--recipe", recipe_path, "--out", self.out, "--stats", self.stats_path)

    def built(self, name):
        body = recipe_fixture(name)
        result = self.build(body)
        self.assertEqual(result.returncode, 0, result.stderr[-1500:] + result.stdout[-500:])
        with open(self.stats_path, encoding="utf-8") as handle:
            self.stats = json.load(handle)
        gltf, binary = read_glb_with_binary(self.out)
        return body, gltf, binary

    def node_index(self, gltf, name):
        return node_names(gltf).index(name)

    def test_the_default_biped_has_its_joints_clips_and_counts(self):
        body, gltf, _ = self.built("biped-default.json")
        names = node_names(gltf)
        for joint, _parent in json.load(open(os.path.join(SCRIPTS, "kit.json")))["kinds"]["biped"]["joints"]:
            self.assertIn(joint, names)
        self.assertEqual(sorted(a["name"] for a in gltf["animations"]), ["Jump", "Run"])
        expected = recipe_fixture("expected.json")["biped-default.json"]
        self.assertEqual(self.stats, expected)
        self.assertEqual(triangles(gltf), self.stats["triangles"])

    def test_the_biped_stress_recipe_stays_within_the_caps(self):
        body, gltf, _ = self.built("biped-stress.json")
        self.assertLessEqual(self.stats["parts"], 24)
        self.assertLessEqual(self.stats["triangles"], 2000)
        self.assertEqual(self.stats, recipe_fixture("expected.json")["biped-stress.json"])
        for extra_joint in ("ear_l", "ear_r", "antenna"):
            self.assertIn(extra_joint, node_names(gltf))
        self.assertEqual(sorted(a["name"] for a in gltf["animations"]), ["Jump", "Loop", "Run"])

    def test_clip_lengths_follow_the_seconds(self):
        body, gltf, binary = self.built("biped-default.json")
        for key, name in (("run", "Run"), ("jump", "Jump")):
            wanted = round(body["motions"]["motions"][key]["seconds"] * 24) / 24
            longest = 0.0
            for sampler in animation_named(gltf, name)["samplers"]:
                longest = max(longest, max(v[0] for v in accessor_values(gltf, binary, sampler["input"])))
            self.assertAlmostEqual(longest, wanted, delta=0.001, msg=name)

    def test_only_joints_a_clip_moves_get_channels(self):
        body, gltf, _ = self.built("biped-default.json")
        for key, name in (("run", "Run"), ("jump", "Jump")):
            moved = {track["joint"] for track in body["motions"]["motions"][key]["tracks"]}
            targets = {gltf["nodes"][channel["target"]["node"]]["name"] for channel in animation_named(gltf, name)["channels"]}
            self.assertEqual(targets, moved, name)

    def test_one_mesh_per_joint(self):
        _, gltf, _ = self.built("biped-default.json")
        joints = {j for j, _p in json.load(open(os.path.join(SCRIPTS, "kit.json")))["kinds"]["biped"]["joints"]}
        parents = parent_of(gltf)
        seen = {}
        for index, node in enumerate(gltf["nodes"]):
            if "mesh" not in node:
                continue
            parent = gltf["nodes"][parents[index]]["name"]
            self.assertIn(parent, joints, f"{node.get('name')} hangs from {parent}")
            seen[parent] = seen.get(parent, 0) + 1
        self.assertTrue(all(count == 1 for count in seen.values()), seen)
        self.assertEqual(len(seen), 15)  # fifteen parts on fifteen different joints (the spine and the neck carry none)

    def test_the_model_is_y_up_and_stands_on_the_origin(self):
        _, gltf, _ = self.built("biped-default.json")
        x, y, z = extents(gltf)
        self.assertGreater(y, max(x, z))
        self.assertAlmostEqual(lowest_y(gltf), 0.0, delta=0.01)

    def test_flat_colors_come_from_the_palette(self):
        body, gltf, _ = self.built("biped-default.json")
        self.assertNotIn("images", gltf)
        self.assertNotIn("textures", gltf)
        used = {body["palette"][index].lower() for index in body["recipe"]["colors"].values()}
        for color in base_colors(gltf):
            self.assertIn(hex_of(color), used)

    def test_the_arm_swings_about_the_side_axis(self):
        _, gltf, binary = self.built("biped-default.json")
        animation = animation_named(gltf, "Run")
        channel = channels_of(gltf, animation, "rotation")[self.node_index(gltf, "upperarm_l")]
        sampler = animation["samplers"][channel["sampler"]]
        rotations = accessor_values(gltf, binary, sampler["output"])
        self.assertTrue(all(abs(q[1]) < 0.01 and abs(q[2]) < 0.01 for q in rotations), "the arm twists or swings sideways")
        self.assertGreaterEqual(max(abs(q[0]) for q in rotations), math.sin(math.radians(12.5)))

    def test_the_thighs_swing_in_opposition(self):
        _, gltf, binary = self.built("biped-default.json")
        animation = animation_named(gltf, "Run")
        signs = []
        for joint in ("thigh_l", "thigh_r"):
            channel = channels_of(gltf, animation, "rotation")[self.node_index(gltf, joint)]
            sampler = animation["samplers"][channel["sampler"]]
            times = [v[0] for v in accessor_values(gltf, binary, sampler["input"])]
            quarter = min(range(len(times)), key=lambda i: abs(times[i] - times[-1] / 4))
            signs.append(math.copysign(1, accessor_values(gltf, binary, sampler["output"])[quarter][0]))
        self.assertEqual(signs[0], -signs[1])

    def test_the_glb_reimports_with_its_animations(self):
        self.built("biped-default.json")
        fresh()
        result = bpy.ops.import_scene.gltf(filepath=self.out)
        self.assertIn("FINISHED", result)
        self.assertGreater(len(bpy.data.actions), 0)

    def test_a_clip_with_no_tracks_is_left_out(self):
        body = recipe_fixture("biped-default.json")
        body["motions"] = {"version": 1, "motions": {"loop": {"seconds": 1.0, "tracks": []}}}
        self.assertEqual(self.build(body).returncode, 0)
        with open(self.stats_path, encoding="utf-8") as handle:
            self.assertEqual(json.load(handle)["clips"], [])
        self.assertNotIn("animations", read_glb(self.out))

    def test_each_default_kind_builds_with_its_joints_clips_and_counts(self):
        joints = {
            "vehicle": ["body", "wheel_1", "wheel_2", "wheel_3", "wheel_4"],
            "blob": ["body", "eye_l", "eye_r"],
            "prop": ["root"],
        }
        for kind, wanted in joints.items():
            with self.subTest(kind=kind):
                _, gltf, _ = self.built(f"{kind}-default.json")
                names = node_names(gltf)
                for joint in wanted:
                    self.assertIn(joint, names)
                self.assertEqual(sorted(a["name"] for a in gltf.get("animations", [])), sorted(recipe_fixture("expected.json")[f"{kind}-default.json"]["clips"]))
                self.assertEqual(self.stats, recipe_fixture("expected.json")[f"{kind}-default.json"])
                self.assertEqual(triangles(gltf), self.stats["triangles"])

    def test_each_stress_recipe_stays_within_the_caps(self):
        for kind in ("vehicle", "blob", "prop"):
            with self.subTest(kind=kind):
                _, gltf, _ = self.built(f"{kind}-stress.json")
                self.assertLessEqual(self.stats["parts"], 24)
                self.assertLessEqual(self.stats["triangles"], 2000)
                self.assertEqual(self.stats, recipe_fixture("expected.json")[f"{kind}-stress.json"])
                self.assertEqual(sorted(a["name"] for a in gltf["animations"]), ["Jump", "Loop", "Run"])

    def test_the_vehicle_is_longest_forward(self):
        _, gltf, _ = self.built("vehicle-default.json")
        x, y, z = extents(gltf)
        self.assertGreater(z, x)
        self.assertGreater(z, y)
        self.assertAlmostEqual(lowest_y(gltf), 0.0, delta=0.01)  # the wheels are on the ground

    def test_the_wheels_spin_about_the_side_axis(self):
        _, gltf, binary = self.built("vehicle-default.json")
        animation = animation_named(gltf, "Loop")
        channel = channels_of(gltf, animation, "rotation")[self.node_index(gltf, "wheel_1")]
        rotations = accessor_values(gltf, binary, animation["samplers"][channel["sampler"]]["output"])
        self.assertTrue(all(abs(q[1]) < 0.01 and abs(q[2]) < 0.01 for q in rotations), "a wheel wobbles instead of spinning about the axle")
        self.assertGreater(max(abs(q[0]) for q in rotations), 0.9)  # it turns through a half turn and more
        mesh = gltf["meshes"][gltf["nodes"][self.node_index(gltf, "wheel_1_mesh")]["mesh"]]
        box = gltf["accessors"][mesh["primitives"][0]["attributes"]["POSITION"]]
        width, height, depth = (box["max"][i] - box["min"][i] for i in range(3))
        self.assertLess(width, height * 0.5, "the wheel is not a disc whose axle is the model's x")
        self.assertAlmostEqual(height, depth, delta=0.01)

    def test_every_prop_shape_builds(self):
        counts = json.load(open(os.path.join(SCRIPTS, "kit.json")))["kinds"]["prop"]["count"]["shapes"]
        self.assertEqual(len(counts), 9)
        for shape, wanted in counts.items():
            with self.subTest(shape=shape):
                body = recipe_fixture("prop-default.json")
                body["recipe"]["build"]["shape"] = shape
                result = self.build(body)
                self.assertEqual(result.returncode, 0, result.stderr[-1500:])
                with open(self.stats_path, encoding="utf-8") as handle:
                    stats = json.load(handle)
                self.assertEqual((stats["parts"], stats["triangles"]), (wanted["parts"], wanted["triangles"]))
                gltf = read_glb(self.out)
                self.assertEqual(triangles(gltf), wanted["triangles"])
                self.assertAlmostEqual(extents(gltf)[1], body["recipe"]["build"]["size"], delta=0.02)  # `size` tall

    def test_a_body_the_worker_would_refuse_exits_5(self):
        def mutated(change):
            body = recipe_fixture("biped-default.json")
            change(body)
            return body

        three_extras = mutated(lambda b: b["recipe"].update(extras=["tail", "ears", "hat"]))
        thirteen = mutated(lambda b: b["motions"]["motions"]["run"].update(tracks=[b["motions"]["motions"]["run"]["tracks"][0]] * 13))
        no_tail = mutated(lambda b: b["motions"]["motions"]["run"]["tracks"][0].update(joint="tail_1"))
        path_joint = mutated(lambda b: b["motions"]["motions"]["run"]["tracks"][0].update(joint="../hips"))
        for name, body in (("three extras", three_extras), ("13 tracks", thirteen), ("a joint that was not built", no_tail), ("a joint that is a path", path_joint)):
            self.assertEqual(self.build(body).returncode, EXIT_BAD_RECIPE, name)


if __name__ == "__main__":
    # Test names can follow a "--" (blender ... -P test_blender.py -- BlenderScripts.test_one_palette_color_paints_the_whole_model).
    names = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    outcome = unittest.main(argv=["blender-worker tests", *names], exit=False, verbosity=2)
    sys.exit(0 if outcome.result.wasSuccessful() else 1)
