"""The High world of build.py: a terrain tile, a road and a backdrop, in a desert or a meadow style. Run inside Blender (imported by build.py).

Model axes, as everywhere: x side to side, y up, z along the track (the way the player runs). Each piece is one mesh under a joint called
"root", with a slot of the palette for each of its materials and baked shading in the vertex color "Col" (the shader multiplies it in).

- terrain: a tile 160 m wide (x from -80 to 80) and 100 m long (z from 0 to 100) on a 2 m grid, one shared vertex per grid point. Its heights
  repeat every 100 m, and so do its normals (they come from the height function, not from the mesh), so tiles laid end to end have no seam.
  It is flat within 9 m of the road (x from -9 to 9), then rises into dunes or hills.
- road: 8 m wide along the same 100 m, with a raised edge line on each side and a dashed middle line (both quads above the surface) and a closed
  curb along each side. Its marks repeat every 5 m, so it tiles too.
- backdrop: two rings of mesas (desert) or rounded hills (meadow) 112 m and 128 m from the middle, built only on the side that looks at the
  middle (the half nobody can see is not made).

Nothing here uses a field of a recipe as code or a path: a piece and a style are looked up in tables, and every number is a constant.
"""
import math

import bmesh
import bpy
from mathutils import Vector

import common
import high

TILE = 100.0  # meters the terrain and the road repeat over
HALF_WIDTH = 80.0  # the terrain reaches this far to each side
GRID = 2.0
FLAT = 9.0  # the terrain is flat out to this far from the middle of the road
ROAD_HALF = 4.0
SUN = Vector((-0.45, 0.8, 0.4)).normalized()  # the light the terrain's slope shading is baked against, in model axes
MIN_SHADE, MAX_SHADE = 0.55, 1.0
RINGS = ((112.0, 17, 0.0), (128.0, 17, 0.5))  # (distance from the middle, how many, phase in steps)
SLOTS = {"terrain": ("ground",), "road": ("accent", "far", "ground"), "backdrop": ("far",)}  # the palette slot of each material, in order


def clamp(value, low, high_):
    return max(low, min(high_, value))


def smoothstep(low, high_, x):
    t = clamp((x - low) / (high_ - low), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def unit(index, salt):
    """A repeatable number from 0 to 1 for a thing and a purpose (it is a hash, not randomness: the same recipe gives the same world)."""
    return 0.5 + 0.5 * math.sin(index * 12.9898 + salt * 78.233)


def shade(value):
    return clamp(value, MIN_SHADE, MAX_SHADE)


# ---- terrain ----


def terrain_height(style, x, z):
    """The height of the land at (x, z): 0 within FLAT of the road, rising beyond. Whole numbers of cycles over TILE in z, so it repeats."""
    t = 2.0 * math.pi * z / TILE
    rise = smoothstep(FLAT, FLAT + 25.0, abs(x))
    far = smoothstep(30.0, HALF_WIDTH, abs(x))
    if style == "desert":
        crest = 0.5 + 0.5 * math.sin(0.21 * x + 1.6 * math.sin(2.0 * t + 0.6) + 0.9 * math.sin(3.0 * t + 1.9))
        ridge = 1.0 - abs(2.0 * crest - 1.0)  # sharp crests, wide troughs
        return rise * (1.4 + 5.5 * far) * (0.35 + 0.65 * ridge)
    swell = 0.5 + 0.3 * math.sin(0.065 * x + 0.9 * math.sin(t + 0.4)) + 0.2 * math.sin(0.13 * x - 1.1 * math.sin(2.0 * t) + 1.0)
    return rise * (1.2 + 4.0 * far) * swell


def terrain_normal(style, x, z):
    e = 0.05
    hx = (terrain_height(style, x + e, z) - terrain_height(style, x - e, z)) / (2 * e)
    hz = (terrain_height(style, x, z + e) - terrain_height(style, x, z - e)) / (2 * e)
    return Vector((-hx, 1.0, -hz)).normalized()


def build_terrain(style):
    """(bmesh, per-vertex normals, the palette slots of its materials)."""
    cols, rows = int(2 * HALF_WIDTH / GRID), int(TILE / GRID)
    bm = bmesh.new()
    layer = bm.verts.layers.float_color.new("Col")
    grid, normals = [], []
    for j in range(rows + 1):
        z = j * GRID
        line = []
        for i in range(cols + 1):
            x = -HALF_WIDTH + i * GRID
            vert = bm.verts.new(high.point((x, terrain_height(style, x, z), z)))
            n = terrain_normal(style, x, z)
            normals.append(high.point((n.x, n.y, n.z)))
            lit = clamp(n.dot(SUN), 0.0, 1.0)
            gravel = 1.0 - smoothstep(FLAT, FLAT + 6.0, abs(x))  # coarse stones near the road
            speck = 0.5 + 0.5 * math.sin(12.9898 * x + 2.0 * math.pi * 37.0 * z / TILE)
            k = shade((0.55 + 0.45 * lit) * (1.0 - gravel * (0.12 + 0.2 * speck)))
            vert[layer] = (k, k, k, 1.0)
            line.append(vert)
        grid.append(line)
    for j in range(rows):
        for i in range(cols):
            face = bm.faces.new((grid[j][i], grid[j + 1][i], grid[j + 1][i + 1], grid[j][i + 1]))
            face.material_index = 0
            face.normal_update()
            if face.normal.z < 0:
                face.normal_flip()
    return bm, normals


# ---- road ----


def quad(bm, corners, material, layer, shades, up=True):
    """One flat quad of model points; it faces up (or the way `up` says) whichever way its corners were given."""
    verts = []
    for p, k in zip(corners, shades):
        v = bm.verts.new(high.point(p))
        v[layer] = (k, k, k, 1.0)
        verts.append(v)
    face = bm.faces.new(verts)
    face.material_index = material
    face.normal_update()
    if face.normal.z < 0:
        face.normal_flip()
    return face


def box(bm, center, size, material, layer, shades):
    """A closed box (so its faces point outward by construction); `shades` is (bottom, top)."""
    made = bmesh.ops.create_cube(bm, size=1.0)
    for v in made["verts"]:
        v.co = Vector((v.co.x * size[0], v.co.y * size[2], v.co.z * size[1])) + high.point(center)
        v[layer] = ((shades[1],) * 3 + (1.0,)) if v.co.z > high.point(center).z else ((shades[0],) * 3 + (1.0,))
    for face in {f for v in made["verts"] for f in v.link_faces}:
        face.material_index = material


def build_road(style):
    bm = bmesh.new()
    layer = bm.verts.layers.float_color.new("Col")
    cols, rows = 8, int(TILE / 2.0)
    surface = 0.02
    grid = []
    for j in range(rows + 1):
        z = j * 2.0
        line = []
        for i in range(cols + 1):
            x = -ROAD_HALF + i * (2 * ROAD_HALF / cols)
            wear = 0.5 + 0.5 * math.sin(7.3 * x + 2.0 * math.pi * 23.0 * z / TILE)
            ruts = 0.2 * math.exp(-(((abs(x) - 1.1) / 0.55) ** 2))  # the two tracks the wheels wear
            v = bm.verts.new(high.point((x, surface, z)))
            k = shade(0.92 - ruts - 0.12 * wear)
            v[layer] = (k, k, k, 1.0)
            line.append(v)
        grid.append(line)
    for j in range(rows):
        for i in range(cols):
            face = bm.faces.new((grid[j][i], grid[j + 1][i], grid[j + 1][i + 1], grid[j][i + 1]))
            face.material_index = 0
            face.normal_update()
            if face.normal.z < 0:
                face.normal_flip()
    mark = surface + 0.012
    for side in (-1, 1):  # an edge line along each side
        x = side * (ROAD_HALF - 0.45)
        quad(bm, [(x - 0.075, mark, 0.0), (x + 0.075, mark, 0.0), (x + 0.075, mark, TILE), (x - 0.075, mark, TILE)], 1, layer, (0.9, 0.9, 0.9, 0.9))
    for k in range(int(TILE / 5.0)):  # the middle line: 2.5 m dashes, 2.5 m apart
        z = 5.0 * k + 1.25
        quad(bm, [(-0.075, mark, z), (0.075, mark, z), (0.075, mark, z + 2.5), (-0.075, mark, z + 2.5)], 1, layer, (0.95, 0.95, 0.95, 0.95))
    for side in (-1, 1):  # a curb along each side
        box(bm, (side * (ROAD_HALF + 0.2), 0.085, TILE / 2.0), (0.4, 0.15, TILE), 2, layer, (0.7, 0.95))
    return bm, None


# ---- backdrop ----


def build_backdrop(style):
    bm = bmesh.new()
    layer = bm.verts.layers.float_color.new("Col")
    normals = {}
    base = -3.0
    count = 0
    for ring, (distance, number, phase) in enumerate(RINGS):
        for i in range(number):
            around = 2.0 * math.pi * (i + phase) / number
            cx, cz = distance * math.cos(around), distance * math.sin(around)
            toward = around + math.pi  # the way to the middle
            index = count + 1
            count += 1
            if style == "desert":
                width = (9.0 + 6.0 * unit(index, 1)) * (1.0 + 0.2 * ring)
                height = (14.0 + 12.0 * unit(index, 2)) if ring == 0 else (22.0 + 16.0 * unit(index, 2))
                mesa(bm, layer, (cx, cz), toward, width, height, base, unit(index, 3))
            else:
                width = (16.0 + 8.0 * unit(index, 1)) * (1.0 + 0.1 * ring)
                height = (8.0 + 6.0 * unit(index, 2)) if ring == 0 else (12.0 + 8.0 * unit(index, 2))
                hill(bm, layer, normals, (cx, cz), toward, width, height, base)
    bm.verts.index_update()
    return bm, ([normals.get(v.index, (0.0, 0.0, 1.0)) for v in bm.verts] if style != "desert" else None)


def orient(face, outward):
    """Turn a face to point along `outward` (a Blender vector), by its own corners, not by the surface it belongs to."""
    face.normal_update()
    if face.normal.dot(outward) < 0:
        face.normal_flip()


def mesa(bm, layer, center, toward, width, height, base, tint):
    """Half a mesa: a flat-topped frustum of which only the three sides that look at the middle (and the top) are made."""
    cx, cz = center
    top_width = width * 0.72
    angles = [toward + math.radians(a) for a in (-150, -90, -30, 30, 90, 150)]
    shade_low, shade_high = 0.6 + 0.1 * tint, 0.95 + 0.05 * tint
    bottom, top = {}, {}
    for index, a in enumerate(angles):
        v = bm.verts.new(high.point((cx + top_width * math.cos(a), height, cz + top_width * math.sin(a))))
        v[layer] = (shade_high, shade_high, shade_high, 1.0)
        top[index] = v
    for index in (1, 2, 3, 4):
        a = angles[index]
        v = bm.verts.new(high.point((cx + width * math.cos(a), base, cz + width * math.sin(a))))
        v[layer] = (shade_low, shade_low, shade_low, 1.0)
        bottom[index] = v
    for index in (1, 2, 3):  # the sides that look at the middle
        face = bm.faces.new((bottom[index], bottom[index + 1], top[index + 1], top[index]))
        middle = (angles[index] + angles[index + 1]) / 2.0
        orient(face, high.point((math.cos(middle), 0.3, math.sin(middle))))
        face.material_index = 0
    face = bm.faces.new([top[i] for i in range(6)])
    orient(face, Vector((0.0, 0.0, 1.0)))
    face.material_index = 0


def hill(bm, layer, normals, center, toward, width, height, base):
    """Half a hill: a dome on the side that looks at the middle, five columns by two rings and a point on top, smooth."""
    cx, cz = center
    rise = height - base
    points = {}
    for c in range(5):
        phi = toward + math.radians(-90 + 45 * c)
        for e, elevation in enumerate((0.0, math.radians(45.0))):
            reach = math.cos(elevation)
            v = bm.verts.new(high.point((cx + width * reach * math.cos(phi), base + rise * math.sin(elevation), cz + width * reach * math.sin(phi))))
            k = shade(0.62 + 0.38 * math.sin(elevation))
            v[layer] = (k, k, k, 1.0)
            points[(c, e)] = v
            n = Vector((math.cos(phi) * reach / width, math.sin(elevation) / rise, math.sin(phi) * reach / width)).normalized()
            normals[len(bm.verts) - 1] = high.point((n.x, n.y, n.z))
    apex = bm.verts.new(high.point((cx, height, cz)))
    apex[layer] = (1.0, 1.0, 1.0, 1.0)
    normals[len(bm.verts) - 1] = high.point((0.0, 1.0, 0.0))
    middle = high.point((cx, base, cz))
    for c in range(4):
        for corners in (
            (points[(c, 0)], points[(c + 1, 0)], points[(c + 1, 1)], points[(c, 1)]),
            (points[(c, 1)], points[(c + 1, 1)], apex),
        ):
            face = bm.faces.new(corners)
            face.normal_update()
            orient(face, sum((v.co for v in corners), Vector()) / len(corners) - middle)
            face.material_index = 0


BUILDERS = {"terrain": build_terrain, "road": build_road, "backdrop": build_backdrop}


def build_world(out, recipe, palette, tier):
    """Builds one piece of the world, exports it to `out` and returns what the exported GLB really holds."""
    piece, style = recipe["build"]["piece"], recipe["build"]["style"]
    common.reset_scene()
    root = bpy.data.objects.new("root", None)
    bpy.context.scene.collection.objects.link(root)

    bm, normals = BUILDERS[piece](style)
    materials = []
    for slot in SLOTS[piece]:
        finish = recipe["finishes"][slot]
        materials.append(common.finish_material(f"{finish}_{len(materials)}", common.hex_to_linear(palette[recipe["colors"][slot]].lower()), tier["finishes"][finish]))
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    mesh = bpy.data.meshes.new("root_mesh")
    bm.to_mesh(mesh)
    bm.free()
    for material in materials:
        mesh.materials.append(material)
    if normals is not None:  # smooth, with the normals the shape knows rather than the ones its faces make
        mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))
        mesh.normals_split_custom_set([normals[loop.vertex_index] for loop in mesh.loops])
    obj = bpy.data.objects.new("root_mesh", mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.parent = root

    bpy.context.scene.frame_set(0)
    common.export_glb(out, animations=False, vertex_colors=True)
    real = common.glb_counts(out)
    real["parts"] = 1
    return real
