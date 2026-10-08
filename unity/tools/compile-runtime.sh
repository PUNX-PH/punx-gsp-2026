#!/usr/bin/env bash
# Compiles the template's runtime C# against the assemblies of the Unity Editor and of the project's last compile
# (Library/ScriptAssemblies), with the C# compiler inside the Editor folder. It finds compile errors with no license and no Editor window; it
# does not run anything and does not compile shaders. Usage: bash unity/tools/compile-runtime.sh [Unity Data folder]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
UNITY_DATA="${1:-/c/Program Files/Unity/Hub/Editor/6000.3.25f1/Editor/Data}"
DOTNET="$UNITY_DATA/NetCoreRuntime/dotnet.exe"
CSC="$UNITY_DATA/DotNetSdkRoslyn/csc.dll"
PROJECT="$ROOT/unity/runner-template"
OUT="$ROOT/unity/tools/out"
mkdir -p "$OUT"
REFS=("-r:$UNITY_DATA/NetStandard/ref/2.1.0/netstandard.dll")
for dll in "$UNITY_DATA"/Managed/UnityEngine/UnityEngine*.dll; do REFS+=("-r:$dll"); done
for name in glTFast Unity.InputSystem Unity.Mathematics Unity.Collections Unity.Burst; do
  [ -f "$PROJECT/Library/ScriptAssemblies/$name.dll" ] && REFS+=("-r:$PROJECT/Library/ScriptAssemblies/$name.dll")
done
SRC=$(find "$PROJECT/Assets/Runner/Runtime" -name '*.cs')
# shellcheck disable=SC2086
"$DOTNET" "$CSC" -nologo -langversion:9 -nullable:disable -nostdlib -target:library -out:"$OUT/Runner.Runtime.check.dll" "${REFS[@]}" $SRC
echo "ok    Runtime compiles"
# The NUnit test files (Tests/EditMode, Tests/PlayMode) reference net framework assemblies that cannot be mixed with these netstandard ones; they compile
# only inside Unity.
