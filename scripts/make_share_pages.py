#!/usr/bin/env python3
"""
Write one small HTML file per view under site/s/, so a shared link carries that view's
own Open Graph card while still opening the dashboard at the right section.

    python3 scripts/make_share_pages.py
"""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = "https://parksiihu7.github.io/taskmarket-pulse/"

VIEWS = [
    ("overview", "Where the money goes", "Taskmarket, live: escrowed rewards, agent swarms and the wallets that post the work."),
    ("flow", "Money in, money out", "Every escrowed reward, traced to paid, locked or returned."),
    ("posters", "A few wallets post the work", "Poster concentration, and the distinct posters each week."),
    ("swarm", "The swarm converges", "How many agents pile onto a single Taskmarket task."),
    ("rhythm", "When the market wakes", "Taskmarket activity by hour of the week, in UTC."),
    ("feed", "Live from the market", "What agents are posting, submitting and rating right now."),
    ("methods", "Every number, reproducible", "The endpoints, the units and how each figure is made."),
]

TEMPLATE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} — Taskmarket Pulse</title>
<meta name="description" content="{desc}">
<link rel="canonical" href="{site}#{view}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Taskmarket Pulse">
<meta property="og:title" content="{title} — Taskmarket Pulse">
<meta property="og:description" content="{desc}">
<meta property="og:image" content="{site}og/og-{view}.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="{site}#{view}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{title} — Taskmarket Pulse">
<meta name="twitter:description" content="{desc}">
<meta name="twitter:image" content="{site}og/og-{view}.png">
<link rel="icon" href="../assets/img/mark.png" type="image/png">
<meta http-equiv="refresh" content="0;url=../index.html#{view}">
<script>
  // Keep any ?chain= or ?range= the sharer had, then land on the view.
  location.replace('../index.html' + location.search + '#{view}');
</script>
</head>
<body style="margin:0;background:#12100E;color:#EFE9E2;font-family:system-ui,sans-serif;padding:40px">
<p><a href="../index.html#{view}" style="color:#D9A097">{title} — open Taskmarket Pulse</a></p>
</body>
</html>
"""


def main():
    out = os.path.join(ROOT, "site", "s")
    os.makedirs(out, exist_ok=True)
    for view, title, desc in VIEWS:
        html = TEMPLATE.format(view=view, title=title, desc=desc, site=SITE)
        with open(os.path.join(out, view + ".html"), "w", encoding="utf-8") as fh:
            fh.write(html)
        print("wrote s/" + view + ".html")


if __name__ == "__main__":
    main()
