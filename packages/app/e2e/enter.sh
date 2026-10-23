#!/bin/sh
# Enter XR in IWER, switch to hand input, wait until the room is built.
cd "$(dirname "$0")/.."
npx iwsdk xr enter > /dev/null 2>&1
npx iwsdk xr set-input-mode --input-json '{"mode":"hand"}' > /dev/null 2>&1
for i in 1 2 3 4 5 6 7 8 9 10; do
  m=$(npx iwsdk browser run e2e/state.mjs 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['result'].get('mode'))" 2>/dev/null)
  [ "$m" != "scanning" ] && [ "$m" != "idle" ] && [ -n "$m" ] && echo "mode=$m" && exit 0
  sleep 2
done
echo "room not built (mode=$m)"; exit 1
