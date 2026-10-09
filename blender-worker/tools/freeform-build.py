"""blender -b --factory-startup -P blender-worker/tools/freeform-build.py -- <recipe.json> <out.glb> [stats.json]

Builds a freeform (kind "model") recipe with scripts/freeform.py: the prototype path for looking at what the new vocabulary makes, before it is wired into the
worker. recipe.json is { "recipe": ..., "palette": [five #rrggbb] }.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))
import freeform  # noqa: E402

args = sys.argv[sys.argv.index("--") + 1 :]
with open(args[0], encoding="utf-8") as handle:
    body = json.load(handle)
with open(os.path.join(HERE, "..", "scripts", "kit.json"), encoding="utf-8") as handle:
    finishes = json.load(handle)["tiers"]["high"]["finishes"]
counts = freeform.build_model(args[1], body["recipe"], body["palette"], finishes)
print("built", counts)
if len(args) > 2:
    with open(args[2], "w", encoding="utf-8") as handle:
        json.dump({**counts, "parts": len(body["recipe"]["parts"]), "clips": []}, handle)
