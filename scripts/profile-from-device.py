#!/usr/bin/env python3
"""Turns an ART profile dumped from the release app back into a baseline profile.

    adb shell cmd package compile --reset io.github.eliandarou.nahfahrt
    (use the app: start, search, open a connection, station search, live view, share)
    adb shell pm dump-profiles --dump-classes-and-methods io.github.eliandarou.nahfahrt
    adb pull /data/misc/profman/io.github.eliandarou.nahfahrt-primary.prof.txt dump.txt
    scripts/profile-from-device.py dump.txt android/app/build/outputs/mapping/release/mapping.txt \\
        > android/app/src/main/baseline-prof.txt

The dump uses the names R8 gave the classes; the mapping of the same build turns them back
into source names, which AGP maps again for every later build.
"""
import re
import sys

PRIMITIVES = {"void": "V", "boolean": "Z", "byte": "B", "char": "C", "short": "S", "int": "I", "long": "J", "float": "F", "double": "D"}


def descriptor(java_type, classes):
    dims = java_type.count("[]")
    base = java_type.replace("[]", "")
    code = PRIMITIVES.get(base) or "L" + classes.get(base, base).replace(".", "/") + ";"
    return "[" * dims + code


def parse(mapping_path):
    forward = {}  # original class -> obfuscated class
    lines = open(mapping_path, encoding="utf-8").read().splitlines()
    for line in lines:
        m = re.match(r"^(\S+) -> (\S+):$", line)
        if m:
            forward[m.group(1)] = m.group(2)
    backward = {obf: orig for orig, obf in forward.items()}
    methods = {}  # (obf class, obf name, obf descriptor) -> original name
    current = None
    for line in lines:
        m = re.match(r"^(\S+) -> (\S+):$", line)
        if m:
            current = m.group(1)
            continue
        m = re.match(r"^\s+(?:\d+:\d+:)?(\S+) ([\w$<>]+)\(([^)]*)\)(?::\d+(?::\d+)?)? -> ([\w$<>]+)$", line)
        if not m or current is None:
            continue
        ret, name, args, obf_name = m.groups()
        if "." in name:  # inlined from another class
            continue
        arg_types = [a for a in args.split(",") if a]
        desc = "(" + "".join(descriptor(a, forward) for a in arg_types) + ")" + descriptor(ret, forward)
        methods.setdefault((forward[current], obf_name, desc), name)
    return backward, methods


def unmap_type_list(text, backward):
    return re.sub(r"L([^;]+);", lambda m: "L" + backward.get(m.group(1).replace("/", "."), m.group(1).replace("/", ".")).replace(".", "/") + ";", text)


def main():
    dump, mapping = sys.argv[1], sys.argv[2]
    backward, methods = parse(mapping)
    out = set()
    for raw in open(dump, encoding="utf-8"):
        line = raw.strip().split("+", 1)[0]
        m = re.match(r"^([HSP]*)L([^;]+);(?:->([^(]+)(\(.*))?$", line)
        if not m:
            continue
        flags, cls, name, desc = m.groups()
        obf_class = cls.replace("/", ".")
        orig_class = backward.get(obf_class, obf_class).replace(".", "/")
        if name is None:
            out.add(f"L{orig_class};")
            continue
        orig_name = methods.get((obf_class, name, desc))
        if orig_name is None:
            # R8 merged or reshaped this method; its source name cannot be recovered.
            continue
        out.add(f"{flags}L{orig_class};->{orig_name}{unmap_type_list(desc, backward)}")
    print("\n".join(sorted(out)))


if __name__ == "__main__":
    main()
