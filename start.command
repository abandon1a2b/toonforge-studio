#!/bin/sh
set -eu
APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "$APP_DIR/toonforge" --root "${TOONFORGE_ROOT:-/Users/one/Desktop/toonforge}" serve --port "${TOONFORGE_PORT:-8795}"
