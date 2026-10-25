#!/usr/bin/env python3
"""Source checks for the scheduled refresh (see .github/workflows/refresh.yml).

  python3 pipeline/sources.py check [previous_sources.json]
      Fingerprints the public inputs: the GivingTuesday data-lake yearly indexes, the IRS
      BMF files, and this pipeline's own code. Prints `changed=` and `year=` lines (for
      $GITHUB_OUTPUT) and writes data/work/sources.json.
  python3 pipeline/sources.py download --year 2023
      Downloads the BMF and the indexes for year-1..year+1, then builds the 990-PF index
      (fetch_index.py) and the e-file name table (build_names.py).
  python3 pipeline/sources.py guard previous_stats.json new_stats.json
      Refuses to publish a rebuild that looks broken next to the last good release.

The tax year is the newest one whose index is at least 90% the size of the year
before it, so the site moves to TY2024 on its own once those filings are mostly in.
"""

import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import RAW, ROOT, WORK, ensure_dir  # noqa: E402

GT = "https://gt990datalake-rawdata.s3.amazonaws.com"
BMF = "https://www.irs.gov/pub/irs-soi/eo{i}.csv"
UA = {"User-Agent": "whofunds-refresh (+https://github.com/theguysaccount/whofunds-open-grant-graph)"}
COMPLETE = 0.90


def http(url, method="GET", retries=4):
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, method=method, headers=UA)
            return urllib.request.urlopen(req, timeout=120)
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(3 * (i + 1))
    raise RuntimeError(f"{method} {url}: {last}")


def list_indexes():
    """{tax_year: (built_date, key, size)} for the newest index build of each year."""
    out = {}
    token = ""
    while True:
        url = f"{GT}/?list-type=2&prefix=Indices/990xmls/yearly/" + (f"&continuation-token={urllib.request.quote(token)}" if token else "")
        body = http(url).read().decode()
        for key, size in re.findall(r"<Key>([^<]+)</Key>.*?<Size>(\d+)</Size>", body):
            m = re.search(r"/(\d{4})_efiledata_xmls_created_on_(\d{4}-\d{2}-\d{2})\.csv$", key)
            if m:
                y, built = int(m.group(1)), m.group(2)
                if y not in out or built > out[y][0]:
                    out[y] = (built, key, int(size))
        m = re.search(r"<NextContinuationToken>([^<]+)</NextContinuationToken>", body)
        if not m:
            return out
        token = m.group(1)


def pick_year(idx):
    for y in sorted(idx, reverse=True):
        if y - 1 in idx and idx[y][2] >= COMPLETE * idx[y - 1][2]:
            return y
    return max(idx)


def code_hash():
    h = hashlib.sha256()
    d = os.path.join(ROOT, "pipeline")
    for fn in sorted(os.listdir(d)):
        if fn.endswith((".py", ".csv", ".txt")):
            with open(os.path.join(d, fn), "rb") as f:
                h.update(fn.encode() + f.read())
    return h.hexdigest()[:16]


def fingerprint():
    idx = list_indexes()
    year = pick_year(idx)
    bmf = {}
    for i in range(1, 5):
        r = http(BMF.format(i=i), method="HEAD")
        bmf[f"eo{i}"] = r.headers.get("Last-Modified", "") + "|" + r.headers.get("Content-Length", "")
    return {
        "year": year,
        "pf_index": idx[year][1], "pf_index_size": idx[year][2],
        "name_indexes": [idx[y][1] for y in (year - 1, year, year + 1) if y in idx],
        "bmf": bmf, "code": code_hash(),
    }


def check(prev_path):
    fp = fingerprint()
    ensure_dir(WORK)
    with open(os.path.join(WORK, "sources.json"), "w") as f:
        json.dump(fp, f, indent=1)
    prev = {}
    if prev_path and os.path.exists(prev_path):
        with open(prev_path) as f:
            prev = json.load(f)
    changed = fp != prev
    print(f"changed={'true' if changed else 'false'}")
    print(f"year={fp['year']}")
    print(json.dumps(fp), file=sys.stderr)


def fetch(url, dest):
    ensure_dir(os.path.dirname(dest))
    tmp = dest + ".part"
    with http(url) as r, open(tmp, "wb") as f:
        while True:
            b = r.read(1 << 20)
            if not b:
                break
            f.write(b)
    os.replace(tmp, dest)
    print(f"  {url} -> {dest} ({os.path.getsize(dest) / 1e6:.0f} MB)", file=sys.stderr)


def download(year):
    idx = list_indexes()
    for i in range(1, 5):
        fetch(BMF.format(i=i), os.path.join(RAW, "bmf", f"eo{i}.csv"))
    years = [y for y in (year - 1, year, year + 1) if y in idx]
    for y in years:
        fetch(f"{GT}/{idx[y][1]}", os.path.join(RAW, "gt_index", f"{y}_index.csv"))
    py = sys.executable
    subprocess.run([py, os.path.join(ROOT, "pipeline", "fetch_index.py"), str(year), "--built", idx[year][0]], check=True)
    subprocess.run([py, os.path.join(ROOT, "pipeline", "build_names.py"), *map(str, years)], check=True)


def guard(prev_path, new_path):
    with open(new_path) as f:
        new = json.load(f)
    problems = []
    lines, res = new["paid_lines"], new["scopes"]["resolved"][0]
    if lines < 1_000_000:
        problems.append(f"only {lines} paid grant lines")
    if res / max(1, lines) < 0.40:
        problems.append(f"resolution {res / max(1, lines):.1%} of lines is below 40%")
    if prev_path and os.path.exists(prev_path):
        with open(prev_path) as f:
            prev = json.load(f)
        if str(prev.get("year")) == str(new.get("year")):
            for label, a, b, tol in (
                ("paid grant lines", prev["paid_lines"], lines, 0.20),
                ("resolved lines", prev["scopes"]["resolved"][0], res, 0.15),
                ("foundations", prev["foundations"], new["foundations"], 0.15),
            ):
                if b < a * (1 - tol):
                    problems.append(f"{label} fell from {a} to {b}")
            ps = prev["scopes"]["resolved"][0] / max(1, prev["paid_lines"])
            if res / max(1, lines) < ps - 0.05:
                problems.append(f"resolution share fell from {ps:.1%} to {res / lines:.1%}")
    if problems:
        print("GUARD FAILED: " + "; ".join(problems), file=sys.stderr)
        sys.exit(1)
    print("guard ok", file=sys.stderr)


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "check":
        check(sys.argv[2] if len(sys.argv) > 2 else "")
    elif cmd == "download":
        download(int(sys.argv[sys.argv.index("--year") + 1]))
    elif cmd == "guard":
        guard(sys.argv[2], sys.argv[3])
    else:
        print(__doc__)
        sys.exit(2)
