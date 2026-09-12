#!/usr/bin/env bash
# Builds an Alexa-hosted skill repo layout into dist/hosted/.
#
# Alexa-hosted = Amazon runs the Lambda for you (free, no AWS account). The repo
# it gives you must contain lambda/ and skill-package/ at its root, and it has
# NO env-var editor -> RELAY_API_URL/RELAY_API_KEY are baked into the bundle.
#
#   RELAY_API_URL=https://your-backend npm run hosted -w @relay/alexa
set -euo pipefail
cd "$(dirname "$0")/.."

: "${RELAY_API_URL:?set RELAY_API_URL to the public backend URL (it gets baked into the bundle)}"
RELAY_API_KEY="${RELAY_API_KEY:-}"

OUT=dist/hosted
rm -rf "$OUT"
mkdir -p "$OUT/lambda"

# Single-file CommonJS bundle: Amazon installs nothing, so nothing can fail on deploy.
npx esbuild src/lambda.ts \
  --bundle --platform=node --target=node20 --format=cjs \
  --define:__RELAY_API_URL__="\"$RELAY_API_URL\"" \
  --define:__RELAY_API_KEY__="\"$RELAY_API_KEY\"" \
  --outfile="$OUT/lambda/index.js"

cat > "$OUT/lambda/package.json" <<'JSON'
{
  "name": "relay-alexa-hosted",
  "version": "0.1.0",
  "description": "Relay - My Afternoon (bundled, no runtime dependencies)",
  "main": "index.js",
  "dependencies": {}
}
JSON

cp -r skill-package "$OUT/skill-package"
# Hosted skills: Amazon owns the endpoint, so the manifest must not pin a Lambda ARN.
node -e '
const f = process.argv[1];
const m = JSON.parse(require("fs").readFileSync(f, "utf8"));
m.manifest.apis = { custom: {} };
require("fs").writeFileSync(f, JSON.stringify(m, null, 2) + "\n");
' "$OUT/skill-package/skill.json"

echo
echo "built $OUT  (backend: $RELAY_API_URL, api key: $([ -n "$RELAY_API_KEY" ] && echo set || echo none))"
echo "copy lambda/ and skill-package/ into your hosted skill's git clone, then commit+push."
