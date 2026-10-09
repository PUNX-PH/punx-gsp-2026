"""Build: a model with a skeleton and named clips, from a checked recipe.

    blender -b --factory-startup --disable-autoexec -noaudio --python-exit-code 1 -P build.py -- \
        --recipe recipe.json --out out.glb --stats stats.json

recipe.json is the body POST /build checked: { "recipe": ..., "motions": ..., "palette": [five #rrggbb] }. Every name in it is looked up in
kit.json (kinds, joints, slots, extras, channels, axes, waves); nothing in it is ever used as code, a path or a Blender property name.
The model is rigid parts, one mesh per joint, under a hierarchy of empties (no skin); each clip is one action per moved joint, keyed on
every frame and pushed onto an NLA track named after the clip, so the glTF exporter writes one animation per clip.

Exit 0: the GLB and the stats { triangles, parts, clips } (clips in the order Run, Jump, Loop, only those with a track). Exit 5: the recipe
breaks a rule this script can see (the worker has already checked the body, so this is a second line of defence): an unknown kind or scenery
piece, more extras or tracks than the caps, a joint that was not built, a number out of range, parts or triangles over the caps (scenery has
its own triangle cap) once built. Anything else
(including an uncaught exception, because the wrapper passes --python-exit-code 1) is a plain failure.

Axes in a recipe are the model's own: x side to side, y up, z forward (the way it faces). Blender's are X, Z up and -Y forward, so a model
(x, y, z) is the Blender point (x, -z, y); a rotation about the model's z is a rotation about Blender's -Y.
"""
import json
import math
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bmesh  # noqa: E402
import bpy  # noqa: E402
import common  # noqa: E402
import freeform  # noqa: E402
import high  # noqa: E402
import world  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

EXIT_BAD_RECIPE = 5

with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "kit.json"), encoding="utf-8") as _kit_file:
    KIT = json.load(_kit_file)

CLIPS = [("run", "Run"), ("jump", "Jump"), ("loop", "Loop")]
CHANNEL_PROPERTY = {"rotate": "rotation_euler", "move": "location", "scale": "scale"}
AXIS = {"x": (0, 1.0), "y": (2, 1.0), "z": (1, -1.0)}  # model axis -> (index in Blender, sign)
WAVES = ("swing", "spin", "bounce", "pulse", "hold")
JOINT_NAME = re.compile(r"^[a-z][a-z0-9_]{0,31}$")
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
FPS = KIT["motion"]["fps"]


class BadRecipe(Exception):
    """The recipe breaks a rule this script can see."""


def need(condition):
    if not condition:
        raise BadRecipe()


def is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def blender_point(p):
    """A model point (x, y up, z forward) as a Blender point."""
    return Vector((p[0], -p[2], p[1]))


def configure(parser):
    parser.add_argument("--recipe", required=True)


# ---- the biped: where every joint is and what hangs from it (model coordinates, meters) ----


def biped_layout(build, extras):
    """{joint: pivot} and [(joint, slot, shape, size, center)] for a two-legged character and its extras. Each joint's pivot is the top of
    its segment (a hip, a knee, an ankle, a shoulder), the feet are on y = 0 and the toes point to +z (the way the model faces)."""
    head, width, height = build["headSize"], build["torsoWidth"], build["torsoHeight"]
    arm, arm_t = build["armLength"], build["armThickness"]
    leg, leg_t, foot = build["legLength"], build["legThickness"], build["footSize"]
    depth = width * 0.6
    foot_h = foot * 0.4
    shin = (leg - foot_h) / 2
    thigh = (leg - foot_h) - shin
    pelvis = height * 0.25
    belly = leg + pelvis
    top = belly + height
    head_y = top + head * 0.15
    shoulder_y = top - arm_t * 0.6
    upper, fore, hand = arm * 0.4, arm * 0.35, arm * 0.25

    pivots = {"hips": (0, leg, 0), "spine": (0, belly, 0), "chest": (0, belly, 0), "neck": (0, top, 0), "head": (0, head_y, 0)}
    parts = [
        ("hips", "body", "box", (width, pelvis, depth), (0, leg + pelvis / 2, 0)),
        ("chest", "body", "box", (width, height, depth), (0, belly + height / 2, 0)),
        ("head", "head", "box", (head, head, head), (0, head_y + head / 2, 0)),
    ]
    for side, sign in (("l", 1), ("r", -1)):
        ax = sign * (width / 2 + arm_t / 2)
        lx = sign * width / 4
        pivots[f"upperarm_{side}"] = (ax, shoulder_y, 0)
        pivots[f"forearm_{side}"] = (ax, shoulder_y - upper, 0)
        pivots[f"hand_{side}"] = (ax, shoulder_y - upper - fore, 0)
        pivots[f"thigh_{side}"] = (lx, leg, 0)
        pivots[f"shin_{side}"] = (lx, foot_h + shin, 0)
        pivots[f"foot_{side}"] = (lx, foot_h, 0)
        parts += [
            (f"upperarm_{side}", "arms", "box", (arm_t, upper, arm_t), (ax, shoulder_y - upper / 2, 0)),
            (f"forearm_{side}", "arms", "box", (arm_t, fore, arm_t), (ax, shoulder_y - upper - fore / 2, 0)),
            (f"hand_{side}", "arms", "box", (arm_t * 1.2, hand, arm_t * 1.2), (ax, shoulder_y - upper - fore - hand / 2, 0)),
            (f"thigh_{side}", "legs", "box", (leg_t, thigh, leg_t), (lx, leg - thigh / 2, 0)),
            (f"shin_{side}", "legs", "box", (leg_t, shin, leg_t), (lx, foot_h + shin / 2, 0)),
            (f"foot_{side}", "feet", "box", (leg_t, foot_h, foot), (lx, foot_h / 2, foot / 2 - leg_t / 2)),
        ]

    back_y = leg + pelvis * 0.5
    head_top = head_y + head
    for extra in extras:
        if extra == "tail":
            pivots["tail_1"] = (0, back_y, -depth / 2)
            pivots["tail_2"] = (0, back_y, -depth / 2 - leg_t * 1.5)
            parts += [
                ("tail_1", "extra", "box", (leg_t * 0.8, leg_t * 0.8, leg_t * 1.5), (0, back_y, -depth / 2 - leg_t * 0.75)),
                ("tail_2", "extra", "box", (leg_t * 0.6, leg_t * 0.6, leg_t * 1.5), (0, back_y, -depth / 2 - leg_t * 2.25)),
            ]
        elif extra == "ears":
            for side, sign in (("l", 1), ("r", -1)):
                pivots[f"ear_{side}"] = (sign * head * 0.3, head_top, 0)
                parts.append((f"ear_{side}", "extra", "box", (head * 0.2, head * 0.3, head * 0.2), (sign * head * 0.3, head_top + head * 0.15, 0)))
        elif extra == "antenna":
            pivots["antenna"] = (0, head_top, 0)
            parts += [
                ("antenna", "extra", "box", (head * 0.08, head * 0.4, head * 0.08), (0, head_top + head * 0.2, 0)),
                ("antenna", "extra", "cylinder", (head * 0.12, head * 0.15), (0, head_top + head * 0.475, 0)),
            ]
        elif extra == "hat":
            pivots["hat"] = (0, head_top, 0)
            parts.append(("hat", "extra", "cylinder", (head * 0.55, head * 0.25), (0, head_top + head * 0.125, 0)))
        elif extra == "backpack":
            pivots["backpack"] = (0, belly + height * 0.55, -depth / 2)
            parts.append(("backpack", "extra", "box", (width * 0.7, height * 0.6, width * 0.25), (0, belly + height * 0.55, -depth / 2 - width * 0.125)))
    return pivots, parts


def vehicle_layout(build, extras):
    """A body box on the axle line, a cab box over its back half, wheels beside it in rows from front to back (a pair to a row; an odd last
    wheel sits alone in the middle of the back row). Every wheel touches y = 0 and spins about the model's x."""
    length, width, height = build["bodyLength"], build["bodyWidth"], build["bodyHeight"]
    cab, count, radius = build["cabSize"], int(build["wheelCount"]), build["wheelRadius"]
    wheel_w = radius * 0.7
    top = radius + height
    pivots = {"body": (0, radius + height / 2, 0)}
    parts = [("body", "body", "box", (width, height, length), (0, radius + height / 2, 0))]
    if cab > 0:
        parts.append(("body", "cab", "box", (width * 0.8, cab, length * 0.45), (0, top + cab / 2, -length / 4)))
    rows = (count + 1) // 2
    reach = max(0.0, length / 2 - radius * 1.3)  # the first and last axle, from the middle
    for k in range(1, count + 1):
        row = (k + 1) // 2 - 1
        z = 0.0 if rows == 1 else reach - row * 2 * reach / (rows - 1)
        alone = count % 2 == 1 and k == count
        x = 0.0 if alone else (width / 2 + wheel_w / 2) * (1 if k % 2 == 1 else -1)
        pivots[f"wheel_{k}"] = (x, radius, z)
        parts.append((f"wheel_{k}", "wheels", "cylinder", (radius, wheel_w, "x", 8), (x, radius, z)))
    if "antenna" in extras:
        ax, az, base = width * 0.3, -length * 0.4, top + cab
        pivots["antenna"] = (ax, base, az)
        parts += [
            ("antenna", "extra", "box", (width * 0.06, width * 0.4, width * 0.06), (ax, base + width * 0.2, az)),
            ("antenna", "extra", "cylinder", (width * 0.08, width * 0.1), (ax, base + width * 0.45, az)),
        ]
    return pivots, parts


def blob_layout(build, extras):
    """An icosphere squashed in height and sitting on y = 0, two cube eyes on its front, and the extras."""
    r, squash, eye = build["radius"], build["squash"], build["eyeSize"]
    half = r * squash
    cy, top = half, 2 * half
    eye_y, eye_z = cy + half * 0.25, r * 0.88  # on the surface: sqrt(1 - 0.4^2 - 0.25^2) = 0.88 of the radius
    pivots = {"body": (0, 0, 0), "eye_l": (r * 0.4, eye_y, eye_z), "eye_r": (-r * 0.4, eye_y, eye_z)}
    parts = [
        ("body", "body", "sphere", (r, squash), (0, cy, 0)),
        ("eye_l", "eyes", "box", (eye, eye, eye), pivots["eye_l"]),
        ("eye_r", "eyes", "box", (eye, eye, eye), pivots["eye_r"]),
    ]
    for extra in extras:
        if extra == "tail":
            back = -r * 0.95
            pivots["tail_1"], pivots["tail_2"] = (0, cy, back), (0, cy, back - r * 0.4)
            parts += [
                ("tail_1", "extra", "box", (r * 0.2, r * 0.2, r * 0.4), (0, cy, back - r * 0.2)),
                ("tail_2", "extra", "box", (r * 0.15, r * 0.15, r * 0.4), (0, cy, back - r * 0.6)),
            ]
        elif extra == "ears":
            for side, sign in (("l", 1), ("r", -1)):
                base = (sign * r * 0.5, cy + half * 0.85, 0)
                pivots[f"ear_{side}"] = base
                parts.append((f"ear_{side}", "extra", "box", (r * 0.2, r * 0.35, r * 0.2), (base[0], base[1] + r * 0.175, 0)))
        elif extra == "antenna":
            pivots["antenna"] = (0, top, 0)
            parts += [
                ("antenna", "extra", "box", (r * 0.06, r * 0.5, r * 0.06), (0, top + r * 0.25, 0)),
                ("antenna", "extra", "cylinder", (r * 0.1, r * 0.12), (0, top + r * 0.56, 0)),
            ]
        elif extra == "hat":
            pivots["hat"] = (0, top, 0)
            parts.append(("hat", "extra", "cylinder", (r * 0.45, r * 0.25), (0, top + r * 0.08, 0)))
    return pivots, parts


def prop_layout(build, extras):
    """One shape, `size` tall, standing on y = 0 and centered over the origin; its one joint is at its center."""
    s, shape = build["size"], build["shape"]
    mid = (0, s / 2, 0)
    pivots = {"root": mid}
    if shape == "cube":
        parts = [("root", "body", "box", (s, s, s), mid)]
    elif shape == "sphere":
        parts = [("root", "body", "sphere", (s / 2, 1.0), mid)]
    elif shape == "cone":
        parts = [("root", "body", "cone", (s / 2, s, 8, "up"), mid)]
    elif shape == "cylinder":
        parts = [("root", "body", "cylinder", (s / 2, s), mid)]
    elif shape == "pyramid":
        parts = [("root", "body", "cone", (s / 2, s, 4, "up"), mid)]
    elif shape == "coin":
        parts = [("root", "body", "cylinder", (s / 2, s * 0.15, "z", 12), mid)]
    elif shape == "ring":
        parts = [("root", "body", "torus", (s * 0.35, s * 0.15, 12, 6), mid)]
    elif shape == "gem":
        parts = [("root", "body", "gem", (s * 0.35, s), mid)]
    else:  # crate: a cube and two bands round it
        parts = [
            ("root", "body", "box", (s, s, s), mid),
            ("root", "extra", "box", (s * 1.08, s * 0.14, s * 1.08), (0, s * 0.2, 0)),
            ("root", "extra", "box", (s * 1.08, s * 0.14, s * 1.08), (0, s * 0.8, 0)),
        ]
    return pivots, parts


# ---- scenery: each piece is built at the height the kit gives, standing on y = 0, centered over the origin ----


def tree_layout():
    """A trunk and a round canopy of two overlapping spheres. The canopy sways from the top of the trunk."""
    trunk, r = 1.5, 0.2
    canopy = (3.5 - trunk) / 2
    return (
        {"root": (0, 0, 0), "canopy": (0, trunk, 0)},
        [
            ("root", "detail", "cylinder", (r, trunk), (0, trunk / 2, 0)),
            ("canopy", "main", "sphere", (canopy, 1.0), (0, trunk + canopy, 0)),
            ("canopy", "main", "sphere", (canopy * 0.7, 1.0), (canopy * 0.55, trunk + canopy * 0.8, canopy * 0.3)),
        ],
    )


def pine_layout():
    """A thin trunk and three stacked cones, each narrower than the one below. The canopy sways from the top of the trunk."""
    trunk = 1.0
    parts = [("root", "detail", "cylinder", (0.15, trunk), (0, trunk / 2, 0))]
    for base, radius, depth in ((0.8, 1.3, 1.7), (1.9, 1.0, 1.6), (2.9, 0.7, 1.6)):
        parts.append(("canopy", "main", "cone", (radius, depth, 8, "up"), (0, base + depth / 2, 0)))
    return {"root": (0, 0, 0), "canopy": (0, 0.8, 0)}, parts


def rock_layout():
    """A flattened boulder and a smaller stone beside it."""
    return (
        {"root": (0, 0, 0)},
        [
            ("root", "main", "sphere", (0.8, 0.75, 1), (0, 0.6, 0)),
            ("root", "detail", "sphere", (0.45, 0.7, 1), (0.85, 0.315, 0.3)),
        ],
    )


def cactus_layout():
    """A tall body, an arm each side (a bar out and a bar up) and a flower on top."""
    parts = [
        ("root", "main", "cylinder", (0.28, 2.0), (0, 1.0, 0)),
        ("root", "main", "box", (0.6, 0.2, 0.2), (0.5, 1.0, 0)),
        ("root", "main", "box", (0.2, 0.7, 0.2), (0.7, 1.35, 0)),
        ("root", "main", "box", (0.6, 0.2, 0.2), (-0.5, 1.4, 0)),
        ("root", "main", "box", (0.2, 0.7, 0.2), (-0.7, 1.75, 0)),
        ("root", "detail", "box", (0.2, 0.2, 0.2), (0, 2.1, 0)),
    ]
    return {"root": (0, 0, 0)}, parts


def windmill_layout():
    """A tapering tower with a pointed cap, and four blades round a hub on its -z side, the side the player approaches from (scenery is never
    turned, and from behind the tower would hide the blades). The blades turn about the model's z axis."""
    hub = (0, 4.0, -0.75)
    parts = [
        ("root", "main", "frustum", (0.9, 0.55, 4.6, 8), (0, 2.3, 0)),
        ("root", "detail", "cone", (0.75, 1.4, 8, "up"), (0, 5.3, 0)),
        ("blades", "detail", "box", (0.3, 0.3, 0.12), hub),
        ("blades", "detail", "box", (1.6, 0.3, 0.06), (1.0, hub[1], hub[2])),
        ("blades", "detail", "box", (1.6, 0.3, 0.06), (-1.0, hub[1], hub[2])),
        ("blades", "detail", "box", (0.3, 1.6, 0.06), (0, hub[1] + 1.0, hub[2])),
        ("blades", "detail", "box", (0.3, 1.6, 0.06), (0, hub[1] - 1.0, hub[2])),
    ]
    return {"root": (0, 0, 0), "blades": hub}, parts


def lamp_layout():
    """A round base, a thin pole and a square lamp on top."""
    parts = [
        ("root", "main", "cylinder", (0.22, 0.2), (0, 0.1, 0)),
        ("root", "main", "cylinder", (0.06, 2.6), (0, 1.5, 0)),
        ("root", "detail", "box", (0.4, 0.4, 0.4), (0, 3.0, 0)),
    ]
    return {"root": (0, 0, 0)}, parts


SCENERY_LAYOUTS = {"tree": tree_layout, "pine": pine_layout, "rock": rock_layout, "cactus": cactus_layout, "windmill": windmill_layout, "lamp": lamp_layout}


def scenery_layout(build, extras):
    return SCENERY_LAYOUTS[build["scenery"]]()


LAYOUTS = {"biped": biped_layout, "vehicle": vehicle_layout, "blob": blob_layout, "prop": prop_layout, "scenery": scenery_layout}


# ---- checking the body ----


def joint_list(kind, spec, build, extras):
    """[(joint, parent)] in order: the kind's joints (a vehicle's wheels follow its body), then each extra's (an `@anchor` parent is the
    joint the kind names for it)."""
    joints = [(name, parent) for name, parent in spec["joints"]]
    if kind == "vehicle":
        joints += [(f"wheel_{k}", "body") for k in range(1, int(build["wheelCount"]) + 1)]
    for extra in extras:
        for name, parent in KIT["extras"][extra]["joints"]:
            joints.append((name, spec["anchors"][parent[1:]] if parent.startswith("@") else parent))
    return joints


def check_motions(motions, names):
    """The motion rules, for a model or a scenery piece: `names` are the joints that were built."""
    need(isinstance(motions, dict) and set(motions) == {"version", "motions"} and isinstance(motions["motions"], dict))
    for key, motion in motions["motions"].items():
        need(key in dict(CLIPS) and isinstance(motion, dict) and isinstance(motion.get("tracks"), list))
        need(is_number(motion.get("seconds")) and KIT["motion"]["seconds"][0] <= motion["seconds"] <= KIT["motion"]["seconds"][1])
        need(len(motion["tracks"]) <= KIT["caps"]["tracks"])
        for track in motion["tracks"]:
            need(isinstance(track, dict) and set(track) == {"joint", "channel", "axis", "wave", "amplitude", "cycles", "phase"})
            need(isinstance(track["joint"], str) and JOINT_NAME.match(track["joint"]) and track["joint"] in names)
            need(track["channel"] in CHANNEL_PROPERTY and track["axis"] in AXIS and track["wave"] in WAVES)
            need(track["wave"] != "spin" or track["channel"] == "rotate")
            low, high = KIT["motion"]["amplitude"][track["channel"]]
            need(is_number(track["amplitude"]) and low <= track["amplitude"] <= high)
            need(is_number(track["cycles"]) and KIT["motion"]["cycles"][0] <= track["cycles"] <= KIT["motion"]["cycles"][1])
            need(is_number(track["phase"]) and KIT["motion"]["phase"][0] <= track["phase"] <= KIT["motion"]["phase"][1])


def check_colors(colors, slots):
    need(isinstance(colors, dict) and set(colors) == set(slots))
    need(all(isinstance(v, int) and not isinstance(v, bool) and 0 <= v <= 4 for v in colors.values()))


def check_scenery(recipe, motions, palette):
    """A scenery piece: its build is exactly { scenery: <one of the kit's pieces> }, its colors are that piece's slots, it takes no extras."""
    build = recipe.get("build")
    need(isinstance(build, dict) and set(build) == {"scenery"} and isinstance(build["scenery"], str) and build["scenery"] in KIT["scenery"])
    spec = KIT["scenery"][build["scenery"]]
    need(recipe.get("extras") == [])
    check_colors(recipe.get("colors"), spec["slots"])
    joints = [(name, parent) for name, parent in spec["joints"]]
    check_motions(motions, {name for name, _ in joints})
    return recipe, motions, palette, spec, joints


def check_world(recipe, motions, palette):
    """A piece of the High world: its build is exactly { piece, style } from the kit's lists, its colors and finishes are the world's three slots,
    it is High, has no extras, no details and no motions."""
    tier = KIT["tiers"]["high"]
    build = recipe.get("build")
    need(isinstance(build, dict) and set(build) == {"piece", "style"})
    need(isinstance(build["piece"], str) and build["piece"] in tier["worlds"]["pieces"])
    need(isinstance(build["style"], str) and build["style"] in tier["worlds"]["styles"])
    need(recipe.get("quality") == "high" and recipe.get("extras") == [] and recipe.get("details") == [])
    slots = tier["worlds"]["slots"]
    check_colors(recipe.get("colors"), slots)
    finishes = recipe.get("finishes")
    need(isinstance(finishes, dict) and set(finishes) == set(slots) and all(isinstance(v, str) and v in tier["finishes"] for v in finishes.values()))
    check_motions(motions, {"root"})
    need(motions["motions"] == {})
    return recipe, motions, palette, None, [("root", None)]


def check_body(body):
    """The rules this script can see; raises BadRecipe. Returns (recipe, motions, palette, spec, joints)."""
    need(isinstance(body, dict) and set(body) == {"recipe", "motions", "palette"})
    recipe, motions, palette = body["recipe"], body["motions"], body["palette"]
    need(isinstance(palette, list) and len(palette) == 5 and all(isinstance(c, str) and HEX.match(c) for c in palette))
    need(isinstance(recipe, dict))
    if recipe.get("kind") == "world":
        return check_world(recipe, motions, palette)
    need(recipe.get("kind") in LAYOUTS)
    if recipe["kind"] == "scenery":
        return check_scenery(recipe, motions, palette)
    need(recipe["kind"] in KIT["kinds"])
    spec = KIT["kinds"][recipe["kind"]]
    extras = recipe.get("extras")
    need(isinstance(extras, list) and len(extras) <= KIT["caps"]["extras"] and len(set(extras)) == len(extras))
    need(all(isinstance(e, str) and e in spec["extras"] for e in extras))
    build = recipe.get("build")
    need(isinstance(build, dict) and set(build) == set(spec["build"]))
    for name, field in spec["build"].items():
        if "choices" in field:
            need(build[name] in field["choices"])
        else:
            need(is_number(build[name]) and field["min"] <= build[name] <= field["max"])
            need(not field.get("whole") or float(build[name]).is_integer())
    check_colors(recipe.get("colors"), spec["slots"])

    joints = joint_list(recipe["kind"], spec, build, extras)
    check_motions(motions, {name for name, _ in joints})
    return recipe, motions, palette, spec, joints


# ---- building the model ----


# A shape is made in Blender's own axes, centered on the origin, with its axis along Blender's Z (the model's up) unless it says otherwise.
TURNS = {"y": None, "x": Matrix.Rotation(math.radians(90), 3, "Y"), "z": Matrix.Rotation(math.radians(90), 3, "X")}  # up -> model x, up -> model z


def turned(verts, axis):
    if TURNS[axis] is not None:
        for v in verts:
            v.co = TURNS[axis] @ v.co
    return verts


def make_box(bm, size):
    sx, sy, sz = size  # model x, y (up), z (forward)
    verts = bmesh.ops.create_cube(bm, size=1.0)["verts"]
    for v in verts:
        v.co = Vector((v.co.x * sx, v.co.y * sz, v.co.z * sy))
    return verts


def make_cylinder(bm, size):
    """(radius, depth) standing up with 8 sides, or (radius, depth, axis, sides)."""
    radius, depth, *more = size
    axis, sides = (more[0], more[1]) if more else ("y", 8)
    verts = bmesh.ops.create_cone(bm, cap_ends=True, segments=sides, radius1=radius, radius2=radius, depth=depth)["verts"]
    return turned(verts, axis)


def make_cone(bm, size):
    """(radius, depth, sides, 'up' | 'down'): the base is the wide end and the point the other."""
    radius, depth, sides, direction = size
    r1, r2 = (radius, 0.0) if direction == "up" else (0.0, radius)
    return bmesh.ops.create_cone(bm, cap_ends=True, segments=sides, radius1=r1, radius2=r2, depth=depth)["verts"]


def make_sphere(bm, size):
    """(radius, squash) or (radius, squash, subdivisions): an icosphere (80 triangles at 2, 20 at 1), its height scaled by squash."""
    radius, squash, *more = size
    verts = bmesh.ops.create_icosphere(bm, subdivisions=more[0] if more else 2, radius=radius)["verts"]
    for v in verts:
        v.co.z *= squash
    return verts


def make_frustum(bm, size):
    """(bottom radius, top radius, depth, sides): a cone with its point cut off, standing up."""
    bottom, top, depth, sides = size
    return bmesh.ops.create_cone(bm, cap_ends=True, segments=sides, radius1=bottom, radius2=top, depth=depth)["verts"]


def make_torus(bm, size):
    """(major radius, minor radius, major sides, minor sides), standing on edge with its hole facing the model's z."""
    major, minor, ring_sides, tube_sides = size
    rings = []
    for i in range(ring_sides):
        a = 2 * math.pi * i / ring_sides
        ring = []
        for j in range(tube_sides):
            b = 2 * math.pi * j / tube_sides
            reach = major + minor * math.cos(b)
            ring.append(bm.verts.new((reach * math.cos(a), reach * math.sin(a), minor * math.sin(b))))
        rings.append(ring)
    faces = []
    for i in range(ring_sides):
        for j in range(tube_sides):
            n, m = (i + 1) % ring_sides, (j + 1) % tube_sides
            faces.append(bm.faces.new((rings[i][j], rings[n][j], rings[n][m], rings[i][m])))
    bmesh.ops.recalc_face_normals(bm, faces=faces)  # a closed shape of its own, so "outward" is well defined
    return turned([v for ring in rings for v in ring], "z")


def make_gem(bm, size):
    """(radius, height): two 4-sided cones base to base."""
    radius, height = size
    verts = []
    for direction, shift in (("up", height / 4), ("down", -height / 4)):
        made = make_cone(bm, (radius, height / 2, 4, direction))
        for v in made:
            v.co.z += shift
        verts += made
    return verts


SHAPES = {"box": make_box, "cylinder": make_cylinder, "cone": make_cone, "sphere": make_sphere, "frustum": make_frustum, "torus": make_torus, "gem": make_gem}


class Meshes:
    """One bmesh per joint, with the joint's own list of materials."""

    def __init__(self, palette, colors):
        self.palette, self.colors = palette, colors
        self.bms, self.materials, self.library = {}, {}, {}
        self.parts = 0

    def material(self, slot):
        color = self.palette[self.colors[slot]].lower()
        if color not in self.library:
            self.library[color] = common.flat_material(f"color_{len(self.library)}", common.hex_to_linear(color))
        return self.library[color]

    def add(self, joint, slot, shape, size, center):
        bm = self.bms.setdefault(joint, bmesh.new())
        materials = self.materials.setdefault(joint, [])
        material = self.material(slot)
        if material not in materials:
            materials.append(material)
        index = materials.index(material)
        offset = blender_point(center)
        made = SHAPES[shape](bm, size)
        for v in made:
            v.co = v.co + offset
        for face in {f for v in made for f in v.link_faces}:
            face.material_index = index
        self.parts += 1


def build_joints(joints, pivots):
    """One empty per joint, parents first, placed at its pivot relative to its parent. Returns ({joint: object}, {joint: rest location})."""
    objects, rest = {}, {}
    for name, parent in joints:
        empty = bpy.data.objects.new(name, None)
        empty.empty_display_type = "PLAIN_AXES"
        empty.empty_display_size = 0.05
        empty.rotation_mode = "XYZ"
        bpy.context.scene.collection.objects.link(empty)
        if parent is None:
            empty.location = blender_point(pivots[name])
        else:
            empty.parent = objects[parent]
            p, q = pivots[name], pivots[parent]
            empty.location = blender_point((p[0] - q[0], p[1] - q[1], p[2] - q[2]))
        objects[name] = empty
        rest[name] = tuple(empty.location)
    bpy.context.view_layer.update()  # matrices must be current before the meshes are parented with their inverse
    return objects, rest


def attach_meshes(meshes, objects):
    """Each joint's parts become one triangulated mesh object, parented to the joint without moving."""
    triangles = 0
    for joint, bm in meshes.bms.items():
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
        triangles += len(bm.faces)
        mesh = bpy.data.meshes.new(f"{joint}_mesh")
        bm.to_mesh(mesh)
        bm.free()
        for material in meshes.materials[joint]:
            mesh.materials.append(material)
        obj = bpy.data.objects.new(f"{joint}_mesh", mesh)
        bpy.context.scene.collection.objects.link(obj)
        obj.parent = objects[joint]
        obj.matrix_parent_inverse = objects[joint].matrix_world.inverted()
    return triangles


# ---- the clips ----


def wave_value(track, u):
    """A track's value at u = time / seconds: degrees for rotate, meters for move, a fraction of the rest scale for scale."""
    a, cycles, phase = track["amplitude"], track["cycles"], track["phase"]
    wave = track["wave"]
    if wave == "swing":
        return a * math.sin(2 * math.pi * (cycles * u + phase))
    if wave == "spin":
        return (-1.0 if a < 0 else 1.0) * 360.0 * cycles * u
    if wave == "bounce":
        return a * abs(math.sin(math.pi * (cycles * u + phase)))
    if wave == "pulse":
        return a * (0.5 - 0.5 * math.cos(2 * math.pi * (cycles * u + phase)))
    return a  # hold


def bake_clip(clip_name, motion, objects, rest):
    """One action per moved joint (`<Clip>.<joint>`), keyed on every frame, then pushed onto an NLA track named after the clip."""
    frames = max(1, round(motion["seconds"] * FPS))
    by_joint = {}
    for track in motion["tracks"]:
        by_joint.setdefault(track["joint"], []).append(track)
    for joint, tracks in by_joint.items():
        obj = objects[joint]
        if obj.animation_data is None:
            obj.animation_data_create()
        action = bpy.data.actions.new(f"{clip_name}.{joint}")
        obj.animation_data.action = action  # Blender 5.2: keyframe_insert while an action is assigned (Action.fcurves is not used)
        for frame in range(frames + 1):
            u = frame / frames
            totals = {}
            for track in tracks:
                key = (track["channel"], track["axis"])
                totals[key] = totals.get(key, 0.0) + wave_value(track, u)
            for (channel, axis), total in totals.items():
                prop = CHANNEL_PROPERTY[channel]
                index, sign = AXIS[axis]
                if channel == "rotate":
                    value = math.radians(total) * sign
                elif channel == "move":
                    value = rest[joint][index] + total * sign
                else:
                    value = 1.0 + total
                getattr(obj, prop)[index] = value
                obj.keyframe_insert(data_path=prop, index=index, frame=frame)
        obj.animation_data.action = None
        nla = obj.animation_data.nla_tracks.new()
        nla.name = clip_name
        nla.strips.new(clip_name, 0, action)
        obj.rotation_euler = (0.0, 0.0, 0.0)  # back to the rest pose
        obj.location = rest[joint]
        obj.scale = (1.0, 1.0, 1.0)


# ---- the High tier ----


def check_high(recipe, spec):
    """The High rules this script can see (the worker has already checked them): returns True for a High recipe, False for Standard; raises
    BadRecipe for a quality that is neither, a Standard recipe with finishes or details, a High recipe whose finishes or details are not the
    kit's, and a kind with no High builder yet."""
    quality = recipe.get("quality", "standard")
    need(quality in ("standard", "high"))
    if quality == "standard":
        need("finishes" not in recipe and "details" not in recipe)
        return False
    tier = KIT["tiers"]["high"]
    need(recipe["kind"] in high.HIGH_LAYOUTS)
    finishes = recipe.get("finishes")
    need(isinstance(finishes, dict) and set(finishes) == set(spec["slots"]) and all(v in tier["finishes"] for v in finishes.values()))
    details = recipe.get("details")
    need(isinstance(details, list) and len(details) <= tier["caps"]["details"] and len(set(map(str, details))) == len(details))
    need(all(isinstance(d, str) and d in tier["details"] and recipe["kind"] in tier["details"][d] for d in details))
    return True


def estimate_high(recipe):
    """What the kit's tier says a High recipe uses: the same arithmetic as the web app's estimate (recipes.ts) and the worker's (recipe.mjs)."""
    tier = KIT["tiers"]["high"]
    kind, build = recipe["kind"], recipe["build"]
    if kind == "vehicle":
        base = dict(tier["base"]["vehicle"])
        cab, wheel = base.pop("cab"), base.pop("wheel")
        total = dict(base)
        parts = [(cab, 1)] if build["cabSize"] > 0 else []
        parts.append((wheel, int(build["wheelCount"])))
    elif kind == "prop":
        total, parts = dict(tier["base"]["prop"]["shapes"][build["shape"]]), []
    elif kind == "scenery":
        total, parts = dict(tier["base"]["scenery"][build["scenery"]]), []
    else:
        total, parts = dict(tier["base"][kind]), []
    for cost, count in parts:
        for key in total:
            total[key] += cost[key] * count
    for extra in recipe["extras"]:
        for key in total:
            total[key] += tier["extras"][extra][key]
    for detail in recipe["details"]:
        cost = tier["details"][detail][kind]
        for key in total:
            total[key] += cost[key]
    return total


def merge_map(joints, moved):
    """{joint: the joint whose mesh holds its parts}: a joint no clip moves shares the mesh of its nearest ancestor that one does (the first
    joint, the root, always has a mesh). The joint stays a node, so its children keep their transforms."""
    parent = dict(joints)
    root = joints[0][0]
    group = {}
    for name, _ in joints:
        group[name] = name if name in moved or name == root else group[parent[name]]
    return group


def build_high(out, recipe, motions, palette, spec, joints, extras, details, bevel):
    """Builds one High configuration of a recipe (the extras, details and bevel it is given), exports it to `out` and returns what the
    exported GLB really holds ({ triangles, vertices, parts, meshes }) and its clips."""
    tier = KIT["tiers"]["high"]
    kind = recipe["kind"]
    moved = {track["joint"] for motion in motions["motions"].values() if motion["tracks"] for track in motion["tracks"]}
    group_of = merge_map(joints, moved)

    common.reset_scene()
    pivots, _ = LAYOUTS[kind](recipe["build"], extras)  # the pivots are Standard's, so the same clips move the same joints
    objects, rest = build_joints(joint_list(kind, spec, recipe["build"], extras), pivots)
    builder = high.HighBuilder(palette, recipe["colors"], recipe["finishes"], tier["finishes"], group_of, bevel)
    high.HIGH_LAYOUTS[kind](builder, recipe["build"], extras, details, pivots)
    zs = [v.co.z for group in builder.groups.values() for v in group.bm.verts]
    high.finish(builder, objects, (min(zs), max(zs)), high.STRATA.get(recipe["build"].get("scenery")))
    need(len(builder.library) <= tier["caps"]["materials"])

    clips = []
    for key, clip_name in CLIPS:
        motion = motions["motions"].get(key)
        if motion and motion["tracks"]:
            bake_clip(clip_name, motion, objects, rest)
            clips.append(clip_name)
    bpy.context.scene.frame_set(0)
    common.export_glb(out, animations=bool(clips), vertex_colors=True)
    real = common.glb_counts(out)
    real["parts"] = builder.parts
    return real, clips


def run_high(args, recipe, motions, palette, spec, joints):
    """Builds a High model and fits it to its caps by the real counts of the exported GLB, dropping, in the tier's order, cables, bolts, seams,
    lights, then extras from the end, then bevel segments. Exits 5 when it cannot fit, and when the real counts are not within 10 percent of
    the kit's estimate (a mistake in the kit's tables, not in the recipe)."""
    caps = KIT["tiers"]["high"]["caps"][recipe["kind"]]
    details, extras, bevel = list(recipe["details"]), list(recipe["extras"]), 2
    while True:
        real, clips = build_high(args.out, recipe, motions, palette, spec, joints, extras, details, bevel)
        if all(real[key] <= caps[key] for key in ("triangles", "vertices", "parts", "meshes")):
            break
        droppable = next((d for d in ("cables", "bolts", "seams", "lights") if d in details), None)
        if droppable:
            details.remove(droppable)
        elif extras:
            extras.pop()
        elif bevel > 0:
            bevel -= 1
        else:
            raise BadRecipe()

    estimated = estimate_high({**recipe, "extras": extras, "details": details})
    for key in ("triangles", "vertices"):
        need(abs(real[key] - estimated[key]) <= 0.10 * estimated[key])
    with open(args.stats, "w", encoding="utf-8") as handle:
        json.dump({"triangles": real["triangles"], "vertices": real["vertices"], "parts": real["parts"], "meshes": real["meshes"], "clips": clips}, handle)


def run_world(args, recipe, palette):
    """Builds a piece of the world. The kit's number for a piece is the larger of its two styles' (they build different shapes), so the real
    count must be at most that and not less than half of it; and within the piece's caps."""
    tier = KIT["tiers"]["high"]
    piece = recipe["build"]["piece"]
    real = world.build_world(args.out, recipe, palette, tier)
    caps, base = tier["caps"]["world"][piece], tier["base"]["world"][piece]
    for key in ("triangles", "vertices"):
        need(real[key] <= caps[key] and 0.5 * base[key] <= real[key] <= base[key])
    with open(args.stats, "w", encoding="utf-8") as handle:
        json.dump({"triangles": real["triangles"], "vertices": real["vertices"], "parts": 1, "meshes": real["meshes"], "clips": []}, handle)


# The stock clips of a freeform model, by rig. The root ("model") is the whole body, with its origin at the middle of the feet, so a turn or a stretch happens about
# them; a rigged model also has its joints (`leg_l`, `arm_r`, `head`, `tail`, ...), which swing about their pivots. The tracks and waves are the kit's, within its ranges. A track
# on a joint the model lacks (a part was dropped for the budget, or the recipe gave none) is left out.
def _track(joint, channel, axis, wave, amplitude, cycles, phase=0):
    return {"joint": joint, "channel": channel, "axis": axis, "wave": wave, "amplitude": amplitude, "cycles": cycles, "phase": phase}


def _swing(joint, amplitude, phase, cycles=1):
    return _track(joint, "rotate", "x", "swing", amplitude, cycles, phase)


def _tuck(joint, amplitude):
    return _track(joint, "rotate", "x", "pulse", amplitude, 1)


_STRETCH = [_track("model", "scale", "y", "pulse", 0.15, 1), _track("model", "scale", "x", "pulse", -0.08, 1), _track("model", "scale", "z", "pulse", -0.08, 1)]
_LOOP = {"seconds": 2.0, "tracks": [_track("model", "rotate", "y", "spin", 90, 1), _track("model", "move", "y", "swing", 0.05, 2)]}

STOCK_CLIPS = {
    # no rig: the whole body bobs, rocks and pitches; stretches; turns
    "none": {
        "Run": {"seconds": 0.6, "tracks": [_track("model", "move", "y", "bounce", 0.07, 2), _track("model", "rotate", "z", "swing", 6, 1), _swing("model", 4, 0.25, 2)]},
        "Jump": {"seconds": 0.8, "tracks": _STRETCH},
        "Loop": _LOOP,
    },
    # two legs and two arms swing in opposition, the head nods, the tail whips
    "biped": {
        "Run": {"seconds": 0.6, "tracks": [
            _track("model", "move", "y", "bounce", 0.05, 2),
            _swing("leg_l", 40, 0), _swing("leg_r", 40, 0.5), _swing("arm_l", 35, 0.5), _swing("arm_r", 35, 0),
            _swing("head", 4, 0.25, 2), _track("tail", "rotate", "y", "swing", 15, 2),
        ]},
        "Jump": {"seconds": 0.8, "tracks": [_tuck("leg_l", -50), _tuck("leg_r", -50), _tuck("arm_l", -70), _tuck("arm_r", -70), _tuck("head", -8), *_STRETCH[:1]]},
        "Loop": _LOOP,
    },
    # a trot: diagonal legs together, the head bobs, the tail swings
    "quadruped": {
        "Run": {"seconds": 0.5, "tracks": [
            _track("model", "move", "y", "bounce", 0.04, 2),
            _swing("leg_front_l", 45, 0), _swing("leg_front_r", 45, 0.5), _swing("leg_back_l", 45, 0.5), _swing("leg_back_r", 45, 0),
            _swing("head", 6, 0.25, 2), _track("tail", "rotate", "y", "swing", 20, 2, 0.5),
        ]},
        "Jump": {"seconds": 0.8, "tracks": [_tuck("leg_front_l", -40), _tuck("leg_front_r", -40), _tuck("leg_back_l", 40), _tuck("leg_back_r", 40), _tuck("head", -10), *_STRETCH[:1]]},
        "Loop": _LOOP,
    },
}


def run_model(args, body):
    """A freeform model: the same rules as recipe.mjs (checked again here), fitted to the budget of its role and target by the real count of the GLB.
    The body's `clips` (Run, Jump, Loop) are the stock clips put on the model. Exits 5 when the body breaks a rule or the model cannot fit; the stats carry the kept parts and how many were dropped to fit."""
    need(set(body) == {"recipe", "palette", "role", "target", "clips"})
    need(body["role"] in freeform.BUDGETS and body["target"] in ("pc", "mobile"))
    palette = body["palette"]
    need(isinstance(palette, list) and len(palette) == 5 and all(isinstance(c, str) and HEX.match(c) for c in palette))
    clips = body["clips"]
    need(isinstance(clips, list) and len(set(map(str, clips))) == len(clips) and all(isinstance(c, str) and c in STOCK_CLIPS["none"] for c in clips))
    clips = [name for name in STOCK_CLIPS["none"] if name in clips]  # the order of the kit: Run, Jump, Loop
    rig = body["recipe"].get("rig") or "none"
    need(rig in STOCK_CLIPS)

    def animate(objects, rest):
        for name in clips:
            motion = STOCK_CLIPS[rig][name]
            tracks = [track for track in motion["tracks"] if track["joint"] in objects]
            bake_clip(name, {"seconds": motion["seconds"], "tracks": tracks}, objects, rest)

    counts = freeform.build_model(args.out, body["recipe"], palette, KIT["tiers"]["high"]["finishes"], freeform.BUDGETS[body["role"]][body["target"]], animate if clips else None)
    with open(args.stats, "w", encoding="utf-8") as handle:
        json.dump({**counts, "clips": clips}, handle)


def main():
    args = common.parse_args(configure)
    try:
        with open(args.recipe, encoding="utf-8") as handle:
            body = json.load(handle)
        if isinstance(body, dict) and isinstance(body.get("recipe"), dict) and body["recipe"].get("kind") == "model":
            run_model(args, body)
            return
        recipe, motions, palette, spec, joints = check_body(body)
        if recipe["kind"] == "world":
            run_world(args, recipe, palette)
            return
        if check_high(recipe, spec):
            run_high(args, recipe, motions, palette, spec, joints)
            return

        common.reset_scene()
        pivots, parts = LAYOUTS[recipe["kind"]](recipe["build"], recipe["extras"])
        objects, rest = build_joints(joints, pivots)
        meshes = Meshes(palette, recipe["colors"])
        for joint, slot, shape, size, center in parts:
            meshes.add(joint, slot, shape, size, center)
        triangles = attach_meshes(meshes, objects)
        cap = KIT["caps"]["sceneryTriangles"] if recipe["kind"] == "scenery" else KIT["caps"]["triangles"]
        need(meshes.parts <= KIT["caps"]["parts"] and triangles <= cap)

        clips = []
        for key, clip_name in CLIPS:
            motion = motions["motions"].get(key)
            if motion and motion["tracks"]:
                bake_clip(clip_name, motion, objects, rest)
                clips.append(clip_name)
    except (BadRecipe, freeform.BadModel, OSError, ValueError, KeyError):
        sys.exit(EXIT_BAD_RECIPE)

    bpy.context.scene.frame_set(0)
    common.export_glb(args.out, animations=bool(clips))
    with open(args.stats, "w", encoding="utf-8") as handle:
        json.dump({"triangles": triangles, "parts": meshes.parts, "clips": clips}, handle)


if __name__ == "__main__":
    main()
