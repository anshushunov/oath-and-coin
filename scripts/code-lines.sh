#!/usr/bin/env bash
#
# Counts the code lines of one or more C# trees, and optionally holds them to a
# cap.
#
# A "code line" is a line that is neither blank nor begins — after leading
# whitespace — with `//`. That single rule covers XML documentation (`///`) and
# ordinary comments alike. It exists in this script and nowhere else on
# purpose: the harness cap in ADR-008 was first stated in prose as "XML docs and
# blank lines excluded" while the number quoted beside it had been produced by a
# command that also dropped `//` comments. The prose and the number disagreed by
# 80 lines, and the paragraph existed precisely to make the cap auditable. A
# number that can only be reproduced by guessing which command made it is not a
# measurement.
#
# `bin/` and `obj/` are skipped: they hold generated sources that belong to a
# build, not to the codebase being measured. The original ad-hoc command skipped
# them only by accident, because ripgrep happens to honour .gitignore.
#
# Carriage returns are stripped before a line is judged. Without that a blank
# line in a CRLF checkout counts as code, and the same commit measures
# differently on Windows and on Linux — the failure this repository has already
# paid for once.
#
# Usage:
#   scripts/code-lines.sh <path>...
#   scripts/code-lines.sh --cap <n> <path>...
#
# Prints `code=<n> raw=<n>`. With --cap, exits 1 when the code count exceeds the
# cap, naming both numbers.

set -euo pipefail

cap=""
if [ "${1:-}" = "--cap" ]; then
    if [ -z "${2:-}" ]; then
        echo "code-lines.sh: --cap needs a number" >&2
        exit 2
    fi
    cap="$2"
    shift 2

    # A cap that is not a number would make `[ "$code" -gt "$cap" ]` fail as a
    # test rather than as a script, and a failing test inside an `if` is simply
    # false — the ceiling would switch itself off and the stage would stay
    # green. A guard that can be disabled by a typo is not a guard.
    case "$cap" in
        '' | *[!0-9]*)
            echo "code-lines.sh: --cap needs a non-negative integer, got '$cap'" >&2
            exit 2
            ;;
    esac
fi

if [ "$#" -eq 0 ]; then
    echo "usage: code-lines.sh [--cap <n>] <path>..." >&2
    exit 2
fi

shopt -s globstar nullglob

files=()
for path in "$@"; do
    if [ -d "$path" ]; then
        for file in "$path"/**/*.cs; do
            case "$file" in
                */bin/* | */obj/*) continue ;;
            esac
            files+=("$file")
        done
    elif [ -f "$path" ]; then
        files+=("$path")
    else
        echo "code-lines.sh: '$path' does not exist" >&2
        exit 2
    fi
done

if [ "${#files[@]}" -eq 0 ]; then
    # Counting nothing and reporting zero would satisfy any cap forever.
    echo "code-lines.sh: no .cs files under: $*" >&2
    exit 2
fi

counts=$(awk '
    {
        raw++
        line = $0
        sub(/\r$/, "", line)
        sub(/^[ \t]+/, "", line)
        if (line == "" || line ~ /^\/\//) next
        code++
    }
    END { printf "%d %d", code + 0, raw + 0 }
' "${files[@]}")

code=${counts% *}
raw=${counts#* }

echo "code=$code raw=$raw"

if [ -n "$cap" ] && [ "$code" -gt "$cap" ]; then
    echo "code-lines.sh: $code code lines exceed the cap of $cap in: $*" >&2
    exit 1
fi
