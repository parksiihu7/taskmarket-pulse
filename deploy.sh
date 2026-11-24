#!/usr/bin/env bash
# One command to publish Taskmarket Pulse to GitHub Pages.
#
#   ./deploy.sh                    # uses parksiihu7/taskmarket-pulse
#   REPO=you/other-name ./deploy.sh
#
# Needs the GitHub CLI (`gh`) signed in, and `git`. Creates the public repo if it does
# not exist yet, pushes this folder, switches Pages to "GitHub Actions", and waits for
# the first build so you know the URL that came up.
set -euo pipefail

REPO="${REPO:-parksiihu7/taskmarket-pulse}"
BRANCH="${BRANCH:-main}"
OWNER="${REPO%%/*}"
NAME="${REPO##*/}"
URL="https://${OWNER}.github.io/${NAME}/"

cd "$(dirname "$0")"

command -v gh >/dev/null || { echo "gh (GitHub CLI) is required: https://cli.github.com"; exit 1; }
command -v git >/dev/null || { echo "git is required"; exit 1; }

# 1. a fresh build of the data, so the first deploy is not empty
python3 scripts/fetch_data.py

# 2. local repo
if [ ! -d .git ]; then
  git init -q
  git checkout -q -b "$BRANCH"
fi
git add -A
git commit -qm "Taskmarket Pulse: build $(date -u +%Y-%m-%dT%H:%MZ)" || echo "nothing new to commit"

# 3. GitHub repo (public, because the licence and the page must be public)
if gh repo view "$REPO" >/dev/null 2>&1; then
  git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/${REPO}.git"
  git push -q -u origin "$BRANCH"
else
  gh repo create "$REPO" --public --source . --remote origin --push \
    --description "Live dashboard of the Taskmarket market, built from its public API"
fi

# 4. Pages: build and deploy from this workflow
if ! gh api "repos/${REPO}/pages" >/dev/null 2>&1; then
  gh api -X POST "repos/${REPO}/pages" -f build_type=workflow >/dev/null
else
  gh api -X PUT "repos/${REPO}/pages" -f build_type=workflow >/dev/null
fi

# 5. wait for the first run, if the API lets us see it
RUN_ID=$(gh run list -R "$REPO" --workflow deploy.yml -L 1 --json databaseId -q '.[0].databaseId' 2>/dev/null || true)
if [ -n "${RUN_ID:-}" ]; then
  echo "waiting for run ${RUN_ID}…"
  gh run watch -R "$REPO" "$RUN_ID" --exit-status >/dev/null 2>&1 || \
    echo "the run is still going; check: gh run view -R ${REPO} ${RUN_ID}"
fi

echo
echo "Deployed:  ${URL}"
echo "Repo:      https://github.com/${REPO}"
echo "Refreshes: every 30 minutes (GitHub Actions schedule)"
