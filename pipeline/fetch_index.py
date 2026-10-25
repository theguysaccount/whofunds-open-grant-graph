#!/usr/bin/env python3
"""Build the list of 990-PF filings for one tax year from the GivingTuesday 990
Data Lake yearly index, keeping one filing per foundation (the latest submitted,
so an amended return supersedes the original).

  python3 pipeline/fetch_index.py 2023                 # -> data/work/pf_index_2023.csv
  python3 pipeline/fetch_index.py 2023 --states MA     # slice by BMF state
"""

import argparse
import csv
import os
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import RAW, WORK, ensure_dir, fmt_ein, open_text  # noqa: E402

INDEX_URL = "https://gt990datalake-rawdata.s3.amazonaws.com/Indices/990xmls/yearly/{year}_efiledata_xmls_created_on_{built}.csv"
DEFAULT_BUILT = "2026-08-25"

FIELDS = ["ein", "object_id", "org_name", "tax_year", "tax_period_begin", "tax_period_end",
          "submitted_on", "doc_status", "file_size", "url"]


def bmf_states():
    """EIN -> state from the IRS BMF files in data/raw/bmf (for slicing only)."""
    out = {}
    bdir = os.path.join(RAW, "bmf")
    for fn in sorted(os.listdir(bdir)):
        if fn.endswith(".csv"):
            with open_text(os.path.join(bdir, fn)) as f:
                for r in csv.DictReader(f):
                    out[fmt_ein(r["EIN"])] = r["STATE"]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("year")
    ap.add_argument("--built", default=DEFAULT_BUILT, help="index build date in the data lake")
    ap.add_argument("--states", default="", help="comma list of states to keep (via BMF)")
    ap.add_argument("--out", default="")
    a = ap.parse_args()

    src = os.path.join(RAW, "gt_index", f"{a.year}_index.csv")
    if not os.path.exists(src):
        ensure_dir(os.path.dirname(src))
        url = INDEX_URL.format(year=a.year, built=a.built)
        print("downloading", url, file=sys.stderr)
        urllib.request.urlretrieve(url, src)

    best = {}
    with open_text(src) as f:
        for r in csv.DictReader(f):
            if r["FormType"] != "990PF" or r["TaxYear"] != str(a.year):
                continue
            ein = fmt_ein(r["EIN"])
            key = (r["SubmittedOn"] or "", r["ReturnTs"] or "", r["ObjectId"])
            cur = best.get(ein)
            if cur is None or key > cur[0]:
                best[ein] = (key, r)

    states = {s.strip().upper() for s in a.states.split(",") if s.strip()}
    st = bmf_states() if states else {}
    out = a.out or os.path.join(WORK, f"pf_index_{a.year}{'_' + '_'.join(sorted(states)) if states else ''}.csv")
    ensure_dir(os.path.dirname(out))
    n = 0
    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        for ein in sorted(best):
            r = best[ein][1]
            if states and st.get(ein, "") not in states:
                continue
            w.writerow({
                "ein": ein, "object_id": r["ObjectId"], "org_name": r["OrganizationName"],
                "tax_year": r["TaxYear"], "tax_period_begin": r["TaxPeriodBeginDate"],
                "tax_period_end": r["TaxPeriodEndDate"], "submitted_on": r["SubmittedOn"],
                "doc_status": r["DocStatus"], "file_size": r["FileSizeBytes"], "url": r["URL"],
            })
            n += 1
    print(f"{n} foundations -> {out}", file=sys.stderr)


if __name__ == "__main__":
    main()
