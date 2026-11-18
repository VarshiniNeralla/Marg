"""Merge per-case results into results.jsonl + a markdown table (host python, stdlib only)."""
import glob
import json
import os
import re
import sys

res = sys.argv[1]


def read(p, default=""):
    try:
        return open(p, errors="replace").read().strip()
    except OSError:
        return default


def time_v(txt):
    d = {}
    m = re.search(r"Elapsed \(wall clock\) time.*?:\s*([0-9:.]+)", txt)
    if m:
        parts = [float(x) for x in m.group(1).split(":")]
        d["wall_s"] = round(sum(v * 60 ** i for i, v in enumerate(reversed(parts))), 2)
    for key, rx in (("user_s", r"User time \(seconds\):\s*([0-9.]+)"), ("sys_s", r"System time \(seconds\):\s*([0-9.]+)"),
                    ("max_rss_mb", r"Maximum resident set size \(kbytes\):\s*([0-9]+)"), ("exit_in_time", r"Exit status:\s*([0-9]+)")):
        m = re.search(rx, txt)
        if m:
            v = float(m.group(1))
            d[key] = round(v / 1024, 1) if key == "max_rss_mb" else v
    return d


def samples(path):
    rows = []
    for line in read(path).splitlines():
        p = line.split(",")
        if len(p) == 7 and p[0]:
            try:
                rows.append([float(x) if x else None for x in p])
            except ValueError:
                pass
    d = {}
    if rows:
        peaks = [r[1] for r in rows if r[1]]
        d["cgroup_peak_mem_mb"] = round(max(peaks) / 1048576, 1) if peaks else None
        d["peak_pids"] = int(max((r[4] or 0) for r in rows))
        d["host_min_mem_available_mb"] = round(min(r[5] for r in rows if r[5]) / 1024)
        d["host_min_disk_avail_gb"] = round(min(r[6] for r in rows if r[6]) / 1048576, 1)
        cpu = [(r[0], r[3]) for r in rows if r[3] is not None]
        if len(cpu) >= 2 and cpu[-1][0] > cpu[0][0]:
            d["avg_cpu_cores"] = round((cpu[-1][1] - cpu[0][1]) / 1e6 / (cpu[-1][0] - cpu[0][0]), 2)
        d["n_samples"] = len(rows)
    return d


out = []
for exitf in sorted(glob.glob(os.path.join(res, "*.exit"))):
    cid = os.path.basename(exitf)[:-5]
    row = {"case": cid, "exit_code": read(exitf), "oom_killed": read(os.path.join(res, cid + ".oom"))}
    row.update(time_v(read(os.path.join(res, cid + ".time"))))
    row.update(samples(os.path.join(res, cid + ".samples.csv")))
    try:
        row.update(json.loads(read(os.path.join(res, cid + ".validate.json"), "{}")))
    except ValueError:
        row["validate_error"] = read(os.path.join(res, cid + ".validate.err"))[:200]
    out.append(row)
with open(os.path.join(res, "results.jsonl"), "w") as f:
    for r in out:
        f.write(json.dumps(r) + "\n")

print("| case | model | in MB | exit | wall s | peak RSS MB | cgroup peak MB | avg cores | out dims | out MB | valid | SDK reported CPU |")
print("|---|---|---|---|---|---|---|---|---|---|---|---|")
for r in out:
    print("| {case} | {m} | {inmb} | {exit_code} | {w} | {rss} | {cg} | {cpu} | {dims} | {omb} | {valid} | {cpurep} |".format(
        case=r["case"], m=r.get("camera_model", "?"), inmb=round(r.get("input_bytes", 0) / 1048576, 1), exit_code=r["exit_code"],
        w=r.get("wall_s", "?"), rss=r.get("max_rss_mb", "?"), cg=r.get("cgroup_peak_mem_mb", "?"), cpu=r.get("avg_cpu_cores", "?"),
        dims=r.get("output_dims", "-"), omb=round(r.get("output_bytes", 0) / 1048576, 2), valid=r.get("output_valid", "?"),
        cpurep=r.get("sdk_reported_cpu", "?")))
