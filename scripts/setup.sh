#!/usr/bin/env sh

set -eu

fail() {
  printf '%s\n' "Error: $1" >&2
  exit 1
}

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"

command -v node >/dev/null 2>&1 || fail "Node.js is required. Install Node.js (which includes npm), then run this script again."
command -v npm >/dev/null 2>&1 || fail "npm is required but was not found. Install Node.js with npm, then run this script again."
[ -f package.json ] || fail "package.json was not found at $ROOT_DIR. Run this script from a project checkout."

printf 'Using Node %s\n' "$(node --version)"
printf 'Using npm %s\n' "$(npm --version)"

if [ -f package-lock.json ] || [ -f npm-shrinkwrap.json ]; then
  printf '%s\n' 'Installing dependencies with npm ci...'
  npm ci || fail "Dependency installation failed. Review the npm output and try again."
else
  printf '%s\n' 'No npm lockfile found; installing dependencies with npm install...'
  npm install || fail "Dependency installation failed. Review the npm output and try again."
fi

if [ -f .env.example ] && [ ! -e .env ] && [ ! -L .env ]; then
  cp -- .env.example .env || fail "Could not create .env from .env.example."
  printf '%s\n' 'Created .env from .env.example.'
elif [ -f .env ]; then
  printf '%s\n' 'Keeping existing .env unchanged.'
elif [ -e .env ] || [ -L .env ]; then
  printf '%s\n' 'Keeping existing .env path unchanged.'
else
  printf '%s\n' 'No .env.example found; leaving environment files unchanged.'
fi

printf '\nSetup complete. Next commands:\n'
printf '  npm run dev\n'
printf '  npm run test\n'
