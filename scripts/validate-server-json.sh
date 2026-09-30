#!/bin/sh
set -eu
file="${1:-server.json}"
schema_url="https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json"
dir="$(mktemp -d)"
trap 'rm -rf "$dir"' EXIT INT TERM
curl -fsSL -o "$dir/server.schema.json" "$schema_url"
npx -y -p ajv-cli@5 ajv validate --spec=draft7 --strict=false -s "$dir/server.schema.json" -d "$file"
