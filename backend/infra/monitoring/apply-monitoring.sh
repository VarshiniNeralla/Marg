#!/bin/bash
# Turns on SiteVision monitoring on the production EC2 instance. Run it as root on the instance (for example with
# SSM Run Command) AFTER the sitevision-monitoring CloudFormation stack exists, because the log groups must exist first.
#
#   usage: apply-monitoring.sh <image-tag>      e.g. apply-monitoring.sh v5
#
# What it does (all idempotent):
#   1. installs the CloudWatch agent and rsyslog (Amazon Linux 2023 has no /var/log/messages without it, and the
#      kernel "Out of memory: Killed process" lines are how out-of-memory kills are detected)
#   2. configures the agent: memory, swap and disk metrics (namespace CWAgent) plus /var/log/messages -> /sitevision/system
#   3. makes Caddy write one JSON access log line per request, with secrets scrubbed from the URL and headers
#   4. makes start.sh run the three containers with the Docker awslogs driver (non-blocking) and restarts them
set -euo pipefail

TAG="${1:?usage: apply-monitoring.sh <image-tag>}"
REGION=ap-south-1
DIR=/opt/sitevision

echo "[1/4] installing agent and rsyslog"
dnf -y install amazon-cloudwatch-agent rsyslog
systemctl enable --now rsyslog

echo "[2/4] configuring the CloudWatch agent"
cat > /opt/aws/amazon-cloudwatch-agent/etc/sitevision-agent.json <<'JSON'
{
  "agent": { "metrics_collection_interval": 60, "run_as_user": "root" },
  "metrics": {
    "namespace": "CWAgent",
    "append_dimensions": { "InstanceId": "${aws:InstanceId}" },
    "metrics_collected": {
      "mem":  { "measurement": ["mem_used_percent", "mem_available"] },
      "swap": { "measurement": ["swap_used_percent"] },
      "disk": { "measurement": ["disk_used_percent"], "resources": ["/"], "drop_device": true }
    }
  },
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          { "file_path": "/var/log/messages", "log_group_name": "/sitevision/system", "log_stream_name": "{instance_id}/messages", "timezone": "UTC" },
          { "file_path": "/var/log/sitevision-bootstrap.log", "log_group_name": "/sitevision/system", "log_stream_name": "{instance_id}/bootstrap", "timezone": "UTC" }
        ]
      }
    }
  }
}
JSON
/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -s -c file:/opt/aws/amazon-cloudwatch-agent/etc/sitevision-agent.json

echo "[3/4] enabling the Caddy access log"
if ! grep -q 'format filter' "$DIR/Caddyfile"; then
  BAK="$DIR/Caddyfile.bak.$(date +%s)"
  cp "$DIR/Caddyfile" "$BAK"
  # Insert a log block right after the site address line. Media URLs can carry ?access_token= and ?sig= and the
  # Authorization / Cookie headers carry credentials, so all of them are removed before anything is logged.
  awk '
    { print }
    !done && /\{[[:space:]]*$/ {
      print "    log {"
      print "        output stdout"
      print "        format filter {"
      print "            wrap json"
      print "            request>headers>Authorization delete"
      print "            request>headers>Cookie delete"
      print "            resp_headers>Set-Cookie delete"
      print "            request>uri query {"
      print "                delete access_token"
      print "                delete token"
      print "                replace sig REDACTED"
      print "            }"
      print "        }"
      print "    }"
      done = 1
    }' "$BAK" > "$DIR/Caddyfile.new"
  mv "$DIR/Caddyfile.new" "$DIR/Caddyfile"
fi

echo "[4/4] shipping container logs with the awslogs driver and restarting the containers"
if ! grep -q awslogs "$DIR/start.sh"; then
  cp "$DIR/start.sh" "$DIR/start.sh.bak.$(date +%s)"
  for n in backend frontend caddy; do
    sed -i "s|docker run -d --name sv-$n |docker run -d --name sv-$n --log-driver awslogs --log-opt awslogs-region=$REGION --log-opt awslogs-group=/sitevision/$n --log-opt tag={{.Name}} --log-opt mode=non-blocking --log-opt max-buffer-size=25m |" "$DIR/start.sh"
  done
  grep -c awslogs "$DIR/start.sh" | grep -qx 3 || { echo "start.sh patch did not apply to all three containers"; exit 1; }
fi
"$DIR/start.sh" "$TAG"

echo "verify:"
systemctl is-active amazon-cloudwatch-agent
for n in sv-backend sv-frontend sv-caddy; do echo "$n $(docker inspect -f '{{.HostConfig.LogConfig.Type}}' $n)"; done
