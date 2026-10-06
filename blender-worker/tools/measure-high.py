"""blender -b --factory-startup -P blender-worker/tools/measure-high.py -- <out.json>: the real counts of every High kind's parts, from build.build_high (no estimate check).
Each number is { triangles, vertices, parts, meshes } of the GLB, so a cost is a difference of two builds."""
import copy
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))
import build  # noqa: E402

out_json = sys.argv[sys.argv.index("--") + 1]
FIX = os.path.join(HERE, "..", "fixtures", "recipes", "high") + os.sep
tmp = os.path.join(os.path.dirname(out_json), "_measure.glb")


def body_of(name):
    with open(FIX + name, encoding="utf-8") as handle:
        return json.load(handle)


def real(body, extras=None, details=None):
    body = copy.deepcopy(body)
    body["motions"] = {"version": 1, "motions": {}}  # counts do not depend on clips, and a stock clip names wheels a smaller vehicle lacks
    recipe, motions, palette, spec, joints = build.check_body(body)
    extras = list(recipe["extras"]) if extras is None else extras
    details = list(recipe["details"]) if details is None else details
    joints = build.joint_list(recipe["kind"], spec, recipe["build"], extras)
    r, _ = build.build_high(tmp, recipe, motions, palette, spec, joints, extras, details, 2)
    return {k: r[k] for k in ("triangles", "vertices", "parts", "meshes")}


def varied(name, **build_fields):
    body = body_of(name)
    body["recipe"]["build"].update(build_fields)
    return body


result = {}
# vehicle: no cab and two wheels, then a cab, then four wheels
v = body_of("vehicle-high-default.json")
two = varied("vehicle-high-default.json", cabSize=0, wheelCount=2)
result["vehicle"] = {
    "two_wheels": real(two, [], []),
    "four_wheels": real(varied("vehicle-high-default.json", cabSize=0, wheelCount=4), [], []),
    "cab": real(varied("vehicle-high-default.json", cabSize=0.45, wheelCount=2), [], []),
    "extras": {"antenna": real(two, ["antenna"], [])},
    "details": {d: real(two, [], [d]) for d in ("seams", "bolts", "cables", "lights")},
}
b = body_of("blob-high-default.json")
result["blob"] = {
    "base": real(b, [], []),
    "extras": {e: real(b, [e], []) for e in ("tail", "ears", "antenna", "hat")},
    "details": {d: real(b, [], [d]) for d in ("seams", "lights")},
}
shapes = ["cube", "sphere", "cone", "cylinder", "pyramid", "coin", "ring", "gem", "crate"]
result["prop"] = {"shapes": {}, "details": {}}
for shape in shapes:
    p = varied("prop-high-default.json", shape=shape)
    result["prop"]["shapes"][shape] = real(p, [], [])
    result["prop"]["details"][shape] = {d: real(p, [], [d]) for d in ("seams", "bolts")}
result["scenery"] = {}
for piece in ("tree", "pine", "rock", "cactus", "windmill", "lamp"):
    result["scenery"][piece] = real(body_of(f"scenery-{piece}-high.json"), [], [])
with open(out_json, "w", encoding="utf-8") as handle:
    json.dump(result, handle, indent=1)
print("MEASURED")
