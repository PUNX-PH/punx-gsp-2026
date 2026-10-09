"""The freeform kind: a model composed from a list of parts, so a fox, a ship or a lamp can each have its own silhouette. Run inside Blender.

A recipe is data, never code: every part names a shape from the closed list below and gives numbers; the numbers are checked (recipe.mjs on the worker, check_model here)
and clamped to the caps in the kit, and nothing in a recipe is used as a path, a property name or an expression.

    recipe = { "version": 2, "kind": "model", "summary": "...",
               "materials": [ { "color": slot 0-4, "finish": matte|painted|metal|rubber|glow }, ... ],
               "parts": [ { "shape": ..., "at": [x, y, z], "size": [x, y, z], "rot": [x, y, z] degrees, "material": index, "mirror": bool, ... } ] }

Shapes (all in a unit space about one unit across and centered on the origin, then scaled by `size`, turned by `rot` and moved to `at`):
  ellipsoid, capsule, cylinder (with `taper`: the top radius as a share of the bottom; 0 is a cone), box (with `bevel`), torus (with `thickness`), lump (a boulder or
  a cloud, with `seed`), tube (a pipe along `points` with `radius` and `taper`), revolve (a lathe: `profile` is [radius, height] pairs), loft (cross-sections along z:
  `sections` are { z, w, h, round, dx, dy }). `mirror` adds the same part on the other side of the model (x to -x).
Model axes: x side to side, y up, z forward; Blender's are X, Z up and -Y forward, so a model point (x, y, z) is the Blender point (x, -z, y), as in build.py.
"""
import json
import math
import os

import bmesh
import bpy
from mathutils import Euler, Vector

import common
import high

SIDES = {1: 12, 2: 20, 3: 32}  # `detail`: segments round a part
SMOOTH_ANGLE = math.radians(50.0)

with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "kit.json"), encoding="utf-8") as _kit_file:
    FREEFORM = json.load(_kit_file)["freeform"]
CAPS = {**FREEFORM["caps"], "extent": float(FREEFORM["caps"]["extent"])}  # extent: the largest |coordinate| a part may use
BUDGETS = FREEFORM["budgets"]  # role -> target -> triangles
RIGS = FREEFORM["rigs"]  # rig -> the joints a part may name
# A joint's pivot, and whether it comes as a left and a right one: a "top" pivot is the top of its parts (a hip or a shoulder), "bottom" the bottom (a neck), and
# "back" the end nearest the body of a tail that runs backwards. A sided joint is made twice (`leg_l`, `leg_r`): the part on the +x side goes to the left one.
JOINT_PIVOTS = {"head": ("bottom", False), "tail": ("back", False), "arm": ("top", True), "leg": ("top", True), "leg_front": ("top", True), "leg_back": ("top", True)}


# ---- shapes: each adds its faces to `bm` in the unit space and returns the bmesh geometry it made ----


def _ring_faces(bm, rings, cap_first, cap_last):
    """`rings` is a list of rings, each a list of Vectors (all the same length) or a single Vector (a pole). Joins neighbours with faces, and caps the ends that are
    rings when asked."""
    made = []
    for ring in rings:
        made.append(bm.verts.new(ring) if isinstance(ring, Vector) else [bm.verts.new(p) for p in ring])
    faces = []
    for a, b in zip(made, made[1:]):
        if not isinstance(a, list) and not isinstance(b, list):
            continue
        if not isinstance(a, list):
            n = len(b)
            faces += [bm.faces.new((a, b[(i + 1) % n], b[i])) for i in range(n)]
        elif not isinstance(b, list):
            n = len(a)
            faces += [bm.faces.new((a[i], a[(i + 1) % n], b)) for i in range(n)]
        else:
            n = len(a)
            faces += [bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i])) for i in range(n)]
    for end, wanted in ((made[0], cap_first), (made[-1], cap_last)):
        if wanted and isinstance(end, list):
            faces.append(bm.faces.new(end))
    verts = [v for item in made for v in (item if isinstance(item, list) else [item])]
    return verts, faces


def _finish(bm, verts, faces):
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    return verts


def revolve(bm, profile, sides):
    """A lathe: `profile` is [radius, height] pairs from one end to the other; a radius of 0 is a pole, and a ring at either end is capped."""
    rings = []
    for r, y in profile:
        if r < 1e-5:
            rings.append(Vector((0.0, y, 0.0)))
        else:
            rings.append([Vector((r * math.cos(2 * math.pi * k / sides), y, r * math.sin(2 * math.pi * k / sides))) for k in range(sides)])
    verts, faces = _ring_faces(bm, rings, True, True)
    return _finish(bm, verts, faces)


def ellipsoid(bm, sides):
    stacks = max(4, sides // 2)
    profile = [(0.5 * math.sin(math.pi * i / stacks), 0.5 * math.cos(math.pi * i / stacks)) for i in range(stacks + 1)]
    return revolve(bm, profile, sides)


def capsule(bm, sides):
    """A rounded bar one unit across and one unit long overall (the ends are half-spheres squashed or stretched by `size`, so they are never flat)."""
    stacks = max(3, sides // 4)
    top = [(0.5 * math.sin(math.pi / 2 * i / stacks), 0.25 + 0.25 * math.cos(math.pi / 2 * i / stacks)) for i in range(stacks + 1)]
    bottom = [(0.5 * math.cos(math.pi / 2 * i / stacks), -0.25 - 0.25 * math.sin(math.pi / 2 * i / stacks)) for i in range(stacks + 1)]
    return revolve(bm, top + bottom, sides)


def cylinder(bm, sides, taper):
    """One unit wide at the bottom, one unit tall. `taper` is the top's radius as a share of the bottom's: 1 is a cylinder, 0 a cone."""
    top = max(0.0, min(1.0, taper)) * 0.5
    return revolve(bm, [(0.0, -0.5), (0.5, -0.5), (top, 0.5), (0.0, 0.5)], sides)


def box(bm, size, bevel):
    made = bmesh.ops.create_cube(bm, size=1.0)
    verts = list(made["verts"])
    for v in verts:
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    if bevel > 0:
        edges = list({e for v in verts for e in v.link_edges})
        width = bevel * min(size)
        result = bmesh.ops.bevel(bm, geom=verts + edges, offset=width, segments=2, profile=0.6, affect="EDGES")
        verts = list(dict.fromkeys([v for v in verts if v.is_valid] + list(result.get("verts", []))))
    for v in verts:  # back to the unit space, so every shape is scaled the same way afterwards
        v.co = Vector((v.co.x / size[0], v.co.y / size[1], v.co.z / size[2]))
    return verts


def torus(bm, sides, thickness):
    """A ring one unit across (its hole faces up); `thickness` is the tube's radius as a share of the ring's."""
    minor = 0.5 * thickness
    major = 0.5 - minor
    minor_sides = max(6, sides // 2)
    rings = []
    for i in range(sides):
        a = 2 * math.pi * i / sides
        rings.append([Vector(((major + minor * math.cos(2 * math.pi * j / minor_sides)) * math.cos(a), minor * math.sin(2 * math.pi * j / minor_sides), (major + minor * math.cos(2 * math.pi * j / minor_sides)) * math.sin(a))) for j in range(minor_sides)])
    verts = [bm.verts.new(p) for ring in rings for p in ring]
    grid = [verts[i * minor_sides : (i + 1) * minor_sides] for i in range(sides)]
    faces = []
    for i in range(sides):
        for j in range(minor_sides):
            n, m = (i + 1) % sides, (j + 1) % minor_sides
            faces.append(bm.faces.new((grid[i][j], grid[n][j], grid[n][m], grid[i][m])))
    return _finish(bm, verts, faces)


def lump(bm, sides, seed):
    """A boulder or a cloud: an ellipsoid whose surface is pushed in and out by a fixed pattern (the same for the same seed)."""
    verts = ellipsoid(bm, sides)
    for p in verts:
        ring = 1.0 - abs(p.co.y * 2)
        p.co *= 1.0 + 0.3 * ring * math.sin(seed + 7.1 * p.co.x + 9.3 * p.co.y) * math.cos(seed * 0.7 + 8.2 * p.co.z + 4.0 * p.co.x)
    return verts


def tube(bm, sides, points, radius, taper):
    """A pipe along `points` (in the unit space) with a frame carried along it so the rings never twist; it narrows to `taper` of its radius at the far end."""
    pts = [Vector(p) for p in points]
    rings, previous = [], None
    sides = max(6, sides // 2)
    for i, p in enumerate(pts):
        d = (pts[1] - p) if i == 0 else (p - pts[i - 1]) if i == len(pts) - 1 else (pts[i + 1] - pts[i - 1])
        d.normalize()
        if previous is None:
            up = Vector((0, 1, 0)) if abs(d.y) < 0.95 else Vector((1, 0, 0))
            a = d.cross(up).normalized()
        else:
            a = (previous - d * previous.dot(d)).normalized()
        previous = a
        b = d.cross(a).normalized()
        r = radius * (1.0 + (taper - 1.0) * i / max(1, len(pts) - 1))
        rings.append([p + (a * math.cos(2 * math.pi * k / sides) + b * math.sin(2 * math.pi * k / sides)) * max(r, 1e-4) for k in range(sides)])
    verts, faces = _ring_faces(bm, rings, True, True)
    return _finish(bm, verts, faces)


def loft(bm, sides, sections):
    """Cross-sections along z, joined: each is { z, w, h, round, dx, dy } (a width and a height, `round` 1 an ellipse and 0 a rounded rectangle, an offset). A section
    with no width or no height is a point, so a loft can end in a tip: a hull's nose, a snout, an ear."""
    rings = []
    n = max(8, sides)
    for s in sections:
        w, h, rnd = s["w"], s["h"], s["round"]
        center = Vector((s["dx"], s["dy"], s["z"]))
        if w < 1e-4 or h < 1e-4:
            rings.append(center)
            continue
        p = 2 + 8 * (1 - rnd)
        ring = []
        for k in range(n):
            t = 2 * math.pi * k / n
            c, sn = math.cos(t), math.sin(t)
            x = math.copysign(abs(c) ** (2 / p), c) * w / 2
            y = math.copysign(abs(sn) ** (2 / p), sn) * h / 2
            ring.append(center + Vector((x, y, 0)))
        rings.append(ring)
    verts, faces = _ring_faces(bm, rings, True, True)
    return _finish(bm, verts, faces)


# ---- checking: a recipe is untrusted until it has passed ----

SHAPES = ("ellipsoid", "capsule", "cylinder", "box", "torus", "lump", "tube", "revolve", "loft")
PART_KEYS = {"shape", "at", "size", "rot", "material", "mirror", "detail", "taper", "bevel", "thickness", "seed", "points", "radius", "profile", "sections", "joint"}
SECTION_KEYS = {"z", "w", "h", "round", "dx", "dy"}


class BadModel(Exception):
    pass


def _need(ok):
    if not ok:
        raise BadModel()


def _num(v, low, high):
    _need(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and low <= v <= high)
    return float(v)


def _vec(v, n, low, high):
    _need(isinstance(v, list) and len(v) == n)
    return [_num(x, low, high) for x in v]


def check_model(recipe, finishes):
    """The recipe as clean numbers, or BadModel: (materials, parts, rig). Nothing of it is used except as a number, a choice from a list, or an index."""
    _need(isinstance(recipe, dict) and recipe.get("kind") == "model" and recipe.get("version") == 2)
    materials = recipe.get("materials")
    _need(isinstance(materials, list) and 1 <= len(materials) <= CAPS["materials"])
    clean_materials = []
    for m in materials:
        _need(isinstance(m, dict) and set(m) == {"color", "finish"} and m["finish"] in finishes)
        _need(isinstance(m["color"], int) and not isinstance(m["color"], bool) and 0 <= m["color"] <= 4)
        clean_materials.append((m["color"], m["finish"]))
    rig = recipe.get("rig")
    _need(rig is None or (isinstance(rig, str) and rig in RIGS))
    parts = recipe.get("parts")
    _need(isinstance(parts, list) and 1 <= len(parts) <= CAPS["parts"])
    extent = CAPS["extent"]
    clean = []
    for p in parts:
        _need(isinstance(p, dict) and set(p) <= PART_KEYS and p.get("shape") in SHAPES)
        material = p.get("material", 0)
        _need(isinstance(material, int) and not isinstance(material, bool) and 0 <= material < len(clean_materials))
        detail = p.get("detail", 2)
        _need(detail in (1, 2, 3) and not isinstance(detail, bool))
        part = {
            "shape": p["shape"],
            "at": _vec(p.get("at", [0, 0, 0]), 3, -extent, extent),
            "size": _vec(p.get("size", [1, 1, 1]), 3, 0.005, extent),
            "rot": _vec(p.get("rot", [0, 0, 0]), 3, -360, 360),
            "material": material,
            "mirror": p.get("mirror", False) is True,
            "detail": detail,
        }
        if p.get("joint") is not None:
            _need(rig is not None and isinstance(p["joint"], str) and p["joint"] in RIGS[rig])
            part["joint"] = p["joint"]
        if p["shape"] == "cylinder":
            part["taper"] = _num(p.get("taper", 1.0), 0.0, 1.0)
        if p["shape"] == "box":
            part["bevel"] = _num(p.get("bevel", 0.0), 0.0, 0.45)
        if p["shape"] == "torus":
            part["thickness"] = _num(p.get("thickness", 0.3), 0.05, 0.9)
        if p["shape"] == "lump":
            part["seed"] = _num(p.get("seed", 1), 0, 1000)
        if p["shape"] == "tube":
            points = p.get("points")
            _need(isinstance(points, list) and 2 <= len(points) <= CAPS["points"])
            part["points"] = [_vec(pt, 3, -extent, extent) for pt in points]
            _need(all((Vector(a) - Vector(b)).length > 1e-4 for a, b in zip(part["points"], part["points"][1:])))
            part["radius"] = _num(p.get("radius", 0.1), 0.005, extent)
            part["taper"] = _num(p.get("taper", 1.0), 0.0, 1.0)
        if p["shape"] == "revolve":
            profile = p.get("profile")
            _need(isinstance(profile, list) and 2 <= len(profile) <= CAPS["profile"])
            part["profile"] = [_vec(pt, 2, -extent, extent) for pt in profile]
            _need(all(r >= 0 for r, _ in part["profile"]))
        if p["shape"] == "loft":
            sections = p.get("sections")
            _need(isinstance(sections, list) and 2 <= len(sections) <= CAPS["sections"])
            clean_sections = []
            for s in sections:
                _need(isinstance(s, dict) and set(s) <= SECTION_KEYS and "z" in s)
                clean_sections.append({"z": _num(s["z"], -extent, extent), "w": _num(s.get("w", 1.0), 0.0, extent), "h": _num(s.get("h", 1.0), 0.0, extent), "round": _num(s.get("round", 1.0), 0.0, 1.0), "dx": _num(s.get("dx", 0.0), -extent, extent), "dy": _num(s.get("dy", 0.0), -extent, extent)})
            part["sections"] = clean_sections
        clean.append(part)
    return clean_materials, clean, rig


# ---- building ----


def _make(bm, part):
    sides = SIDES[part["detail"]]
    shape = part["shape"]
    if shape == "ellipsoid":
        return ellipsoid(bm, sides)
    if shape == "capsule":
        return capsule(bm, sides)
    if shape == "cylinder":
        return cylinder(bm, sides, part["taper"])
    if shape == "box":
        return box(bm, part["size"], part["bevel"])
    if shape == "torus":
        return torus(bm, sides, part["thickness"])
    if shape == "lump":
        return lump(bm, sides, part["seed"])
    if shape == "tube":
        return tube(bm, sides, part["points"], part["radius"], part["taper"])
    if shape == "revolve":
        return revolve(bm, part["profile"], sides)
    return loft(bm, sides, part["sections"])


def _add_part(bm, part, which="both"):
    """Adds the part to `bm`, in model axes. `which` is "both" (the part, and its mirror image when it has one), "orig" (only the part) or "mirror" (only the
    mirror image: the part is drawn and then reflected in place), so the two sides of a jointed part can go to two meshes."""
    # a tube's points are in the model's own units; every other shape is drawn in its unit space and scaled by `size`
    sx, sy, sz = (1.0, 1.0, 1.0) if part["shape"] == "tube" else part["size"]
    before = len(bm.faces)
    verts = _make(bm, part)
    turn = Euler([math.radians(a) for a in part["rot"]], "XYZ").to_matrix()
    offset = Vector(part["at"])
    for v in verts:
        if not v.is_valid:
            continue
        v.co = turn @ Vector((v.co.x * sx, v.co.y * sy, v.co.z * sz)) + offset
    new_faces = list(bm.faces)[before:]
    for f in new_faces:
        f.material_index = part["material"]
    if which == "mirror":
        for v in {v for f in new_faces for v in f.verts}:
            v.co.x = -v.co.x
        bmesh.ops.reverse_faces(bm, faces=new_faces)
    elif part["mirror"] and which == "both":
        geom = new_faces + list({e for f in new_faces for e in f.edges}) + list({v for f in new_faces for v in f.verts})
        copy = bmesh.ops.duplicate(bm, geom=geom)["geom"]
        copy_verts = [g for g in copy if isinstance(g, bmesh.types.BMVert)]
        copy_faces = [g for g in copy if isinstance(g, bmesh.types.BMFace)]
        for v in copy_verts:
            v.co.x = -v.co.x
        bmesh.ops.reverse_faces(bm, faces=copy_faces)


def part_triangles(part):
    """The triangles a part will make once the model is triangulated (its mirror image included), counted on a scratch mesh: no scene, no export."""
    bm = bmesh.new()
    _add_part(bm, part)
    count = sum(len(f.verts) - 2 for f in bm.faces)
    bm.free()
    return count


def fit_parts(parts, budget):
    """The parts, brought inside `budget` triangles in the fixed order: every part's detail down a step at a time (3, then 2, then 1), then parts from the end of the
    list. Returns (parts, detail_cap, dropped), or raises BadModel when not even the first part fits."""
    for cap in (3, 2, 1):
        use = [{**p, "detail": min(p["detail"], cap)} for p in parts]
        counts = [part_triangles(p) for p in use]
        if sum(counts) <= budget:
            return use, cap, 0
    while counts and sum(counts) > budget:
        counts.pop()
        use.pop()
    _need(use)
    return use, 1, len(parts) - len(use)


def build_model(path, recipe, palette, finishes, budget=None, animate=None):
    """Builds the model and writes the GLB. Returns the real counts of the file, with `parts` (kept) and `dropped`. `animate`, when given, is called with
    ({name: object}, {name: rest location}) before the export: the objects are "model" (the root) and, for a rigged model, one per joint (build.py puts the
    stock clips on them). With a `budget` (triangles) the model is fitted to it by fit_parts and then checked by the real count of the GLB (dropping one more part
    and building again if it is somehow over); BadModel when it cannot fit."""
    clean_materials, parts, _ = check_model(recipe, finishes)
    dropped = 0
    if budget is not None:
        parts, _, dropped = fit_parts(parts, budget)
    while True:
        counts = _build(path, clean_materials, parts, palette, finishes, animate)
        if budget is None or counts["triangles"] <= budget:
            break
        _need(len(parts) > 1)
        parts = parts[:-1]
        dropped += 1
    return {**counts, "parts": len(parts), "dropped": dropped}


def _group(parts):
    """The parts' geometry grouped by the mesh it belongs to: "model" for everything that is not on a joint, else the joint's name (`leg_l` and `leg_r` for a sided joint,
    by the side of the part's center, and its mirror image on the other)."""
    bms = {}

    def bm_for(key):
        if key not in bms:
            bms[key] = bmesh.new()
        return bms[key]

    for part in parts:
        joint = part.get("joint")
        if joint is None:
            _add_part(bm_for("model"), part)
        elif not JOINT_PIVOTS[joint][1]:
            _add_part(bm_for(joint), part)
        else:
            side, other = ("l", "r") if part["at"][0] >= 0 else ("r", "l")
            _add_part(bm_for(f"{joint}_{side}"), part, "orig")
            if part["mirror"]:
                _add_part(bm_for(f"{joint}_{other}"), part, "mirror")
    return bms


def _pivot(name, bm):
    """A joint's pivot, in Blender's axes: the top, the bottom or the near end (see JOINT_PIVOTS) of the geometry it holds."""
    mode = JOINT_PIVOTS[name.rsplit("_", 1)[0] if name.endswith(("_l", "_r")) else name][0]
    xs, ys, zs = [v.co.x for v in bm.verts], [v.co.y for v in bm.verts], [v.co.z for v in bm.verts]
    cx, cy, cz = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, (min(zs) + max(zs)) / 2
    if mode == "top":
        return Vector((cx, cy, max(zs)))
    if mode == "bottom":
        return Vector((cx, cy, min(zs)))
    return Vector((cx, min(ys), cz))  # "back": the model's z is Blender's -y, so the end nearest the body is the smallest y of a tail that runs backwards


def _shade(bm, low, top):
    bm.verts.ensure_lookup_table()
    bm.normal_update()
    high.cavity_shading(bm, low, top)
    for edge in bm.edges:
        if len(edge.link_faces) == 2:
            edge.smooth = edge.calc_face_angle(0.0) < SMOOTH_ANGLE
    for face in bm.faces:
        face.smooth = True
    bmesh.ops.triangulate(bm, faces=bm.faces[:])


def _mesh_object(name, bm, library):
    mesh = bpy.data.meshes.new(f"{name}_mesh")
    bm.to_mesh(mesh)
    bm.free()
    for material in library:
        mesh.materials.append(material)
    obj = bpy.data.objects.new(name if name == "model" else f"{name}_mesh", mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def _build(path, clean_materials, parts, palette, finishes, animate=None):
    common.reset_scene()
    library = [common.finish_material(f"{finish}_{i}", common.hex_to_linear(palette[color].lower()), finishes[finish]) for i, (color, finish) in enumerate(clean_materials)]

    bms = _group(parts)
    # model axes to Blender's, then shaded meshes (the cavity shading reads the height of the whole model, so every mesh is shaded alike)
    for bm in bms.values():
        for v in bm.verts:
            v.co = Vector((v.co.x, -v.co.z, v.co.y))
        bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
    zs = [v.co.z for bm in bms.values() for v in bm.verts]
    low, top = min(zs), max(zs)
    pivots = {name: _pivot(name, bm) for name, bm in bms.items() if name != "model"}
    for bm in bms.values():
        _shade(bm, low, top)

    objects, rest = {}, {}
    if len(bms) == 1 and "model" in bms:
        # no joints: one mesh object is the whole model (and the object the stock clips move)
        objects["model"] = _mesh_object("model", bms["model"], library)
    else:
        root = bpy.data.objects.new("model", None)
        root.empty_display_size = 0.05
        bpy.context.scene.collection.objects.link(root)
        objects["model"] = root
        if "model" in bms:
            body = _mesh_object("body", bms["model"], library)
            body.parent = root
        for name in sorted(pivots):
            empty = bpy.data.objects.new(name, None)
            empty.empty_display_size = 0.05
            empty.rotation_mode = "XYZ"
            bpy.context.scene.collection.objects.link(empty)
            empty.parent = root
            empty.location = pivots[name]
            objects[name] = empty
        bpy.context.view_layer.update()  # matrices must be current before the meshes are parented with their inverse
        for name in sorted(pivots):
            obj = _mesh_object(name, bms[name], library)
            obj.parent = objects[name]
            obj.matrix_parent_inverse = objects[name].matrix_world.inverted()
    for name, obj in objects.items():
        obj.rotation_mode = "XYZ"
        rest[name] = tuple(obj.location)
    if animate is not None:
        animate(objects, rest)
        bpy.context.scene.frame_set(0)
    common.export_glb(path, animations=animate is not None, vertex_colors=True)
    return common.glb_counts(path)
