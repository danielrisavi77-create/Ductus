"""OSV-Scanner negative control (DAN-435).

build: copy an npm v3 lockfile and add one known vulnerable package to the copy.
check: accept the scan of that copy only if it failed on exactly that advisory,
so a scanner that never ran, or ran and found nothing, cannot pass.
Run by the "OSV-Scanner synthetic negative control" step; tested by
osv-negative-control.test.mjs.
"""

import json
import sys

PACKAGE = "minimist"
VERSION = "1.2.5"
ADVISORY = "GHSA-xvch-5gv4-984h"


def build(source, target):
    with open(source, encoding="utf-8") as stream:
        lock = json.load(stream)
    if lock.get("lockfileVersion") != 3 or "" not in lock.get("packages", {}):
        sys.exit("expected an npm lockfileVersion 3 with a root package")
    lock["packages"][""].setdefault("dependencies", {})[PACKAGE] = VERSION
    lock["packages"]["node_modules/" + PACKAGE] = {"version": VERSION, "license": "MIT"}
    with open(target, "w", encoding="utf-8") as stream:
        json.dump(lock, stream, indent=2)


def advisory_ids(package):
    for vulnerability in package.get("vulnerabilities") or []:
        yield vulnerability.get("id")
        yield from vulnerability.get("aliases") or []


def check(exit_code, report_path):
    if exit_code == "0":
        sys.exit(f"OSV-Scanner passed a lockfile with {PACKAGE} {VERSION} ({ADVISORY})")
    if exit_code != "1":
        sys.exit(f"OSV-Scanner did not finish a scan (exit {exit_code})")
    try:
        with open(report_path, encoding="utf-8") as stream:
            report = json.load(stream)
        packages = [p for result in report["results"] for p in result["packages"]]
    except (OSError, ValueError, KeyError, TypeError) as exc:
        sys.exit("Scanner failed before producing a report: " + repr(exc))
    for package in packages:
        info = package.get("package") or {}
        same = (info.get("name"), info.get("version")) == (PACKAGE, VERSION)
        if same and ADVISORY in advisory_ids(package):
            print(f"OSV-Scanner rejected {PACKAGE} {VERSION} with {ADVISORY}")
            return
    sys.exit(f"{ADVISORY} for {PACKAGE} {VERSION} missing from the report")


if __name__ == "__main__":
    if len(sys.argv) != 4 or sys.argv[1] not in ("build", "check"):
        sys.exit(
            "usage: osv-negative-control.py build <lockfile> <copy> | check <exit-code> <report>"
        )
    {"build": build, "check": check}[sys.argv[1]](sys.argv[2], sys.argv[3])
