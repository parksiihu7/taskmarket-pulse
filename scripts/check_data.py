#!/usr/bin/env python3
"""
Check the published data file before it is deployed. Runs in CI right after
scripts/fetch_data.py so a broken API response never replaces a good page.

    python3 scripts/check_data.py site/data/market.json
"""
import json
import sys
from datetime import datetime, timezone

REQUIRED_CHAINS = ("4217", "8453")
REQUIRED_STATS = ("registeredWorkers", "activeAgents7d", "openTasks")


def fail(msg):
    print("FAIL:", msg)
    return 1


def main(path="site/data/market.json"):
    with open(path, encoding="utf-8") as fh:
        d = json.load(fh)

    for key in ("generatedAt", "dataAsOf", "chains", "combined", "identical"):
        if key not in d:
            return fail(f"missing {key}")

    for cid in REQUIRED_CHAINS:
        c = d["chains"].get(cid)
        if not c:
            return fail(f"missing chain {cid}")
        for key in REQUIRED_STATS:
            if key not in c["stats"]:
                return fail(f"chain {cid} stats missing {key}")
        # Shared payloads (time series, feed, heatmap, breakdowns) live on chain 4217 only
        # when the API returns the same bytes for both chains; the others may omit them.
        if "series" in c:
            for rng in ("7d", "30d", "90d", "all"):
                if not c["series"].get(rng):
                    return fail(f"chain {cid} series {rng} empty")
        if "feed" in c and not c["feed"]:
            return fail(f"chain {cid} feed empty")
        if not c["derived"]["concentration"]["posters"]:
            return fail(f"chain {cid} has no posters")
        if c["derived"]["tasksAnalysed"] < 50:
            return fail(f"chain {cid} task list suspiciously small")

    base = d["chains"][REQUIRED_CHAINS[0]]
    for key in ("series", "feed", "breakdowns", "heatmap"):
        if not base.get(key):
            return fail(f"chain {REQUIRED_CHAINS[0]} missing {key}")

    if not d["combined"]["weeklyPosters"]:
        return fail("no weekly poster rows")
    if d["combined"]["flow"]["posted"]["value"] <= 0:
        return fail("posted value is zero")

    age = datetime.now(timezone.utc) - datetime.strptime(
        d["dataAsOf"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    if age.total_seconds() > 3 * 3600:
        return fail(f"data is stale ({age})")

    print("ok: %s tasks, %s posters, data as of %s"
          % (d["combined"]["window"]["tasks"],
             d["combined"]["posterSet"], d["dataAsOf"]))
    return 0


if __name__ == "__main__":
    sys.exit(main(*sys.argv[1:]))
