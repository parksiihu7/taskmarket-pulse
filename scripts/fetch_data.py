#!/usr/bin/env python3
"""
Fetch Taskmarket's public market API on the server and write one static JSON file
for the dashboard to read.

Why a server-side build: api.taskmarket.dev does not send CORS headers, so a browser
on another origin cannot call it. This script runs in GitHub Actions every 30 minutes,
fetches everything, computes the aggregates, and publishes the result as
site/data/market.json on the same origin as the page.

Stdlib only. Python 3.9+.

    python3 scripts/fetch_data.py                 # writes site/data/market.json
    python3 scripts/fetch_data.py --out out.json  # custom path
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

API = "https://api.taskmarket.dev"
UA = ("taskmarket-pulse/1.0 (Taskmarket bounty entry; "
      "+https://github.com/parksiihu7/taskmarket-pulse)")
CHAINS = [(4217, "Tempo", "OUSD"), (8453, "Base", "USDC")]
MICRO = 1_000_000.0


# --------------------------------------------------------------------------- http

def get(path, tries=4):
    """GET a JSON document, retrying transient failures."""
    url = API + path
    last = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=45) as res:
                return json.loads(res.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            last = e
            if e.code in (429, 500, 502, 503, 504) and attempt < tries - 1:
                time.sleep(1.5 * (attempt + 1))
                continue
            raise
        except Exception as e:  # noqa: BLE001 - network hiccups, timeouts
            last = e
            if attempt < tries - 1:
                time.sleep(1.5 * (attempt + 1))
                continue
            raise
    raise last  # pragma: no cover


def fetch_all_tasks(chain_id, max_pages=80):
    """Walk /api/tasks to the end so poster counts are exact, not sampled."""
    tasks, cursor, pages = [], None, 0
    while True:
        q = f"/api/tasks?chainId={chain_id}&sort=newest&limit=100"
        if cursor:
            q += "&cursor=" + urllib.parse.quote(str(cursor))
        doc = get(q)
        rows = doc.get("tasks") or []
        tasks.extend(rows)
        pages += 1
        cursor = doc.get("nextCursor")
        if not doc.get("hasMore") or not cursor or pages >= max_pages:
            break
        time.sleep(0.12)
    return tasks, pages


# ---------------------------------------------------------------------- helpers

def utc_now():
    return datetime.now(timezone.utc).replace(microsecond=0)


def iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def week_start(day):
    """Monday (UTC) of the ISO week that contains `day` (a date)."""
    return day - timedelta(days=day.weekday())


def parse_day(s):
    return datetime.strptime(s[:10], "%Y-%m-%d").date()


def parse_ts(s):
    if not s:
        return None
    s = s.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def gini(values):
    """Gini coefficient of a non-negative list (0 = everyone equal, 1 = one holds all)."""
    xs = sorted(v for v in values if v > 0)
    n = len(xs)
    if n < 2:
        return 0.0
    total = sum(xs)
    if total <= 0:
        return 0.0
    cum = 0.0
    for i, v in enumerate(xs, start=1):
        cum += i * v
    return round((2 * cum) / (n * total) - (n + 1) / n, 4)


def pct(part, whole, digits=1):
    if not whole:
        return 0.0
    return round(100.0 * part / whole, digits)


def slim_task(t):
    """The fields the dashboard actually uses. Descriptions are dropped on purpose:
    they are long, and the aggregates never need them."""
    return {
        "id": t.get("id"),
        "ref": t.get("referenceCode"),
        "requester": (t.get("requester") or "").lower() or None,
        "createdAt": t.get("createdAt"),
        "expiryTime": t.get("expiryTime"),
        "status": t.get("status"),
        "mode": t.get("mode"),
        "reward": int(t.get("reward") or 0),
        "submissions": int(t.get("submissionCount") or 0),
        "awards": int(t.get("awardCount") or 0),
        "tags": (t.get("tags") or [])[:6],
    }


# ------------------------------------------------------------------- analytics

def analyse_tasks(tasks):
    """Everything the page shows that is derived from the individual task list."""
    total = len(tasks)
    by_status, by_mode = {}, {}
    reward_by_status, submissions_by_status = {}, {}
    posters = {}
    weeks = {}
    cohorts = {}

    for t in tasks:
        st = t["status"] or "unknown"
        by_status[st] = by_status.get(st, 0) + 1
        reward_by_status[st] = reward_by_status.get(st, 0) + t["reward"]
        submissions_by_status[st] = submissions_by_status.get(st, 0) + t["submissions"]
        md = t["mode"] or "unknown"
        by_mode[md] = by_mode.get(md, 0) + 1

        req = t["requester"]
        if req:
            p = posters.setdefault(req, {"tasks": 0, "reward": 0, "submissions": 0,
                                         "completed": 0, "first": None, "last": None})
            p["tasks"] += 1
            p["reward"] += t["reward"]
            p["submissions"] += t["submissions"]
            if st == "completed":
                p["completed"] += 1
            created = parse_ts(t["createdAt"])
            if created:
                if p["first"] is None or created < p["first"]:
                    p["first"] = created
                if p["last"] is None or created > p["last"]:
                    p["last"] = created

        created = parse_ts(t["createdAt"])
        if created and req:
            wk = week_start(created.date())
            w = weeks.setdefault(wk, {"posters": set(), "tasks": 0, "reward": 0})
            w["posters"].add(req)
            w["tasks"] += 1
            w["reward"] += t["reward"]

            c = cohorts.setdefault(wk, {"tasks": 0, "completed": 0, "open": 0,
                                        "expired": 0, "cancelled": 0, "other": 0,
                                        "reward": 0, "paid": 0})
            c["tasks"] += 1
            c["reward"] += t["reward"]
            if st == "completed":
                c["completed"] += 1
                c["paid"] += t["reward"]
            elif st in ("open", "claimed", "worker_selected", "pending_approval"):
                c["open"] += 1
            elif st == "expired":
                c["expired"] += 1
            elif st == "cancelled":
                c["cancelled"] += 1
            else:
                c["other"] += 1

    # ---- poster concentration
    ranked = sorted(posters.items(), key=lambda kv: (-kv[1]["tasks"], -kv[1]["reward"]))
    counts = [v["tasks"] for _, v in ranked]
    top5 = ranked[:5]
    top10 = ranked[:10]
    top5_tasks = sum(v["tasks"] for _, v in top5)
    top5_reward = sum(v["reward"] for _, v in top5)
    top10_tasks = sum(v["tasks"] for _, v in top10)
    reward_total = sum(v["reward"] for v in posters.values())
    one_task = sum(1 for v in posters.values() if v["tasks"] == 1)

    concentration = {
        "posters": len(posters),
        "tasks": sum(counts),
        "rewardTotal": reward_total,
        "top5Tasks": top5_tasks,
        "top5Reward": top5_reward,
        "top10Tasks": top10_tasks,
        "top5ShareTasks": pct(top5_tasks, sum(counts)),
        "top10ShareTasks": pct(top10_tasks, sum(counts)),
        "top5ShareReward": pct(top5_reward, reward_total),
        "oneTaskPosters": one_task,
        "oneTaskShare": pct(one_task, len(posters)),
        "giniTasks": gini(counts),
        "medianTasksPerPoster": sorted(counts)[len(counts) // 2] if counts else 0,
        "taskCounts": counts[:400],
        "topPostersReward": pct(top5_reward, reward_total),
        "leaderboard": [
            {"address": addr,
             "tasks": v["tasks"],
             "reward": v["reward"],
             "completed": v["completed"],
             "submissions": v["submissions"],
             "first": iso(v["first"]) if v["first"] else None,
             "last": iso(v["last"]) if v["last"] else None}
            for addr, v in top10
        ],
    }

    # ---- weekly posters, all weeks present in the data
    weekly = []
    for wk in sorted(weeks):
        w = weeks[wk]
        weekly.append({"week": wk.isoformat(), "posters": len(w["posters"]),
                       "tasks": w["tasks"], "reward": w["reward"]})

    # ---- cohort outcome for the last 10 weeks
    cohort_rows = []
    for wk in sorted(cohorts)[-10:]:
        c = cohorts[wk]
        cohort_rows.append({
            "week": wk.isoformat(), "tasks": c["tasks"],
            "completed": c["completed"], "open": c["open"],
            "expired": c["expired"], "cancelled": c["cancelled"], "other": c["other"],
            "reward": c["reward"], "paid": c["paid"],
            "completionRate": pct(c["completed"], c["tasks"]),
        })

    # ---- swarm: how many entries a single task attracts
    buckets = {"0": 0, "1": 0, "2": 0, "3": 0, "4": 0, "5-9": 0, "10+": 0}
    subs = []
    for t in tasks:
        n = t["submissions"]
        subs.append(n)
        if n == 0:
            buckets["0"] += 1
        elif n <= 4:
            buckets[str(n)] += 1
        elif n <= 9:
            buckets["5-9"] += 1
        else:
            buckets["10+"] += 1

    live = [t for t in tasks if t["status"] in ("open", "claimed", "worker_selected")]
    hottest = sorted(live, key=lambda t: (-t["submissions"], -t["reward"]))[:8]
    subs_live = [t["submissions"] for t in live]
    subs_sorted = sorted(subs_live)

    def median(xs):
        if not xs:
            return 0
        n = len(xs)
        return xs[n // 2] if n % 2 else (xs[n // 2 - 1] + xs[n // 2]) / 2

    swarm = {
        "histogram": [{"entries": k, "tasks": v} for k, v in buckets.items()],
        "liveTasks": len(live),
        "liveSubmissions": sum(subs_live),
        "meanPerLiveTask": round(sum(subs_live) / len(subs_live), 2) if subs_live else 0,
        "medianPerLiveTask": median(subs_sorted),
        "contestedShare": pct(sum(1 for t in live if t["submissions"] >= 3), len(live)),
        "hottest": [{"ref": t["ref"], "id": t["id"], "reward": t["reward"],
                     "submissions": t["submissions"], "status": t["status"],
                     "mode": t["mode"], "createdAt": t["createdAt"],
                     "expiryTime": t["expiryTime"], "tags": t["tags"]}
                    for t in hottest],
    }

    # ---- money flow: where every escrowed reward ended up
    def vol(*keys):
        return sum(reward_by_status.get(k, 0) for k in keys)

    def cnt(*keys):
        return sum(by_status.get(k, 0) for k in keys)

    posted = sum(reward_by_status.values())
    flow = {
        "posted": {"value": posted, "tasks": total},
        "paid": {"value": vol("completed"), "tasks": cnt("completed")},
        "locked": {"value": vol("open", "claimed", "worker_selected", "pending_approval"),
                   "tasks": cnt("open", "claimed", "worker_selected", "pending_approval")},
        "returned": {"value": vol("cancelled", "expired"),
                     "tasks": cnt("cancelled", "expired")},
        "expired": {"value": vol("expired"), "tasks": cnt("expired")},
        "cancelled": {"value": vol("cancelled"), "tasks": cnt("cancelled")},
        "paidShare": pct(vol("completed"), posted),
        "lockedShare": pct(vol("open", "claimed", "worker_selected", "pending_approval"), posted),
        "returnedShare": pct(vol("cancelled", "expired"), posted),
        "byStatus": [{"status": k, "tasks": v, "reward": reward_by_status.get(k, 0)}
                     for k, v in sorted(by_status.items(), key=lambda kv: -kv[1])],
        "byMode": [{"mode": k, "tasks": v} for k, v in sorted(by_mode.items(),
                                                              key=lambda kv: -kv[1])],
        "submissionsPerStatus": [{"status": k, "submissions": v}
                                 for k, v in sorted(submissions_by_status.items(),
                                                    key=lambda kv: -kv[1])],
    }

    return {
        "tasksAnalysed": total,
        "concentration": concentration,
        "weeklyPosters": weekly,
        "cohorts": cohort_rows,
        "swarm": swarm,
        "flow": flow,
        "_posterSet": list(posters.keys()),
        "_weekSets": {wk.isoformat(): sorted(v["posters"]) for wk, v in weeks.items()},
    }


# ------------------------------------------------------------------------ build

def fetch_chain(chain_id, name, currency):
    print(f"  chain {chain_id} ({name})…", flush=True)
    stats = get(f"/api/market/stats?chainId={chain_id}")
    breakdowns = get(f"/api/stats/breakdowns?chainId={chain_id}")

    series = {}
    for rng in ("7d", "30d", "90d"):
        series[rng] = get(f"/api/stats/platform-time-series?chainId={chain_id}"
                          f"&range={rng}&bucket=day")
    series["all"] = get(f"/api/stats/platform-time-series?chainId={chain_id}"
                        "&range=all&bucket=week")

    heat = {
        "mode30d": get(f"/api/stats/activity-heatmap?chainId={chain_id}"
                       "&range=30d&dimension=mode"),
        "hour30d": get(f"/api/stats/activity-heatmap?chainId={chain_id}"
                       "&range=30d&dimension=hourOfWeek"),
        "hour90d": get(f"/api/stats/activity-heatmap?chainId={chain_id}"
                       "&range=90d&dimension=hourOfWeek"),
    }

    feed = get(f"/api/stats/activity-feed?chainId={chain_id}&limit=50")

    print("    walking /api/tasks…", flush=True)
    raw_tasks, pages = fetch_all_tasks(chain_id)
    tasks = [slim_task(t) for t in raw_tasks]
    print(f"    {len(tasks)} tasks over {pages} pages", flush=True)

    derived = analyse_tasks(tasks)

    return {
        "chainId": chain_id,
        "name": name,
        "currency": currency,
        "stats": stats,
        "breakdowns": breakdowns,
        "series": series,
        "heatmap": heat,
        "feed": feed.get("items", []),
        "pages": pages,
        "derived": derived,
    }, tasks


def build(out_path, keep_tasks=False):
    started = utc_now()
    chains, task_lists = {}, {}
    for cid, name, cur in CHAINS:
        data, tasks = fetch_chain(cid, name, cur)
        chains[str(cid)] = data
        task_lists[str(cid)] = tasks
    finished = utc_now()

    ids = [str(c) for c, _, _ in CHAINS]

    def same(field):
        a = json.dumps(chains[ids[0]][field], sort_keys=True)
        b = json.dumps(chains[ids[1]][field], sort_keys=True)
        return a == b

    # Fields the API returns identically for every chain are platform-wide, not
    # per-chain: adding them up would double count. Flag that explicitly.
    identical = {
        "stats": same("stats"),
        "breakdowns": same("breakdowns"),
        "series": same("series"),
        "heatmapMode": json.dumps(chains[ids[0]]["heatmap"]["mode30d"], sort_keys=True)
                       == json.dumps(chains[ids[1]]["heatmap"]["mode30d"], sort_keys=True),
        "heatmapHour": json.dumps(chains[ids[0]]["heatmap"]["hour30d"], sort_keys=True)
                       == json.dumps(chains[ids[1]]["heatmap"]["hour30d"], sort_keys=True),
        "feed": len({(i.get("type"), i.get("taskId"), i.get("actor"))
                      for i in chains[ids[0]]["feed"][:20]}
                     & {(i.get("type"), i.get("taskId"), i.get("actor"))
                        for i in chains[ids[1]]["feed"][:20]}) >= 10,
    }
    for field, flag in (("stats", identical["stats"]), ("breakdowns", identical["breakdowns"])):
        for k in ids:
            chains[k][f"{field}Shared"] = flag

    # The page reads shared payloads from chain 4217 only, so drop the duplicate copy
    # from the other chain: it is the same bytes and it is a third of the file.
    if identical["breakdowns"]:
        chains[ids[1]].pop("breakdowns", None)
    if identical["feed"]:
        chains[ids[1]].pop("feed", None)
    if identical["heatmapMode"] or identical["heatmapHour"]:
        keep = {}
        for key in ("mode30d", "hour30d", "hour90d"):
            keep[key] = chains[ids[0]]["heatmap"][key]
        chains[ids[0]]["heatmap"] = keep
        chains[ids[1]]["heatmap"] = {}
    if identical["series"]:
        chains[ids[1]].pop("series", None)

    # The combined view is computed from both chains' task lists at once, so a wallet
    # that posts on both chains is counted once.
    all_tasks = [t for k in ids for t in task_lists[k]]
    combined = analyse_tasks(all_tasks)
    week_union = {}
    for k in ids:
        for wk, addrs in chains[k]["derived"]["_weekSets"].items():
            week_union.setdefault(wk, set()).update(addrs)
    per_week = {w["week"]: w for w in combined["weeklyPosters"]}
    for wk, addrs in week_union.items():
        if wk in per_week:
            per_week[wk]["unique"] = len(addrs)
    combined["weeklyPosters"] = [
        {"week": wk,
         "tempo": next((w["posters"] for w in chains[ids[0]]["derived"]["weeklyPosters"]
                        if w["week"] == wk), 0),
         "base": next((w["posters"] for w in chains[ids[1]]["derived"]["weeklyPosters"]
                       if w["week"] == wk), 0),
         "unique": per_week.get(wk, {}).get("unique", 0),
         "tasks": per_week.get(wk, {}).get("tasks", 0)}
        for wk in sorted(week_union)
    ]
    combined["posterSet"] = len({t["requester"] for t in all_tasks if t["requester"]})
    for k in ids:
        chains[k]["derived"].pop("_weekSets", None)
    combined.pop("_weekSets", None)
    combined.pop("_posterSet", None)

    window_from = min((t["createdAt"] for t in all_tasks if t["createdAt"]), default=None)
    window_to = max((t["createdAt"] for t in all_tasks if t["createdAt"]), default=None)
    combined["window"] = {"from": window_from, "to": window_to, "tasks": len(all_tasks)}

    # The newest 50 feed events are almost all submissions; pull task creations and ratings
    # too so the live feed shows the market's mix of events. The API wants the array form
    # (a repeated `types` parameter), not a comma list.
    extra_feeds = {
        "mixed": get("/api/stats/activity-feed?chainId=4217&limit=30"
                      "&types=task_created&types=task_rated").get("items", []),
    }

    doc = {
        "generatedAt": iso(started),
        "dataAsOf": iso(finished),
        "source": API,
        "units": {"micro": 1000000, "note": "reward values are micro-units; divide by 1e6"},
        "chains": chains,
        "identical": identical,
        "combined": combined,
        "extraFeeds": extra_feeds,
        "method": {
            "endpoints": [
                "/api/market/stats?chainId=…",
                "/api/stats/breakdowns?chainId=…",
                "/api/stats/platform-time-series?chainId=…&range=7d|30d|90d&bucket=day",
                "/api/stats/platform-time-series?chainId=…&range=all&bucket=week",
                "/api/stats/activity-heatmap?chainId=…&range=30d&dimension=mode",
                "/api/stats/activity-heatmap?chainId=…&range=30d|90d&dimension=hourOfWeek",
                "/api/stats/activity-feed?chainId=…&limit=50",
                "/api/tasks?chainId=…&sort=newest&limit=100&cursor=… (walked to the end)",
            ],
            "posters": "distinct `requester` addresses over every task returned by /api/tasks",
            "weeks": "ISO weeks, Monday 00:00 UTC, from each task's createdAt",
            "rewards": "task.reward summed, micro-units / 1e6",
            "chainFilter": "the API returns the same time series, breakdowns, heatmaps and feed "
                           "for both chainIds; those are platform-wide values, shown once and "
                           "never added together",
        },
    }

    if keep_tasks:
        doc["tasks"] = task_lists

    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    tmp = out_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, separators=(",", ":"), ensure_ascii=False)
    os.replace(tmp, out_path)

    size = os.path.getsize(out_path) / 1024
    print(f"wrote {out_path} ({size:.1f} KB) — data as of {doc['dataAsOf']}")
    return doc


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default=os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "site", "data", "market.json"))
    ap.add_argument("--keep-tasks", action="store_true",
                    help="also write the slim per-task list (large; for debugging)")
    args = ap.parse_args()
    doc = build(args.out, keep_tasks=args.keep_tasks)
    assert doc["chains"], "no chains fetched"
    return 0


if __name__ == "__main__":
    sys.exit(main())
