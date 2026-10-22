"""Verify the pinned upstream engine; this is a dependency smoke check, not the product runtime."""
from __future__ import annotations

import argparse
import importlib.metadata
import json
from pathlib import Path

from harness2.cli.demo import main as upstream_demo
from harness2.core import recursion, schedule, selection, library
from harness2.substrate.opencode import OpencodeSubstrate

PIN = "1cfe254e8d25b15f37048c3730134686abe60335"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    distribution = importlib.metadata.distribution("harness2")
    provenance = json.loads(distribution.read_text("direct_url.json") or "{}")
    if provenance.get("vcs_info", {}).get("commit_id") != PIN:
        raise RuntimeError("Harness2 must be installed from the exact locked upstream revision.")
    # Exercise upstream Propose–Probe–Compose, selection and experience library using
    # its deterministic local fixture, without MiniMax calls or customer workspace data.
    result = upstream_demo(["--output", str(args.output.resolve()), "--k", "1", "--mode", "sequential"])
    if result:
        raise RuntimeError("The upstream Harness2 recursion smoke check failed.")
    report = json.loads((args.output / "demo.json").read_text())
    print(json.dumps({
        "engine": "google-research/harness2",
        "revision": PIN,
        "version": distribution.version,
        "upstreamModules": [module.__name__ for module in (recursion, schedule, selection, library)],
        "executorSubstrate": OpencodeSubstrate.name,
        "completedTasks": report["done"],
        "failedTasks": report["failed"],
        "productionCutover": False,
    }))


if __name__ == "__main__":
    main()
