#!/bin/sh
# Rebuilds public/vendor/anthropic-sdk.js, the browser copy of the Anthropic SDK.
# The page has no build step, so this one bundled file is committed. Run this
# after changing the @anthropic-ai/sdk version in package.json.
set -eu
cd "$(dirname "$0")/.."
npx esbuild scripts/vendor-entry.js \
  --bundle --format=esm --platform=browser --target=es2022 \
  --minify --legal-comments=none \
  --banner:js="// @anthropic-ai/sdk $(node -p "JSON.parse(require('fs').readFileSync('node_modules/@anthropic-ai/sdk/package.json', 'utf8')).version"), bundled by scripts/vendor.sh. Do not edit." \
  --outfile=public/vendor/anthropic-sdk.js
