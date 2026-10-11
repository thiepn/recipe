#!/usr/bin/env python3
"""Source-only approval and fail-closed dispatch tests; never calls Vercel."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

project_id = sys.argv[1]
config = json.loads(Path("vercel.json").read_text())
assert config["git"]["deploymentEnabled"] is False, "Auto deployment must be disabled"
source = Path(".github/workflows/vercel-release.yml").read_text()
assert re.search(r"(?m)^on:\n  workflow_dispatch:\n", source), "Manual trigger missing"
assert not re.search(r"(?m)^  (push|pull_request|schedule|repository_dispatch|workflow_run):", source), "Automatic trigger present"
assert source.count(project_id) >= 2, "Incorrect project identity"
assert source.count("THIEPN_RELEASES_ENABLED") >= 1
assert source.count("--skip-domain") == 1
assert source.count("vercel promote") == 1
assert "test \"$TRIGGERING_ACTOR\" = \"thiepn\"" in source
assert "test \"$GITHUB_RUN_ATTEMPT\" = \"1\"" in source
assert not re.search(r"(?m)^      VERCEL_TOKEN:", source), "Secret accessible throughout job"

anchor = "      - name: Reject unapproved, stale, or non-owner dispatch\n"
assert source.count(anchor) == 1
preflight = source.split(anchor, 1)[1].split("\n  stage:\n", 1)[0]
raw = preflight.split("        run: |\n", 1)[1]
script = "\n".join(line[10:] for line in raw.splitlines() if line.strip())
assert "set -euo pipefail" in script
sha = "a" * 40
env = dict(os.environ,
    ACTOR="thiepn", TRIGGERING_ACTOR="thiepn", GITHUB_RUN_ATTEMPT="1",
    SOURCE_REF="refs/heads/main", RELEASE_ENABLED="true",
    CLI_VERSION="42.0.0", EXPECTED_SHA=sha, GITHUB_SHA=sha,
    OPERATION="stage", CONFIRMATION="STAGE " + sha)
with tempfile.TemporaryDirectory() as tmp:
    env["GITHUB_OUTPUT"] = os.path.join(tmp, "output")
    def check(label, overrides, accepted):
        payload = env.copy()
        payload.update(overrides)
        result = subprocess.run(["bash", "-c", script], env=payload,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5)
        if (result.returncode == 0) != accepted:
            raise AssertionError("Unexpected authorization result: " + label)
        print(("ACCEPT " if accepted else "REJECT ") + label)

    check("owner exact-main stage", {}, True)
    check("owner exact-main promote", {"OPERATION": "promote", "CONFIRMATION": "PROMOTE " + sha}, True)
    for name, update in [
        ("wrong actor", {"ACTOR": "attacker"}),
        ("rerun by another actor", {"TRIGGERING_ACTOR": "attacker"}),
        ("rerun by original owner", {"GITHUB_RUN_ATTEMPT": "2"}),
        ("non-main ref", {"SOURCE_REF": "refs/heads/feature"}),
        ("disabled flag", {"RELEASE_ENABLED": "false"}),
        ("missing flag", {"RELEASE_ENABLED": ""}),
        ("floating CLI version", {"CLI_VERSION": "latest"}),
        ("invalid SHA", {"EXPECTED_SHA": "short"}),
        ("stale SHA", {"GITHUB_SHA": "b" * 40}),
        ("wrong operation", {"OPERATION": "deploy"}),
        ("incorrect confirmation", {"CONFIRMATION": "STAGE " + "b"*40}),
        ("promote with stage confirmation", {"OPERATION": "promote"}),
        ("stage with promote confirmation", {"CONFIRMATION": "PROMOTE " + sha}),
    ]:
        check(name, update, False)
print("Source-only release authorization tests passed; zero deployment calls.")
