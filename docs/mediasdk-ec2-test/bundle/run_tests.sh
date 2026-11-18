#!/bin/bash
# Runs on the TEST instance only (never on production). One stitch at a time.
# Container limits: 2 CPUs, 4 GB RAM (no swap), 128 processes, NO network, no GPU, read-only root fs,
# no capabilities, non-root user, inputs mounted read-only, no ports, no production mounts or credentials.
set -u
W=/srv/test
SDK=$W/sdk/opt/MediaSDK-3.2.0-linux
IN=$W/in
OUT=$W/out
RES=$W/results
IMG=sv-mediasdk-test
EXE=/opt/MediaSDK-3.2.0-linux/bin/MediaSDKTest
mkdir -p "$RES" "$OUT" && chmod 777 "$OUT"

cgdir() { for d in "/sys/fs/cgroup/system.slice/docker-$1.scope" "/sys/fs/cgroup/docker/$1"; do [ -d "$d" ] && { echo "$d"; return; }; done; }

# {id} {input file name on disk} {output width} {stitch type} {timeout seconds}
run_case() {
  local id=$1 name=$2 w=$3 type=$4 tmo=${5:-600}
  local h=$((w / 2))
  echo "[case] $id input=$name size=${w}x${h} type=$type"
  local cid
  cid=$(docker create --name "svt_$id" \
      --cpus 2 --memory 4g --memory-swap 4g --pids-limit 128 --network none \
      --cap-drop ALL --security-opt no-new-privileges --read-only --tmpfs /tmp:rw,size=1g,mode=1777 \
      --user 10001:10001 -w /opt/MediaSDK-3.2.0-linux/bin \
      -v "$SDK":/opt/MediaSDK-3.2.0-linux:ro -v "$IN":/in:ro -v "$OUT":/out \
      "$IMG" /usr/bin/time -v -o "/out/$id.time" "$EXE" -inputs "/in/$name" -output "/out/$id.jpg" \
      -stitch_type "$type" -output_size "${w}x${h}" --log_level info) || { echo "create failed" > "$RES/$id.exit"; return 1; }
  docker start "$cid" > /dev/null
  local cg=""
  for _ in $(seq 1 60); do cg=$(cgdir "$cid"); [ -n "$cg" ] && break; sleep 0.05; done
  : > "$RES/$id.samples.csv"
  (
    while [ -n "$cg" ] && [ -d "$cg" ]; do
      pk=$(cat "$cg/memory.peak" 2>/dev/null); cu=$(cat "$cg/memory.current" 2>/dev/null)
      cpu=$(awk '/^usage_usec/{print $2}' "$cg/cpu.stat" 2>/dev/null); pids=$(cat "$cg/pids.current" 2>/dev/null)
      ma=$(awk '/MemAvailable/{print $2}' /proc/meminfo); da=$(df --output=avail -k "$W" | tail -1)
      echo "$(date +%s.%N),${pk:-},${cu:-},${cpu:-},${pids:-},$ma,$da" >> "$RES/$id.samples.csv"
      if [ "$ma" -lt 1500000 ] || [ "$da" -lt 2000000 ]; then
        echo "GUARD: host resource low (MemAvailable=${ma}kB disk=${da}kB) during $id" >> "$RES/abort.txt"
        docker kill "$cid" > /dev/null 2>&1
      fi
      sleep 0.2
    done
  ) &
  local sp=$!
  if ! timeout "$tmo" docker wait "$cid" > "$RES/$id.exit"; then docker kill "$cid" > /dev/null 2>&1; echo timeout > "$RES/$id.exit"; fi
  wait "$sp" 2> /dev/null
  docker logs "$cid" > "$RES/$id.sdklog" 2>&1
  docker inspect -f '{{.State.OOMKilled}}' "$cid" > "$RES/$id.oom" 2>&1
  docker rm "$cid" > /dev/null 2>&1
  cp "$OUT/$id.time" "$RES/" 2> /dev/null
  docker run --rm --name "svv_$id" --network none --cap-drop ALL --security-opt no-new-privileges --read-only \
      --tmpfs /tmp:rw,size=512m --user 10001:10001 --cpus 1 --memory 2g --memory-swap 2g --pids-limit 64 \
      -v "$IN":/in:ro -v "$OUT":/out:ro -v "$RES":/res:ro \
      "$IMG" python3 /opt/validate.py "/in/$name" "/out/$id.jpg" "/res/$id.sdklog" > "$RES/$id.validate.json" 2> "$RES/$id.validate.err"
  echo "[case] $id exit=$(cat "$RES/$id.exit") oom=$(cat "$RES/$id.oom") valid=$(grep -o '"output_valid": [a-z]*' "$RES/$id.validate.json")"
}

{
  echo "== date";   date -u
  echo "== uname";  uname -a
  echo "== lscpu";  lscpu | grep -E "Model name|^CPU\(s\)|Thread|MHz"
  echo "== memory"; free -m
  echo "== disk";   df -h /srv
  echo "== docker"; docker --version; docker info --format 'cgroup={{.CgroupVersion}} driver={{.CgroupDriver}} runtimes={{range $k,$v := .Runtimes}}{{$k}} {{end}}'
  echo "== gpu";    (ls /dev/nvidia* 2>&1 | head -1); (command -v nvidia-smi || echo "no nvidia-smi: no GPU on this instance")
  TOKEN=$(curl -s -X PUT -H "X-aws-ec2-metadata-token-ttl-seconds: 60" http://169.254.169.254/latest/api/token)
  echo "== instance-type"; curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-type; echo
} > "$RES/sysinfo.txt" 2>&1

# id | file | width | type | timeout
while IFS='|' read -r id name w type tmo; do
  [ -z "$id" ] && continue
  [ -f "$RES/abort.txt" ] && { echo "[abort] guard tripped, stopping"; break; }
  run_case "$id" "$name" "$w" "$type" "$tmo"
  sleep 2
done <<'CASES'
x3a_3840_optflow|x3a.insp|3840|optflow|600
x3a_7680_optflow|x3a.insp|7680|optflow|600
x3a_7680_optflow_r2|x3a.insp|7680|optflow|600
x3a_7680_optflow_r3|x3a.insp|7680|optflow|600
x3b_7680_optflow|x3b.insp|7680|optflow|600
x3c_7680_optflow|x3c.insp|7680|optflow|600
x3c_jpgname_3840_optflow|x3c.jpg|3840|optflow|600
x5_3840_optflow|x5.insp|3840|optflow|600
x5_7680_optflow|x5.insp|7680|optflow|600
x5_7680_optflow_r2|x5.insp|7680|optflow|600
x5_7680_optflow_r3|x5.insp|7680|optflow|600
x5_jpgname_3840_optflow|x5.jpg|3840|optflow|600
x3a_7680_template|x3a.insp|7680|template|600
x3a_7680_dynamicstitch|x3a.insp|7680|dynamicstitch|600
x5_7680_template|x5.insp|7680|template|600
x3a_3840_aistitch|x3a.insp|3840|aistitch|900
CASES

python3 "$W/bundle/summarize.py" "$RES" > "$RES/summary.md" 2> "$RES/summarize.err"
echo "[done] cases finished"
