#!/usr/bin/env python3
"""Collect the names organisations file under, from the GivingTuesday e-file
indexes (990, 990-EZ, 990-PF, 990-T return headers), as alternate names for the
resolver. The BMF carries one name per EIN, and sometimes the wrong one for a
health system's members ("MASS GENERAL BRIGHAM INCORPORATED" for MGH); a
return header carries the name the organisation itself filed under.

  python3 pipeline/build_names.py 2022 2023 2024   # -> data/work/efile_names.csv.gz
"""

import csv
import collections
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import RAW, WORK, ensure_dir, fmt_ein, open_text  # noqa: E402


def main():
    years = sys.argv[1:] or ["2022", "2023", "2024"]
    names = collections.defaultdict(collections.Counter)
    for y in years:
        p = os.path.join(RAW, "gt_index", f"{y}_index.csv")
        if not os.path.exists(p):
            print("missing", p, file=sys.stderr)
            continue
        with open_text(p) as f:
            for r in csv.DictReader(f):
                n = " ".join((r["OrganizationName"] or "").split())
                if n:
                    names[fmt_ein(r["EIN"])][(n.upper(), r["FormType"], y)] += 1
    out = os.path.join(ensure_dir(WORK), "efile_names.csv.gz")
    n_rows = 0
    with open_text(out, "w") as f:
        w = csv.writer(f)
        w.writerow(["ein", "name", "form", "tax_year"])
        for ein in sorted(names):
            seen = set()
            for (n, form, y), _c in sorted(names[ein].items(), key=lambda kv: kv[0][2], reverse=True):
                if n in seen:
                    continue
                seen.add(n)
                w.writerow([ein, n, form, y])
                n_rows += 1
    print(f"{len(names)} EINs, {n_rows} names -> {out}", file=sys.stderr)


if __name__ == "__main__":
    main()
