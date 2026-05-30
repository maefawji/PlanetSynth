#!/bin/zsh
set -e

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT=5188
URL="http://127.0.0.1:${PORT}/"

cd "$APP_DIR"

echo "Starting Modular Geometry Synth"
echo "Directory: $APP_DIR"
echo "URL:       $URL"
echo ""

if [ ! -d "$APP_DIR/node_modules" ]; then
  echo "node_modules is missing. Installing dependencies..."
  npm install
fi

if command -v lsof >/dev/null 2>&1 && lsof -iTCP:${PORT} -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port ${PORT} is already in use."
  echo "This app is separated from the OSM app and expects ${URL}."
  echo "Stop the process using port ${PORT}, then run this command again."
  read "unused?Press return to close..."
  exit 1
fi

npm run dev -- --host 127.0.0.1 --port "$PORT" --strictPort &
SERVER_PID=$!

cleanup() {
  kill "$SERVER_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

echo "Waiting for Vite..."
for _ in {1..80}; do
  if curl -fsS "$URL" >/dev/null 2>&1; then
    open "$URL"
    echo "Opened $URL"
    echo "Keep this window open while using the app."
    wait "$SERVER_PID"
    exit $?
  fi
  sleep 0.25
done

echo "Vite did not become ready in time."
exit 1
