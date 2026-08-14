#!/usr/bin/env bash
#
# Runs the solution's tests on Linux, in the .NET SDK pinned by global.json,
# without installing anything on the workstation.
#
# Why this exists: the runtime-harness branch was written and proved entirely on
# Windows. 269 tests were green, two proof runs were captured, ten reviews
# passed — and the first CI run on ubuntu-latest failed seven tests, because a
# path had been built with a literal `.exe` and Windows separators. Reading a
# diff does not surface that class of defect and neither does a green suite on
# the machine that wrote it; only running it elsewhere does.
#
# CI remains the real gate — it runs on every push. This script only shortens
# the loop from "push and wait" to "run and know", which is worth having when
# the alternative is spending a red pipeline to learn the same thing.
#
# It tests HEAD, not the working tree: the archive is built from the last
# commit, which is exactly what a push would deliver. A dirty tree is reported
# rather than silently ignored, because "I fixed it and the script still fails"
# is a confusing way to learn that your fix was never committed.
#
# Usage:
#   scripts/test-on-linux.sh                     # the whole solution
#   scripts/test-on-linux.sh --filter Foo        # extra dotnet test arguments

set -euo pipefail

cd "$(dirname "$0")/.."

if [ -n "$(git status --porcelain)" ]; then
    echo "note: the working tree has uncommitted changes; this runs HEAD, which is what a push would deliver." >&2
fi

version=$(awk -F'"' '/"version"/ { print $4; exit }' global.json)
if [ -z "$version" ]; then
    echo "test-on-linux.sh: could not read the SDK version from global.json" >&2
    exit 2
fi

image="mcr.microsoft.com/dotnet/sdk:${version}"

# The pin in global.json uses rollForward: disable, so the image has to carry
# exactly this SDK. Pulling first turns a wrong or missing tag into one clear
# message instead of a build error about a missing SDK deep in the run.
if ! docker image inspect "$image" >/dev/null 2>&1; then
    echo "pulling $image ..."
    docker pull "$image"
fi

# The tree arrives as an archive over stdin rather than as a bind mount: no host
# path translation, and the container never sees — or writes to — the bin/ and
# obj/ directories of the Windows build sitting in the working copy.
git archive --format=tar HEAD | docker run --rm -i "$image" bash -c "
    set -euo pipefail
    mkdir /work && tar -x -C /work && cd /work
    dotnet test OathAndCoin.sln -c Release $*
"
