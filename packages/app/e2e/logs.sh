#!/bin/sh
# Print the last N browser console lines compactly (level + first 300 chars).
cd "$(dirname "$0")/.." && npx iwsdk browser logs --input-json "{\"count\":${1:-30}}" 2>&1 | python3 -c "
import json,sys
d=json.load(sys.stdin)
r=d.get('data',{}).get('result',d)
logs=r.get('logs',r) if isinstance(r,dict) else r
for l in (logs if isinstance(logs,list) else []):
  m=str(l.get('message', l.get('text')))
  if 'IWSDK Dev' in m or m.startswith(' ') or '▄' in m: continue
  print(l.get('level'), m[:300].replace('\n',' | '))
"
