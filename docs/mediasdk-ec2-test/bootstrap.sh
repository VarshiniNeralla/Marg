#!/bin/bash
# Boot script for the TEMPORARY MediaSDK test instance. Downloads inputs with presigned URLs (valid only a few
# minutes), builds the test image, runs the tests, prints the report to the serial console (read back with
# `aws ec2 get-console-output`), then powers off (shutdown behaviour = terminate).
# No IAM role, no inbound access, no production access, no credentials of any kind on this machine.
exec > /var/log/mediasdk-test.log 2>&1
set -u
# shellcheck disable=SC1091
source /root/config.env
W=/srv/test
mkdir -p "$W"/{in,out,sdk,bundle,results}

con() { echo "[svtest] $(date -u +%H:%M:%S) $*" > /dev/console; echo "[svtest] $(date -u +%H:%M:%S) $*"; }
heartbeat_then_poweroff() {  # keep the report readable for a while, then terminate
  for i in $(seq 1 15); do con "heartbeat $i/15 - report above; instance terminates after this"; sleep 60; done
  shutdown -h now
}
report() {
  {
    echo "===SVTEST-REPORT-BEGIN==="
    echo "--- sysinfo"; cat "$W/results/sysinfo.txt" 2> /dev/null
    echo "--- guard"; cat "$W/results/abort.txt" 2> /dev/null || echo "no host guard tripped"
    echo "--- summary"; cat "$W/results/summary.md" 2> /dev/null
    echo "--- results.jsonl"; cat "$W/results/results.jsonl" 2> /dev/null
    echo "--- sample sdk log x3a_7680_optflow (first 45 lines)"; head -45 "$W/results/x3a_7680_optflow.sdklog" 2> /dev/null
    echo "--- sample sdk log x5_7680_optflow (first 45 lines)"; head -45 "$W/results/x5_7680_optflow.sdklog" 2> /dev/null
    echo "--- disk after test"; df -h /srv | tail -1
    echo "===SVTEST-REPORT-END==="
  } > /root/report.txt
  # the serial console is a small ring buffer: write in chunks
  split -l 40 /root/report.txt /root/report.part.
  for p in /root/report.part.*; do cat "$p" > /dev/console; sleep 0.3; done
}
fail() {
  con "FAILED: $1"
  { echo "---- last 40 lines of bootstrap log"; tail -40 /var/log/mediasdk-test.log; } | cut -c1-200 > /dev/console
  report
  heartbeat_then_poweroff
  exit 1
}

con "boot ok; instance running bootstrap"
dnf install -y docker > /var/log/dnf-docker.log 2>&1 || fail "docker install"
systemctl start docker || fail "docker start"
con "docker ready: $(docker --version)"

curl -fsS "$BUNDLE_GET_URL" -o /root/bundle.tgz || fail "download bundle"
tar xzf /root/bundle.tgz -C "$W/bundle" || fail "unpack bundle"
for f in x3a x3b x3c x5; do
  curl -fsS "$(eval echo \$GET_${f})" -o "$W/in/$f.insp" || fail "download $f"
done
for f in x3a x3b x3c x5; do
  want=$(eval echo \$SHA_${f}); got=$(sha256sum "$W/in/$f.insp" | cut -d' ' -f1)
  [ "$want" = "$got" ] || fail "checksum mismatch for $f"
done
# JPEG-named captures: byte-identical copies of the originals under a .jpg name (no conversion)
cp "$W/in/x3c.insp" "$W/in/x3c.jpg"; cp "$W/in/x5.insp" "$W/in/x5.jpg"
chmod -R a+rX "$W/in"
con "inputs downloaded and sha256-verified"

curl -fsS "$DEB_GET_URL" -o "$W/sdk.deb" || fail "download sdk deb"
[ "$(sha256sum "$W/sdk.deb" | cut -d' ' -f1)" = "$SHA_DEB" ] || fail "sdk deb checksum mismatch"
con "sdk package downloaded and sha256-verified ($(du -h "$W/sdk.deb" | cut -f1))"

docker build -t sv-mediasdk-test "$W/bundle" > /var/log/docker-build.log 2>&1 || { tail -30 /var/log/docker-build.log | cut -c1-200 > /dev/console; fail "image build"; }
con "test image built"

# Extract the unmodified official .deb (what `dpkg -i` installs to /opt/MediaSDK-3.2.0-linux); postinst only prints text.
docker run --rm --user 0 --network none -v "$W":/w sv-mediasdk-test dpkg-deb -x /w/sdk.deb /w/sdk || fail "sdk extract"
chmod -R a+rX "$W/sdk"
[ -x "$W/sdk/opt/MediaSDK-3.2.0-linux/bin/MediaSDKTest" ] || fail "MediaSDKTest missing after extract"
con "sdk extracted: $(du -sh "$W/sdk" | cut -f1); disk free: $(df -h /srv | tail -1 | awk '{print $4}')"

con "running tests (one stitch at a time, 2 cpu / 4 GB / 128 pids / no network)"
bash "$W/bundle/run_tests.sh" 2>&1 | while IFS= read -r l; do con "$l"; done
con "tests finished"
report
heartbeat_then_poweroff
