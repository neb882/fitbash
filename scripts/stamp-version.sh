#!/bin/sh
# Stamps a version into a copy of the site, so a visitor's browser can tell when
# a newer one is out: scripts/stamp-version.sh <folder with index.html and sw.js>
#
# The version is a fingerprint of the folder's files, so it changes exactly when
# something a visitor loads changes. The deploy workflow runs this on public/
# just before publishing. Never commit a stamped file.
set -eu
dir=${1:?usage: stamp-version.sh <site folder>}
cd "$dir"

grep -q 'const VERSION = "dev";' sw.js || { echo "sw.js is already stamped or has no VERSION line" >&2; exit 1; }
grep -q 'name="fitbash-version" content="dev"' index.html || { echo "index.html is already stamped or has no version tag" >&2; exit 1; }

version=$(find . -type f -print | LC_ALL=C sort | while read -r file; do sha256sum "$file"; done | sha256sum | cut -c1-12)

sed -i "s/const VERSION = \"dev\";/const VERSION = \"$version\";/" sw.js
sed -i "s/name=\"fitbash-version\" content=\"dev\"/name=\"fitbash-version\" content=\"$version\"/" index.html

grep -q "const VERSION = \"$version\";" sw.js
grep -q "content=\"$version\"" index.html
echo "$version"
