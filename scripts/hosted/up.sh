#!/usr/bin/env bash
# Prepares a cloud sandbox to run hosted Framekit next to one site's code. Run by the site's launcher
# (its backend) on every Edit Site launch; each step is skipped when nothing changed, so a resume is
# fast. It doesn't start Framekit: the launcher does that, passing secrets as environment variables
# so they never touch the disk.
#
# Required env: GIT_TOKEN, SITE_REPO (owner/name), SITE_APP (app folder in the repo)
# Optional env: SITE_BRANCH (default main), FRAMEKIT_REPO (default loveconnor/framekit),
#               FRAMEKIT_REF (git ref; "local" = source already copied into $FK_DIR)
set -euo pipefail

BASE=/vercel/sandbox
SITE_DIR="$BASE/site"
FK_DIR="$BASE/framekit"
STAMPS="$BASE/.framekit-stamps"
SITE_BRANCH="${SITE_BRANCH:-main}"
FRAMEKIT_REPO="${FRAMEKIT_REPO:-loveconnor/framekit}"
FRAMEKIT_REF="${FRAMEKIT_REF:-main}"
mkdir -p "$STAMPS"
step() { echo "[up] $*"; }
hash_of() { sha256sum "$1" 2>/dev/null | cut -c1-16 || echo none; }

# GitHub auth for clone, fetch and Publish's push, read from $GIT_TOKEN at use time: the token is never
# written to git config or the repo.
git config --global credential.helper '!f() { echo username=x-access-token; echo "password=$GIT_TOKEN"; }; f'
git config --global init.defaultBranch main
git config --global pull.ff only

# 1. The site's code. A fresh clone the first time; afterwards fast-forward to the latest branch,
#    but only with no unpublished edits (they live in this working tree until Publish).
if [ ! -d "$SITE_DIR/.git" ]; then
  step "cloning $SITE_REPO ($SITE_BRANCH)"
  git clone --quiet --depth 50 --branch "$SITE_BRANCH" "https://github.com/$SITE_REPO.git" "$SITE_DIR"
elif [ -z "$(git -C "$SITE_DIR" status --porcelain)" ] && [ "$(git -C "$SITE_DIR" rev-list --count "@{u}..HEAD" 2>/dev/null || echo 0)" = "0" ]; then
  step "updating $SITE_REPO to the latest $SITE_BRANCH"
  git -C "$SITE_DIR" fetch --quiet --depth 50 origin "$SITE_BRANCH" && git -C "$SITE_DIR" merge --quiet --ff-only FETCH_HEAD || step "update skipped (couldn't fast-forward)"
else
  step "keeping unpublished edits; not updating the site"
fi

# 2. The site app's dependencies, when its lockfile changed.
APP_DIR="$SITE_DIR/$SITE_APP"
LOCK="$(hash_of "$APP_DIR/package-lock.json")"
if [ ! -d "$APP_DIR/node_modules" ] || [ "$(cat "$STAMPS/site-deps" 2>/dev/null)" != "$LOCK" ]; then
  step "installing $SITE_APP dependencies"
  (cd "$APP_DIR" && npm ci --include=dev --no-audit --no-fund --loglevel=error)
  echo "$LOCK" > "$STAMPS/site-deps"
fi

# 3. Framekit itself, at the pinned version.
if [ "$FRAMEKIT_REF" != "local" ]; then
  if [ ! -d "$FK_DIR/.git" ]; then
    step "cloning $FRAMEKIT_REPO"
    git clone --quiet "https://github.com/$FRAMEKIT_REPO.git" "$FK_DIR"
  fi
  if [ "$(cat "$STAMPS/framekit-ref" 2>/dev/null)" != "$FRAMEKIT_REF" ]; then
    step "checking out Framekit $FRAMEKIT_REF"
    git -C "$FK_DIR" fetch --quiet origin
    git -C "$FK_DIR" checkout --quiet --force "$FRAMEKIT_REF"
    rm -rf "$FK_DIR/.next"
  fi
fi
FK_LOCK="$(hash_of "$FK_DIR/package-lock.json")"
if [ ! -d "$FK_DIR/node_modules" ] || [ "$(cat "$STAMPS/framekit-deps" 2>/dev/null)" != "$FK_LOCK" ]; then
  step "installing Framekit dependencies"
  (cd "$FK_DIR" && npm ci --include=dev --no-audit --no-fund --loglevel=error)
  echo "$FK_LOCK" > "$STAMPS/framekit-deps"
  rm -rf "$FK_DIR/.next"
fi
# Next bakes next.config headers() into the build, so the sites allowed to embed the editor
# (FRAMEKIT_EMBED_ORIGINS) are part of what's built. Other hosted settings are read at runtime.
BUILD_KEY="$FRAMEKIT_REF|${FRAMEKIT_EMBED_ORIGINS:-}"
if [ ! -f "$FK_DIR/.next/BUILD_ID" ] || [ "$(cat "$STAMPS/framekit-build" 2>/dev/null)" != "$BUILD_KEY" ]; then
  step "building Framekit"
  (cd "$FK_DIR" && NEXT_TELEMETRY_DISABLED=1 npx next build >/dev/null)
  echo "$BUILD_KEY" > "$STAMPS/framekit-build"
fi
echo "$FRAMEKIT_REF" > "$STAMPS/framekit-ref"
step "ready: site at $APP_DIR"
