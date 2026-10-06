"""The High tier of build.py: lit, detailed models inside hard budgets. Run inside Blender (imported by build.py).

A High model is the same skeleton as a Standard one (the pivots come from build.py's own layouts, so a clip moves the same joints), with
rounded parts, a finish for each color slot, details (seams, bolts, cables, lights), welded and angle-smoothed meshes, baked cavity shading
in vertex colors, and its static joints merged into the nearest joint a clip moves (fewer meshes, fewer draw calls). Every number a part
uses comes from the build fields or the tier tables of kit.json; no field of a recipe is ever used as code, a path or a property name.

Model axes: x side to side, y up, z forward (the way the model faces). Blender's are X, Z up and -Y forward, so a model (x, y, z) is the
Blender point (x, -z, y), as in build.py.
"""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector

import common

SMOOTH_ANGLE = 50.0  # degrees: edges sharper than this stay hard, so bevels and spheres are smooth and boxes keep their corners
CAVITY_LOW, CAVITY_HIGH = 0.55, 1.0

# What the tier decides about detail: segment counts for round parts and the bevel of the big flat ones. `bevel` is what budget fitting
# lowers last (2, then 1, then 0 segments).
ROUND = {"sphere": (12, 7), "head": (20, 10), "shell": (24, 14), "capsule": (10, 5), "cylinder": 12, "torus": (16, 6), "tube": 6}
BEVEL_AREA = 0.045  # m2: a box with a bigger surface than this is bevelled, a smaller one stays hard

# Colors that are not a slot of the recipe: dark glass is a fixed near-black metal, so a cab's windows read as windows whatever the palette is.
GLASS = ("#0b0f14", "metal")


def point(p):
    """A model point as a Blender point."""
    return Vector((p[0], -p[2], p[1]))


# ---- rounded parts: each takes the bmesh and returns the vertices it made, centered on the origin, in Blender's axes ----

TURNS = {"y": None, "x": Matrix.Rotation(math.radians(90), 3, "Y"), "z": Matrix.Rotation(math.radians(90), 3, "X")}  # up -> model x, up -> model z


def turned(verts, axis):
    if TURNS[axis] is not None:
        for v in verts:
            v.co = TURNS[axis] @ v.co
    return verts


def rbox(bm, size, bevel_segments, bevel=None):
    """A box (model size x, y, z) with rounded edges when it is big enough to show them."""
    sx, sy, sz = size
    made = bmesh.ops.create_cube(bm, size=1.0)
    verts = made["verts"]
    for v in verts:
        v.co = Vector((v.co.x * sx, v.co.y * sz, v.co.z * sy))
    area = 2 * (sx * sy + sy * sz + sx * sz)
    if bevel_segments > 0 and area > BEVEL_AREA:
        edges = {e for v in verts for e in v.link_edges}
        width = bevel if bevel is not None else min(sx, sy, sz) * 0.28
        result = bmesh.ops.bevel(bm, geom=list(verts) + list(edges), offset=width, segments=bevel_segments, profile=0.62, affect="EDGES")
        return list(result["verts"]) if "verts" in result and result["verts"] else list({v for e in edges if e.is_valid for v in e.verts})
    return verts


def ellipsoid(bm, radii, segments=None):
    """A smooth ellipsoid with radii in the model's x, y (up), z."""
    u, v = segments or ROUND["sphere"]
    made = bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, radius=1.0)
    verts = made["verts"]
    for p in verts:
        p.co = Vector((p.co.x * radii[0], p.co.y * radii[2], p.co.z * radii[1]))
    return verts


def capsule(bm, radius, length, axis="y"):
    """A rounded bar: total length = length + 2 * radius, along the model's `axis` (y up, x sideways or z forward)."""
    u, v = ROUND["capsule"]
    made = bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v * 2, radius=1.0)
    verts = made["verts"]
    half = length / 2.0
    for p in verts:
        z = p.co.z * radius + (half if p.co.z >= 0 else -half)
        p.co = Vector((p.co.x * radius, p.co.y * radius, z))
    return turned(verts, axis)


def cylinder(bm, radius, depth, axis="y", sides=None, bevel=0.0, top=None, rim=False):
    """A cylinder, or with `top` a cone (a radius of 0 is a point) whose wide end is `radius`, standing on its base. With `rim` only the
    round edges of its ends are bevelled, not the lines down its side."""
    made = bmesh.ops.create_cone(bm, cap_ends=True, segments=sides or ROUND["cylinder"], radius1=radius, radius2=radius if top is None else top, depth=depth)
    verts = made["verts"]
    if bevel > 0:
        edges = {e for v in verts for e in v.link_edges}
        if rim:
            edges = {e for e in edges if abs(e.verts[0].co.z - e.verts[1].co.z) < 1e-6 and e.calc_length() > 1e-6}  # not the ring that closes into a point
        result = bmesh.ops.bevel(bm, geom=list(verts) + list(edges), offset=bevel, segments=1, profile=0.6, affect="EDGES")
        # every vertex of the part: the new ones and the ones the bevel left alone (a cone's tip), or the tip would not move with the rest
        verts = list(dict.fromkeys([v for v in verts if v.is_valid] + list(result.get("verts", []))))
    return turned(verts, axis)


def fluted(bm, radius, depth, flutes, axis="y"):
    """A column with `flutes` ribs: a prism with twice as many sides whose odd sides sit nearer the middle."""
    sides = flutes * 2
    verts = bmesh.ops.create_cone(bm, cap_ends=True, segments=sides, radius1=radius, radius2=radius, depth=depth)["verts"]
    for v in verts:
        if round(math.atan2(v.co.y, v.co.x) / (2 * math.pi / sides)) % 2:
            v.co.x *= 0.78
            v.co.y *= 0.78
    return turned(verts, axis)


def lump(bm, radii, seed, flat=0.8, segments=(12, 8)):
    """A boulder: an ellipsoid whose surface is pushed in and out by a fixed pattern (the same for the same seed), cut flat at `flat` of
    its height below the middle so it can sit on the ground (the caller puts its middle at radii[1] * flat). The top pole stays where it
    is, so it is exactly as tall as its radius says."""
    u, v = segments
    verts = bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, radius=1.0)["verts"]
    for p in verts:
        ring = 1.0 - abs(p.co.z)  # 0 at the poles, 1 at the equator
        wobble = 1.0 + 0.16 * ring * math.sin(seed + 3.1 * p.co.x + 5.3 * p.co.y) * math.cos(seed * 0.7 + 4.2 * p.co.z + 2.0 * p.co.x)
        p.co = Vector((p.co.x * radii[0] * wobble, p.co.y * radii[2] * wobble, max(p.co.z * radii[1], -radii[1] * flat)))
    return verts


def torus(bm, major, minor, axis="y", scale=(1.0, 1.0), segments=None):
    """A ring. `axis` is the way its hole faces; `scale` stretches it to the model's (x, z) for a ring round an ellipse."""
    major_sides, minor_sides = segments or ROUND["torus"]
    rings = []
    for i in range(major_sides):
        a = 2 * math.pi * i / major_sides
        ring = []
        for j in range(minor_sides):
            b = 2 * math.pi * j / minor_sides
            reach = major + minor * math.cos(b)
            ring.append(bm.verts.new((reach * math.cos(a) * scale[0], reach * math.sin(a) * scale[1], minor * math.sin(b))))
        rings.append(ring)
    for i in range(major_sides):
        for j in range(minor_sides):
            n, m = (i + 1) % major_sides, (j + 1) % minor_sides
            bm.faces.new((rings[i][j], rings[n][j], rings[n][m], rings[i][m]))
    flat = [v for ring in rings for v in ring]
    bmesh.ops.recalc_face_normals(bm, faces=list({f for v in flat for f in v.link_faces}))  # a closed shape of its own
    return turned(flat, axis)


def tube(bm, points, radius):
    """A tube along model points, with a frame carried along the path so the rings never twist. Its ends are open and small."""
    sides = ROUND["tube"]
    pts = [point(p) for p in points]
    rings = []
    previous = None
    for i, p in enumerate(pts):
        if i == 0:
            d = pts[1] - p
        elif i == len(pts) - 1:
            d = p - pts[i - 1]
        else:
            d = pts[i + 1] - pts[i - 1]
        d.normalize()
        if previous is None:
            up = Vector((0, 0, 1)) if abs(d.z) < 0.95 else Vector((1, 0, 0))
            a = d.cross(up).normalized()
        else:
            a = (previous - d * previous.dot(d)).normalized()
        previous = a
        b = d.cross(a).normalized()
        ring = [bm.verts.new(p + (a * math.cos(2 * math.pi * k / sides) + b * math.sin(2 * math.pi * k / sides)) * radius) for k in range(sides)]
        rings.append(ring)
    for i in range(len(rings) - 1):
        for k in range(sides):
            bm.faces.new((rings[i][k], rings[i][(k + 1) % sides], rings[i + 1][(k + 1) % sides], rings[i + 1][k]))
    flat = [v for ring in rings for v in ring]
    bmesh.ops.recalc_face_normals(bm, faces=list({f for v in flat for f in v.link_faces}))
    return flat


def bezier(p0, p1, p2, p3, n=6):
    out = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        out.append(tuple(u**3 * a + 3 * u * u * t * b + 3 * u * t * t * c + t**3 * d for a, b, c, d in zip(p0, p1, p2, p3)))
    return out


# ---- the builder: parts are added to the mesh of the joint group they belong to, and finished once, together ----


class Group:
    def __init__(self):
        self.bm = bmesh.new()
        self.materials = []


class HighBuilder:
    def __init__(self, palette, colors, finishes, finish_values, group_of, bevel_segments):
        self.palette, self.colors, self.finishes, self.finish_values = palette, colors, finishes, finish_values
        self.group_of = group_of  # joint -> the joint whose mesh holds its parts
        self.bevel = bevel_segments
        self.groups = {}
        self.library = {}
        self.parts = 0

    def material(self, slot):
        """The material of a color slot, with the finish chosen for that slot. Three more names are not slots of the recipe: "glow" is the
        `extra` color, always glowing; "bodyglow" is the `body` color, always glowing (a crystal); "glass" is a fixed dark metal."""
        if slot == "glow":
            color, finish = self.palette[self.colors["extra"]].lower(), "glow"
        elif slot == "bodyglow":
            color, finish = self.palette[self.colors["body"]].lower(), "glow"
        elif slot == "glass":
            color, finish = GLASS
        else:
            color, finish = self.palette[self.colors[slot]].lower(), self.finishes[slot]
        key = (color, finish)
        if key not in self.library:
            self.library[key] = common.finish_material(f"{finish}_{len(self.library)}", common.hex_to_linear(color), self.finish_values[finish])
        return self.library[key]

    def add(self, joint, slot, make, center, rotate=None):
        """One part: `make(bm)` builds it in Blender axes around the origin; it is moved to `center` (a model point)."""
        group = self.groups.setdefault(self.group_of[joint], Group())
        material = self.material(slot)
        if material not in group.materials:
            group.materials.append(material)
        index = group.materials.index(material)
        made = make(group.bm)
        offset = point(center)
        faces = set()
        for v in made:
            if rotate is not None:
                v.co = rotate @ v.co
            v.co = v.co + offset
            faces.update(v.link_faces)
        for face in faces:
            face.material_index = index
        self.parts += 1

    # -- the shapes, as parts
    def box(self, joint, slot, size, center, bevel=None):
        self.add(joint, slot, lambda bm: rbox(bm, size, self.bevel, bevel), center)

    def ball(self, joint, slot, radii, center, head=False, segments=None):
        self.add(joint, slot, lambda bm: ellipsoid(bm, radii if hasattr(radii, "__len__") else (radii, radii, radii), ROUND["head"] if head else segments), center)

    def bar(self, joint, slot, radius, length, center, axis="y"):
        self.add(joint, slot, lambda bm: capsule(bm, radius, length, axis), center)

    def disc(self, joint, slot, radius, depth, center, axis="y", sides=None, bevel=0.0, top=None, rim=False):
        self.add(joint, slot, lambda bm: cylinder(bm, radius, depth, axis, sides, bevel, top, rim), center)

    def ring(self, joint, slot, major, minor, center, axis="y", scale=(1.0, 1.0), segments=None):
        self.add(joint, slot, lambda bm: torus(bm, major, minor, axis, scale, segments), center)

    def column(self, joint, slot, radius, depth, flutes, center):
        self.add(joint, slot, lambda bm: fluted(bm, radius, depth, flutes), center)

    def boulder(self, joint, slot, radii, seed, center, flat=0.8):
        self.add(joint, slot, lambda bm: lump(bm, radii, seed, flat), center)

    def tilted(self, joint, slot, size, center, angle):
        """A thin plate turned `angle` radians about the model's z (a blade, a spoke); `size` is its (x, y, z) before it is turned."""
        self.add(joint, slot, lambda bm: rbox(bm, size, self.bevel, min(size) * 0.25), center, rotate=Matrix.Rotation(angle, 3, Vector((0, -1, 0))))

    def cable(self, joint, slot, points, radius):
        self.add(joint, slot, lambda bm: tube(bm, points, radius), (0, 0, 0))


def finish(builder, objects, zrange, strata=None):
    """Every group becomes one mesh: welded, smoothed by angle, shaded for cavity, triangulated, and parented to its joint without moving.
    `strata` is (band height, [multipliers]): bands of lighter and darker color up the model, for rock."""
    low, high = zrange
    meshes = 0
    for joint, group in builder.groups.items():
        bm = group.bm
        bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
        bm.verts.ensure_lookup_table()
        bm.normal_update()
        cavity_shading(bm, low, high, strata)
        for edge in bm.edges:
            if len(edge.link_faces) == 2:
                edge.smooth = edge.calc_face_angle(0.0) < math.radians(SMOOTH_ANGLE)
        for face in bm.faces:
            face.smooth = True
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
        mesh = bpy.data.meshes.new(f"{joint}_mesh")
        bm.to_mesh(mesh)
        bm.free()
        for material in group.materials:
            mesh.materials.append(material)
        obj = bpy.data.objects.new(f"{joint}_mesh", mesh)
        bpy.context.scene.collection.objects.link(obj)
        obj.parent = objects[joint]
        obj.matrix_parent_inverse = objects[joint].matrix_world.inverted()
        meshes += 1
    return meshes


def cavity_shading(bm, low, high, strata=None):
    """The per-vertex multiplier `Col` (0.55 to 1.0): darker where the surface is concave and where it sits low. Deterministic, no ray casts.
    With `strata` (band height, [multipliers]) the bands of the stone's layers are laid over it."""
    layer = bm.verts.layers.float_color.get("Col") or bm.verts.layers.float_color.new("Col")
    span = max(high - low, 1e-6)
    for v in bm.verts:
        others = [e.other_vert(v) for e in v.link_edges]
        concave = 0.0
        if others:
            centroid = sum((o.co for o in others), Vector()) / len(others)
            length = sum((o.co - v.co).length for o in others) / len(others)
            if length > 1e-6:
                concave = max(0.0, min(1.0, (centroid - v.co).dot(v.normal) / length * 3.0))
        lowness = 1.0 - max(0.0, min(1.0, (v.co.z - low) / span))
        k = 1.0 - 0.45 * concave - 0.25 * lowness
        if strata is not None:
            height, bands = strata
            k *= bands[int(max(v.co.z, 0.0) / height) % len(bands)]
        k = max(CAVITY_LOW, min(CAVITY_HIGH, k))
        v[layer] = (k, k, k, 1.0)


def add_extra(b, extra, anchors, sizes, trim="feet"):
    """One extra, with the same parts (and so the same cost) whatever kind it is on. `anchors` are model points ("back", "top" and "pack"),
    `sizes` the units the parts are drawn from: "tail" a thickness, "head" a head's size, "body" a (width, height, depth) for a backpack. `trim` is
    the slot of the dark metal parts (a biped's "feet"; a kind without that slot names its own)."""
    t, h = sizes["tail"], sizes["head"]
    w, bh, d = sizes["body"]
    if extra == "tail":
        x, y, z = anchors["back"]
        b.bar("tail_1", "extra", t * 0.4, t * 1.0, (x, y, z - t * 0.9), axis="z")
        b.bar("tail_2", "extra", t * 0.3, t * 1.0, (x, y, z - t * 2.5), axis="z")
    elif extra == "ears":
        x, y, z = anchors["top"]
        for side, name in ((1, "l"), (-1, "r")):
            b.bar(f"ear_{name}", "extra", h * 0.09, h * 0.15, (x + side * h * 0.3, y + h * 0.15, z))
    elif extra == "antenna":
        x, y, z = anchors["top"]
        b.bar("antenna", trim, h * 0.025, h * 0.3, (x, y + h * 0.18, z))
        b.ball("antenna", "glow", h * 0.06, (x, y + h * 0.4, z))
        b.ring("antenna", "extra", h * 0.05, h * 0.012, (x, y + h * 0.33, z))
    elif extra == "hat":
        x, y, z = anchors["top"]
        b.disc("hat", "extra", h * 0.55, h * 0.18, (x, y + h * 0.04, z), bevel=h * 0.02)
    elif extra == "backpack":
        x, y, z = anchors["pack"]
        b.box("backpack", "feet", (w * 0.75, bh * 0.7, d * 0.25), (x, y - bh * 0.03, z - d * 0.15))
        b.box("backpack", "extra", (w * 0.7, bh * 0.6, d * 0.4), (x, y, z - d * 0.4))
        for sx in (-1, 1):
            b.box("backpack", "arms", (w * 0.08, bh * 0.64, d * 0.43), (x + sx * w * 0.15, y, z - d * 0.4))


# ---- the courier biped, driven by the build fields ----


def biped_high(b, build, extras, details, pivots=None):
    """The High biped: a rounded head with a dark lens, two glow eyes and a smile, ear cups, a chest panel with a glow core, a belt, shoulder
    balls and cuffs, thigh and shin guards, shoes with soles and joint balls. The pivots are the Standard biped's (build.py's own layout)."""
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
    cy = head_y + head / 2
    head_top = head_y + head
    panel_y = belly + height * 0.58
    front = depth / 2

    # pelvis, belt, hips
    b.box("hips", "body", (width, pelvis, depth), (0, leg + pelvis / 2, 0))
    b.box("hips", "extra", (width * 1.05, pelvis * 0.3, depth * 1.07), (0, leg + pelvis * 0.82, 0))
    b.box("hips", "feet", (width * 0.16, pelvis * 0.28, depth * 0.1), (0, leg + pelvis * 0.82, front * 1.1))
    for side in (1, -1):
        b.ball("hips", "feet", leg_t * 0.62, (side * width / 4, leg, 0))

    # chest
    b.box("chest", "body", (width, height, depth), (0, belly + height / 2, 0))
    b.box("chest", "extra", (width * 0.5, height * 0.42, depth * 0.07), (0, panel_y, front * 1.03))
    b.disc("chest", "glow", width * 0.07, depth * 0.05, (0, panel_y, front * 1.12), axis="z")
    b.ring("chest", "feet", width * 0.085, width * 0.012, (0, panel_y, front * 1.1), axis="z")
    b.ring("chest", "feet", head * 0.21, head * 0.045, (0, top, 0))
    for side in (1, -1):
        ax = side * (width / 2 + arm_t / 2)
        b.ball("chest", "feet", arm_t * 0.95, (ax, shoulder_y, 0))
        b.ball("chest", "extra", (arm_t * 1.1, arm_t * 0.75, arm_t * 1.0), (ax, shoulder_y + arm_t * 0.55, 0))

    # neck and head
    b.disc("neck", "feet", head * 0.2, head * 0.3, (0, top + head * 0.075, 0))
    b.ball("head", "head", (head * 0.55, head * 0.5, head * 0.52), (0, cy, 0), head=True)
    b.ball("head", "feet", (head * 0.42, head * 0.3, head * 0.2), (0, cy - head * 0.02, head * 0.4), head=True)
    for side in (1, -1):
        b.ball("head", "glow", (head * 0.085, head * 0.115, head * 0.03), (side * head * 0.17, cy + head * 0.02, head * 0.585))
        b.disc("head", "feet", head * 0.15, head * 0.14, (side * head * 0.55, cy, 0), axis="x")
        b.ring("head", "extra", head * 0.12, head * 0.022, (side * head * 0.61, cy, 0), axis="x")
    smile = [(x, cy - head * 0.13 + head * 0.06 * (x / (head * 0.12)) ** 2, head * 0.585) for x in [(-0.12 + 0.24 * i / 8) * head for i in range(9)]]
    b.cable("head", "glow", smile, head * 0.012)

    # arms and hands
    for side in (1, -1):
        ax = side * (width / 2 + arm_t / 2)
        name = "l" if side == 1 else "r"
        b.bar(f"upperarm_{name}", "arms", arm_t * 0.5, max(upper - arm_t, 0.01), (ax, shoulder_y - upper / 2, 0))
        b.ball(f"upperarm_{name}", "feet", arm_t * 0.5, (ax, shoulder_y - upper, 0))
        b.bar(f"forearm_{name}", "arms", arm_t * 0.47, max(fore - arm_t * 0.94, 0.01), (ax, shoulder_y - upper - fore / 2, 0))
        b.disc(f"forearm_{name}", "extra", arm_t * 0.55, fore * 0.18, (ax, shoulder_y - upper - fore * 0.9, 0))
        b.ball(f"hand_{name}", "feet", (arm_t * 0.7, hand * 0.55, arm_t * 0.65), (ax, shoulder_y - upper - fore - hand * 0.45, 0))

    # legs and feet
    for side in (1, -1):
        lx = side * width / 4
        name = "l" if side == 1 else "r"
        b.bar(f"thigh_{name}", "legs", leg_t * 0.5, max(thigh - leg_t, 0.01), (lx, leg - thigh / 2, 0))
        b.ball(f"thigh_{name}", "feet", leg_t * 0.52, (lx, foot_h + shin, 0))
        b.box(f"thigh_{name}", "extra", (leg_t * 0.7, leg_t * 0.55, leg_t * 0.4), (lx, foot_h + shin + leg_t * 0.2, leg_t * 0.55))
        b.bar(f"shin_{name}", "legs", leg_t * 0.45, max(shin - leg_t * 0.9, 0.01), (lx, foot_h + shin / 2, 0))
        b.box(f"shin_{name}", "extra", (leg_t * 0.62, shin * 0.7, leg_t * 0.3), (lx, foot_h + shin * 0.5, leg_t * 0.5))
        b.ball(f"shin_{name}", "feet", leg_t * 0.42, (lx, foot_h, 0))
        b.box(f"foot_{name}", "body", (leg_t * 1.3, foot_h * 1.1, foot), (lx, foot_h * 0.62, foot / 2 - leg_t / 2))
        b.box(f"foot_{name}", "feet", (leg_t * 1.4, foot_h * 0.35, foot * 1.05), (lx, foot_h * 0.175, foot / 2 - leg_t / 2))
        b.ball(f"foot_{name}", "extra", (leg_t * 0.55, foot_h * 0.45, foot * 0.2), (lx, foot_h * 0.7, foot - leg_t / 2 + foot * 0.02))

    # extras: the same parts on every kind that can carry them, sized from a unit and placed at anchors the kind names
    anchors = {"back": (0, leg + pelvis * 0.5, -depth / 2), "top": (0, head_top, 0), "pack": (0, belly + height * 0.58, -front)}
    for extra in extras:
        add_extra(b, extra, anchors, {"tail": leg_t, "head": head, "body": (width, height, depth)})

    # details, in the order the tier drops them last to first: lights, seams, bolts, cables
    if "lights" in details:
        for x in (-0.12, 0.0, 0.12):
            b.box("chest", "glow", (width * 0.07, height * 0.025, depth * 0.03), (x * width, panel_y - height * 0.27, front * 1.03))
        for x in (-0.18, 0.0, 0.18):
            b.box("hips", "glow", (width * 0.08, pelvis * 0.1, depth * 0.03), (x * width, leg + pelvis * 0.35, -front * 1.01))
    if "seams" in details:
        b.box("chest", "feet", (width * 1.01, height * 0.015, depth * 1.01), (0, belly + height * 0.2, 0), bevel=0.0)
        b.box("chest", "feet", (width * 1.01, height * 0.015, depth * 1.01), (0, belly + height * 0.84, 0), bevel=0.0)
        b.box("hips", "feet", (width * 1.01, pelvis * 0.04, depth * 1.01), (0, leg + pelvis * 0.4, 0), bevel=0.0)
        b.ring("head", "feet", head * 0.5, head * 0.012, (0, cy + head * 0.18, 0), scale=(1.07, 1.0))
    if "bolts" in details:
        for sx in (-1, 1):
            for sy in (-1, 1):
                b.disc("chest", "feet", width * 0.02, depth * 0.03, (sx * width * 0.22, panel_y + sy * height * 0.17, front * 1.07), axis="z", sides=8)
        for side, name in ((1, "l"), (-1, "r")):
            ax = side * (width / 2 + arm_t / 2)
            for sz in (-1, 1):
                b.disc("chest", "feet", arm_t * 0.12, arm_t * 0.15, (ax, shoulder_y + arm_t * 0.9, sz * arm_t * 0.4), axis="y", sides=8)
            lx = side * width / 4
            for sy in (0.28, 0.72):
                b.disc(f"shin_{name}", "feet", leg_t * 0.08, leg_t * 0.1, (lx, foot_h + shin * sy, leg_t * 0.68), axis="z", sides=8)
        for sx in (-1, 1):
            b.disc("hips", "feet", pelvis * 0.1, depth * 0.03, (sx * width * 0.09, leg + pelvis * 0.82, front * 1.17), axis="z", sides=8)
    if "cables" in details:
        for side in (1, -1):
            b.cable("chest", "feet", bezier((side * width * 0.2, belly + height * 0.78, -front), (side * width * 0.34, belly + height * 0.9, -front * 1.2), (side * width * 0.46, top + head * 0.05, -front * 0.5), (side * width * 0.3, top + head * 0.05, 0)), arm_t * 0.07)
            b.cable("hips", "feet", bezier((side * width * 0.14, leg + pelvis * 0.8, front), (side * width * 0.34, leg + pelvis * 0.9, front * 1.25), (side * width * 0.4, leg + pelvis * 0.5, front * 1.1), (side * width * 0.32, leg + pelvis * 0.05, front * 0.5)), leg_t * 0.05)


# ---- the vehicle: a bevelled body, a cab with a dark glass band, wheels with hubs, bumpers; lamps, seams, bolts and pipes as details ----


def vehicle_high(b, build, extras, details, pivots):
    length, width, height = build["bodyLength"], build["bodyWidth"], build["bodyHeight"]
    cab, count, radius = build["cabSize"], int(build["wheelCount"]), build["wheelRadius"]
    wheel_w = radius * 0.7
    top = radius + height
    mid = radius + height / 2
    front, back = length / 2, -length / 2
    bumper_y = radius + height * 0.22
    bumper_z = (front + length * 0.01, back - length * 0.01)

    b.box("body", "body", (width, height, length), (0, mid, 0))
    for z in bumper_z:
        b.box("body", "extra", (width * 1.02, height * 0.26, length * 0.07), (0, bumper_y, z))
    b.box("body", "wheels", (width * 0.8, height * 0.18, length * 0.7), (0, radius + height * 0.05, 0))  # the dark underside between the wheels
    if cab > 0:
        b.box("body", "cab", (width * 0.8, cab, length * 0.45), (0, top + cab / 2, -length / 4))
        b.box("body", "glass", (width * 0.8 * 1.02, cab * 0.42, length * 0.45 * 1.02), (0, top + cab * 0.58, -length / 4), bevel=0.0)
    for k in range(1, count + 1):
        joint = f"wheel_{k}"
        x, _, z = pivots[joint]
        b.disc(joint, "wheels", radius, wheel_w, (x, radius, z), axis="x", sides=16, bevel=radius * 0.1, rim=True)
        b.disc(joint, "extra", radius * 0.55, wheel_w * 1.1, (x, radius, z), axis="x", sides=10)

    anchors = {"back": (0, mid, back), "top": (width * 0.3, top + cab, -length * 0.4), "pack": (0, mid, back)}
    for extra in extras:
        add_extra(b, extra, anchors, {"tail": width * 0.1, "head": width * 0.8, "body": (width, height, length)}, trim="wheels")

    if "lights" in details:
        for sx in (-1, 1):
            b.ball("body", "glow", (width * 0.11, height * 0.15, length * 0.02), (sx * width * 0.3, radius + height * 0.62, front + length * 0.005))
            b.box("body", "glow", (width * 0.2, height * 0.22, length * 0.03), (sx * width * 0.3, radius + height * 0.62, back - length * 0.015), bevel=0.0)
    if "seams" in details:
        b.box("body", "wheels", (width * 1.006, height * 0.014, length * 0.7), (0, mid, 0), bevel=0.0)  # the belt line along each side, short of the rounded corners
        b.box("body", "wheels", (width * 1.006, height * 0.42, length * 0.01), (0, mid, -length * 0.02), bevel=0.0)  # a door line on each side
        b.box("body", "wheels", (width * 0.014, height * 0.206, length * 0.3), (0, top - height * 0.097, length * 0.28), bevel=0.0)  # the hood's middle line
    if "bolts" in details:
        for z, face in zip(bumper_z, (1, -1)):
            for sx in (-1, 1):
                for x in (0.15, 0.36):
                    b.disc("body", "wheels", width * 0.022, width * 0.03, (sx * width * x, bumper_y, z + face * length * 0.035), axis="z", sides=8)
    if "cables" in details:
        for sx in (-1, 1):
            x = sx * width * 0.27
            b.cable("body", "wheels", bezier((x, radius + height * 0.3, back + length * 0.1), (x, radius + height * 0.1, back - length * 0.02), (x, radius + height * 0.03, back - length * 0.07), (x, radius + height * 0.03, back - length * 0.13)), width * 0.03)


# ---- the blob: a glossy shell with a rim, glow eyes with rings round them ----


def blob_high(b, build, extras, details, pivots):
    r, squash, eye = build["radius"], build["squash"], build["eyeSize"]
    half = r * squash
    cy, top = half, 2 * half
    ex, ey, ez = pivots["eye_l"]

    b.ball("body", "body", (r, half, r), (0, cy, 0), segments=ROUND["shell"])
    b.ring("body", "extra", r * 0.866, r * 0.045, (0, cy - half * 0.5, 0))  # a band round the shell, on its surface at that height
    for side, name in ((1, "l"), (-1, "r")):
        b.ball(f"eye_{name}", "eyes", (eye * 0.8, eye, eye * 0.5), (side * ex, ey, ez))
        b.ring(f"eye_{name}", "extra", eye * 0.95, eye * 0.13, (side * ex, ey, ez), axis="z")

    anchors = {"back": (0, cy, -r * 0.95), "top": (0, top - r * 0.03, 0), "pack": (0, cy, -r)}
    for extra in extras:
        add_extra(b, extra, anchors, {"tail": r * 0.25, "head": r, "body": (r, r, r)}, trim="body")

    if "lights" in details:
        for sx in (-1, 1):
            b.ball("body", "glow", (r * 0.07, r * 0.05, r * 0.03), (sx * r * 0.62, cy - half * 0.15, r * 0.77))  # cheek lamps on the shell
    if "seams" in details:
        b.ring("body", "extra", r, r * 0.012, (0, cy, 0))  # the equator
        b.ring("body", "extra", 1.0, 0.012, (0, cy, 0), axis="x", scale=(half, r))  # down the middle, over the top


# ---- the prop: its shape, rounded; seams and bolts follow the shape's own front ----


def prop_front(shape, s, x, y):
    """The z of the front surface of a prop shape at (x, y) (y up from the ground), a little less than the real one where it is not flat."""
    r = s / 2
    dy = y - r
    if shape == "cube":
        return r
    if shape == "crate":
        return r + (0.03 * s if abs(y - 0.2 * s) < 0.07 * s or abs(y - 0.8 * s) < 0.07 * s else 0.0)
    if shape == "sphere":
        return math.sqrt(max(r * r - x * x - dy * dy, 0.0))
    if shape == "cylinder":
        return math.sqrt(max(r * r - x * x, 0.0))
    if shape == "cone":
        return math.sqrt(max((r * (1 - y / s)) ** 2 - x * x, 0.0))
    if shape == "pyramid":
        return max(r * (1 - y / s) - abs(x), 0.0)
    if shape == "coin":
        return 0.075 * s
    if shape == "ring":
        d = math.hypot(x, dy) - 0.35 * s
        return math.sqrt(max((0.15 * s) ** 2 - d * d, 0.0))
    gem_r = 0.35 * s * (y / (0.6 * s) if y < 0.6 * s else 1.0 if y < 0.65 * s else 1.0 - 0.45 * (y - 0.65 * s) / (0.35 * s))
    return math.sqrt(max((0.96 * gem_r) ** 2 - x * x, 0.0))


# shape: (height of the middle of the pattern, the circle of eight bolts, the three circles of seam), all as fractions of the size
PROP_PATTERN = {
    "cube": (0.5, 0.34, (0.12, 0.2, 0.27)),
    "crate": (0.5, 0.34, (0.12, 0.2, 0.27)),
    "sphere": (0.5, 0.30, (0.10, 0.18, 0.25)),
    "cylinder": (0.5, 0.34, (0.12, 0.2, 0.28)),
    "cone": (0.36, 0.13, (0.05, 0.08, 0.105)),
    "pyramid": (0.36, 0.13, (0.05, 0.08, 0.105)),
    "coin": (0.5, 0.30, (0.10, 0.18, 0.24)),
    "ring": (0.5, 0.35, (0.25, 0.28, 0.42)),
    "gem": (0.4, 0.13, (0.05, 0.08, 0.105)),
}


def prop_high(b, build, extras, details, pivots):
    s, shape = build["size"], build["shape"]
    mid = (0, s / 2, 0)
    if shape == "cube":
        b.box("root", "body", (s, s, s), mid, bevel=s * 0.1)
    elif shape == "sphere":
        b.ball("root", "body", (s / 2, s / 2, s / 2), mid, segments=(20, 12))
    elif shape == "cone":
        b.disc("root", "body", s / 2, s, mid, sides=24, top=0.0, bevel=s * 0.03, rim=True)
    elif shape == "cylinder":
        b.disc("root", "body", s / 2, s, mid, sides=20, bevel=s * 0.04, rim=True)
    elif shape == "pyramid":
        b.disc("root", "body", s / 2, s, mid, sides=4, top=0.0, bevel=s * 0.03, rim=True)
    elif shape == "coin":
        b.disc("root", "body", s / 2, s * 0.15, mid, axis="z", sides=24, bevel=s * 0.02, rim=True)
        b.ring("root", "extra", s * 0.44, s * 0.035, (0, s / 2, s * 0.075), axis="z", segments=(24, 6))
    elif shape == "ring":
        b.ring("root", "body", s * 0.35, s * 0.15, mid, axis="z", segments=(24, 10))
    elif shape == "gem":
        reach = s * 0.35
        b.disc("root", "bodyglow", 0.0, s * 0.6, (0, s * 0.3, 0), sides=8, top=reach)  # the point below
        b.disc("root", "extra", reach * 1.04, s * 0.06, (0, s * 0.62, 0), sides=8)  # the setting round the widest part
        b.disc("root", "bodyglow", reach, s * 0.35, (0, s * 0.825, 0), sides=8, top=reach * 0.55)  # the crown, cut flat on top
    else:  # crate
        b.box("root", "body", (s, s, s), mid, bevel=s * 0.06)
        for y in (0.2, 0.8):
            b.box("root", "extra", (s * 1.06, s * 0.14, s * 1.06), (0, s * y, 0), bevel=s * 0.03)

    middle, bolt_circle, seam_circles = PROP_PATTERN[shape]
    cy = s * middle

    def on_front(circle, angle):
        x, y = s * circle * math.cos(angle), cy + s * circle * math.sin(angle)
        return (x, y, prop_front(shape, s, x, y))

    if "seams" in details:
        for circle in seam_circles:
            b.cable("root", "extra", [on_front(circle, 2 * math.pi * i / 12) for i in range(13)], s * 0.012)
    if "bolts" in details:
        for i in range(8):
            b.disc("root", "extra", s * 0.02, s * 0.03, on_front(bolt_circle, 2 * math.pi * i / 8 + math.pi / 8), axis="z", sides=8)


# ---- scenery: each piece with the same joints and heights as the Standard one ----


def tree_high(b):
    b.disc("root", "detail", 0.22, 1.5, (0, 0.75, 0), sides=10, top=0.15)
    for center, radii in (((0, 1.95, 0), (1.05, 0.65, 1.05)), ((0.05, 2.55, 0.02), (0.8, 0.55, 0.8)), ((0, 3.05, 0), (0.5, 0.45, 0.5))):
        b.ball("canopy", "main", radii, center, segments=(16, 9))  # three layers of leaves, the widest at the bottom


def pine_high(b):
    b.disc("root", "detail", 0.17, 1.0, (0, 0.5, 0), sides=12, top=0.12)
    for base, radius, depth in ((0.7, 1.3, 1.2), (1.4, 1.1, 1.1), (2.1, 0.9, 1.0), (2.8, 0.7, 0.95), (3.5, 0.5, 1.0)):
        b.disc("canopy", "main", radius, depth, (0, base + depth / 2, 0), sides=14, top=0.0)


def rock_high(b):
    b.boulder("root", "main", (0.82, 0.66, 0.78), 1.3, (0, 0.66 * 0.8, 0))
    b.boulder("root", "detail", (0.45, 0.37, 0.42), 4.1, (0.85, 0.37 * 0.8, 0.3))


def cactus_high(b):
    b.column("root", "main", 0.3, 2.0, 8, (0, 1.0, 0))
    b.bar("root", "main", 0.11, 0.4, (0.45, 1.0, 0), axis="x")
    b.bar("root", "main", 0.11, 0.5, (0.66, 1.35, 0))
    b.bar("root", "main", 0.11, 0.4, (-0.45, 1.4, 0), axis="x")
    b.bar("root", "main", 0.11, 0.5, (-0.66, 1.78, 0))
    b.ball("root", "detail", (0.14, 0.13, 0.14), (0, 2.07, 0))  # blossoms
    b.ball("root", "detail", (0.1, 0.09, 0.1), (-0.66, 2.12, 0))


def windmill_high(b):
    hub = (0, 4.0, -0.75)
    b.disc("root", "main", 0.9, 4.6, (0, 2.3, 0), sides=12, top=0.55)
    b.ring("root", "main", 0.66, 0.06, (0, 3.2, 0))
    b.disc("root", "detail", 0.75, 1.4, (0, 5.3, 0), sides=12, top=0.0)
    b.box("root", "detail", (0.4, 0.8, 0.12), (0, 0.4, -0.9))  # the door, on the side the player sees
    b.ball("blades", "detail", (0.17, 0.17, 0.25), (hub[0], hub[1], hub[2] + 0.05))
    for k in range(3):
        angle = math.radians(120 * k)
        b.tilted("blades", "detail", (0.3, 1.6, 0.06), (hub[0] - math.sin(angle), hub[1] + math.cos(angle), hub[2]), angle)  # the blades turn about z


def lamp_high(b):
    b.disc("root", "main", 0.28, 0.2, (0, 0.1, 0), sides=12, top=0.18)
    b.disc("root", "main", 0.06, 2.6, (0, 1.5, 0), sides=8)
    b.ring("root", "main", 0.1, 0.035, (0, 2.62, 0))
    b.ball("root", "detail", (0.24, 0.27, 0.24), (0, 2.83, 0), segments=(14, 9))
    b.disc("root", "main", 0.32, 0.15, (0, 3.125, 0), sides=12, top=0.06)


SCENERY_HIGH = {"tree": tree_high, "pine": pine_high, "rock": rock_high, "cactus": cactus_high, "windmill": windmill_high, "lamp": lamp_high}
# bands of stone: (band height in meters, color multipliers from the bottom up)
STRATA = {"rock": (0.2, [1.0, 0.86, 0.95, 0.8, 0.92, 0.84])}


def scenery_high(b, build, extras, details, pivots):
    SCENERY_HIGH[build["scenery"]](b)


HIGH_LAYOUTS = {"biped": biped_high, "vehicle": vehicle_high, "blob": blob_high, "prop": prop_high, "scenery": scenery_high}
