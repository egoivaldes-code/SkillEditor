#!/bin/bash
# Post-merge setup for CRIPTA Sprite Forge (static GitHub Pages project).
# No npm install or DB migrations needed in this workspace — just verify the
# key files are present and exit cleanly.
set -e

echo "Post-merge setup: CRIPTA Sprite Forge"
echo "Static site — no install steps required."

# Sanity-check that the Sprite Forge entry point exists
if [ ! -f "sprite-forge/index.html" ]; then
  echo "ERROR: sprite-forge/index.html not found after merge" >&2
  exit 1
fi

echo "OK: sprite-forge/index.html present"
echo "Post-merge setup complete."
