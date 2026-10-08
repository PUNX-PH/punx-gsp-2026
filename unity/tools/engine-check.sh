#!/usr/bin/env bash
# Compiles the engine's pure C# (Runtime/Engine, no UnityEngine) with the C# compiler and .NET runtime that ship inside the Unity Editor, then
# replays the shared fixtures (web/src/lib/engine/fixtures, copied to Tests/Engine) and compares every state digest and every bad-spec message.
# Needs no Unity license, so it runs when the Hub sign-in is missing. Usage: bash unity/tools/engine-check.sh [Unity Data folder]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
UNITY_DATA="${1:-/c/Program Files/Unity/Hub/Editor/6000.3.25f1/Editor/Data}"
DOTNET="$UNITY_DATA/NetCoreRuntime/dotnet.exe"
CSC="$UNITY_DATA/DotNetSdkRoslyn/csc.dll"
RUNTIME_DIR="$(ls -d "$UNITY_DATA"/NetCoreRuntime/shared/Microsoft.NETCore.App/*/ | head -1)"
OUT="$ROOT/unity/tools/out"
mkdir -p "$OUT"
REFS=()
for name in System.Private.CoreLib System.Runtime System.Collections System.Console System.Linq System.Memory; do
  REFS+=("-r:${RUNTIME_DIR}${name}.dll")
done
SRC=("$ROOT"/unity/runner-template/Assets/Runner/Runtime/Engine/Pure/*.cs "$ROOT"/unity/tools/engine-check/*.cs)
"$DOTNET" "$CSC" -nologo -langversion:9 -nullable:disable -warn:4 -target:exe -out:"$OUT/EngineCheck.dll" "${REFS[@]}" "${SRC[@]}"
cat > "$OUT/EngineCheck.runtimeconfig.json" <<'JSON'
{ "runtimeOptions": { "tfm": "net6.0", "framework": { "name": "Microsoft.NETCore.App", "version": "6.0.0" } } }
JSON
"$DOTNET" "$OUT/EngineCheck.dll" "$ROOT/unity/runner-template/Assets/Runner/Tests/Engine"
