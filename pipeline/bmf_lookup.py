#!/usr/bin/env python3
"""Helper for curating aliases: show BMF records whose name contains all the given
words, largest first, with their e-file names. Usage:
  python3 pipeline/bmf_lookup.py "salvation army" "leland stanford"
"""
import csv
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import RAW, WORK, fmt_ein, money, name_tokens, open_text  # noqa: E402


def main():
    queries = [set(name_tokens(q)) for q in sys.argv[1:]]
    efile = {}
    with open_text(os.path.join(WORK, "efile_names.csv.gz")) as f:
        for r in csv.DictReader(f):
            efile.setdefault(r["ein"], []).append(r["name"])
    hits = [[] for _ in queries]
    bdir = os.path.join(RAW, "bmf")
    for fn in sorted(os.listdir(bdir)):
        with open_text(os.path.join(bdir, fn)) as f:
            for r in csv.DictReader(f):
                ein = fmt_ein(r["EIN"])
                toks = set(name_tokens(r["NAME"]))
                for n in efile.get(ein, ()):
                    toks |= set(name_tokens(n))
                for qi, q in enumerate(queries):
                    if q <= toks:
                        hits[qi].append((max(money(r["REVENUE_AMT"]), money(r["INCOME_AMT"])), ein, r["NAME"],
                                         r["CITY"], r["STATE"], r["SUBSECTION"], r["FOUNDATION"], r["AFFILIATION"],
                                         "; ".join(efile.get(ein, [])[:2])))
    for q, hs in zip(sys.argv[1:], hits):
        hs.sort(reverse=True)
        print(f"== {q} ({len(hs)} records)")
        for h in hs[:6]:
            print(f"  {h[1]} rev={h[0]:>13,} {h[2][:48]:48} {h[3][:14]:14} {h[4]} sub={h[5]} fnd={h[6]} aff={h[7]} | {h[8][:70]}")


if __name__ == "__main__":
    main()
