#!/usr/bin/env bash
# Deploys the committed VERITAS source to a Hugging Face Docker Space.
#
#   bun run deploy:hf <user>/<space>      (HF_TOKEN from .env, or `hf auth login` first)
#
# Uploads committed files only (git archive), so .env and local data never leave this
# machine. The Space is created private if it does not exist. Its secrets
# (DATABASE_URL, VERITAS_PASSWORD) are set in the Space settings, not here.
set -euo pipefail

space="${1:-${HF_SPACE:-}}"
if [[ -z "$space" || "$space" != */* ]]; then
  echo "usage: bun run deploy:hf <user>/<space>" >&2
  exit 2
fi
# The Hugging Face CLI, pinned, in a private virtualenv under .veritas (git-ignored).
cli_dir=".veritas/hf-cli"
if [[ ! -x "$cli_dir/bin/hf" ]]; then
  python3 -m venv "$cli_dir"
  "$cli_dir/bin/pip" install --quiet "huggingface_hub[cli]==2.4.0"
fi
hf() { "$cli_dir/bin/hf" "$@"; }
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "Commit your changes first: only committed files are deployed." >&2
  exit 2
fi

bundle="$(mktemp -d)"
trap 'rm -rf "$bundle"' EXIT
git archive HEAD | tar -x -C "$bundle"
rm -rf "$bundle/backend/tests" "$bundle/frontend/tests" "$bundle/docs" "$bundle/code"
cp deploy/huggingface/README.md "$bundle/README.md"

hf repos create "$space" --repo-type space --space-sdk docker --private --exist-ok
hf upload "$space" "$bundle" . --repo-type space --delete "*" \
  --commit-message "Deploy $(git rev-parse --short HEAD)"

echo
echo "Deployed. Build log: https://huggingface.co/spaces/$space?logs=build"
