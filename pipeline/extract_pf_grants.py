#!/usr/bin/env python3
"""Extract every Form 990-PF Part XV grant line from e-filed XML.

  python3 pipeline/extract_pf_grants.py data/work/pf_index_2023.csv 200000 data/work/pf_grants.csv.gz

Writes the grant lines to the output path and one row per filing to
<output>_filers.csv.gz. XML is fetched anonymously from the GivingTuesday 990
Data Lake and cached gzipped under data/raw/xml/.

Privacy by design: when a filer lists a natural person (RecipientPersonNm), the
person's name, street address and purpose are dropped here and never written;
only state/country and the amount survive, for the out-of-scope totals.
"""

import argparse
import csv
import gzip
import multiprocessing as mp
import os
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import PLACEHOLDER_PERSONS, RAW, ensure_dir, fmt_ein, is_placeholder, money, open_text  # noqa: E402

XML_CACHE = os.path.join(RAW, "xml")

GRANT_FIELDS = [
    "filer_ein", "object_id", "tax_year", "tax_period_end", "section", "line_no",
    "recipient_kind", "recipient_name", "recipient_name2", "addr1", "addr2", "city", "state",
    "zip", "country", "foreign", "relationship", "foundation_status", "purpose", "amount",
]
FILER_FIELDS = [
    "filer_ein", "object_id", "name", "name2", "addr1", "city", "state", "zip", "country",
    "tax_year", "tax_period_begin", "tax_period_end", "return_ts", "submitted_on", "doc_status",
    "fmv_assets_eoy", "contrib_paid_part1", "total_paid_stated", "total_future_stated",
    "n_paid_lines", "n_future_lines", "sum_paid_lines", "sum_future_lines", "n_person_lines",
    "preselected_only", "app_form", "app_deadlines", "app_restrictions", "website", "parse_error",
]


def cache_path(object_id):
    return os.path.join(XML_CACHE, object_id[-3:], object_id + ".xml.gz")


def fetch(object_id, url, retries=5):
    p = cache_path(object_id)
    if os.path.exists(p):
        with gzip.open(p, "rb") as f:
            return f.read()
    last = None
    for i in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                data = r.read()
            ensure_dir(os.path.dirname(p))
            tmp = p + ".tmp%d" % os.getpid()
            with gzip.open(tmp, "wb", compresslevel=5) as f:
                f.write(data)
            os.replace(tmp, p)
            return data
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:  # noqa: PERF203
            last = e
            time.sleep(1.5 * (i + 1))
    raise RuntimeError(f"fetch failed {object_id}: {last}")


def strip_ns(root):
    for el in root.iter():
        if isinstance(el.tag, str) and "}" in el.tag:
            el.tag = el.tag.split("}", 1)[1]
    return root


def txt(el, path):
    if el is None:
        return ""
    x = el.find(path)
    return " ".join((x.text or "").split()) if x is not None and x.text else ""


def address(el):
    """(addr1, addr2, city, state, zip, country, foreign) for a recipient/filer element."""
    us = el.find("RecipientUSAddress")
    if us is None:
        us = el.find("USAddress")
    if us is not None:
        return (txt(us, "AddressLine1Txt"), txt(us, "AddressLine2Txt"), txt(us, "CityNm"),
                txt(us, "StateAbbreviationCd"), txt(us, "ZIPCd"), "US", "0")
    fo = el.find("RecipientForeignAddress")
    if fo is None:
        fo = el.find("ForeignAddress")
    if fo is not None:
        return (txt(fo, "AddressLine1Txt"), txt(fo, "AddressLine2Txt"), txt(fo, "CityNm"),
                txt(fo, "ProvinceOrStateNm"), txt(fo, "ForeignPostalCd"), txt(fo, "CountryCd") or "XX", "1")
    return ("", "", "", "", "", "", "0")


def parse(xml_bytes, idx):
    root = strip_ns(ET.fromstring(xml_bytes))
    hdr = root.find("ReturnHeader")
    filer = hdr.find("Filer") if hdr is not None else None
    pf = root.find("ReturnData/IRS990PF")
    ein = fmt_ein(txt(filer, "EIN") or idx["ein"])
    oid = idx["object_id"]
    tax_year = txt(hdr, "TaxYr") or idx.get("tax_year", "")
    tpe = txt(hdr, "TaxPeriodEndDt") or idx.get("tax_period_end", "")
    f_addr = address(filer) if filer is not None else ("",) * 7
    supp = pf.find("SupplementaryInformationGrp") if pf is not None else None

    grants = []
    sums = {"paid": [0, 0], "future": [0, 0]}
    n_person = 0
    if supp is not None:
        for section, tag in (("paid", "GrantOrContributionPdDurYrGrp"), ("future", "GrantOrContriApprvForFutGrp")):
            for i, g in enumerate(supp.findall(tag)):
                amt = money(txt(g, "Amt"))
                sums[section][0] += 1
                sums[section][1] += amt
                a1, a2, city, state, z, country, foreign = address(g)
                person = g.find("RecipientPersonNm") is not None and g.find("RecipientBusinessName") is None
                if person:
                    n_person += 1
                    # "GRANTS" / "VARIOUS" / "SEE ATTACHED" typed into the person field is a placeholder,
                    # not a person; it is kept as unitemized (still without any name).
                    pn = txt(g, "RecipientPersonNm")
                    kind = "person"
                    if is_placeholder(pn) or "SEE ATTACH" in (a1 + " " + a2).upper():
                        # "VARIOUS PATIENTS" is still people; "GRANTS / SEE ATTACHED" is not.
                        purpose_up = txt(g, "GrantOrContributionPurposeTxt").upper()
                        kind = "person" if PLACEHOLDER_PERSONS.search(pn.upper() + " " + purpose_up) else "placeholder"
                    grants.append({
                        "filer_ein": ein, "object_id": oid, "tax_year": tax_year, "tax_period_end": tpe,
                        "section": section, "line_no": i, "recipient_kind": kind,
                        "recipient_name": "", "recipient_name2": "", "addr1": "", "addr2": "", "city": "",
                        "state": state, "zip": "", "country": country, "foreign": foreign,
                        "relationship": "", "foundation_status": txt(g, "RecipientFoundationStatusTxt")[:40],
                        "purpose": "", "amount": amt,
                    })
                    continue
                grants.append({
                    "filer_ein": ein, "object_id": oid, "tax_year": tax_year, "tax_period_end": tpe,
                    "section": section, "line_no": i, "recipient_kind": "business",
                    "recipient_name": txt(g, "RecipientBusinessName/BusinessNameLine1Txt"),
                    "recipient_name2": txt(g, "RecipientBusinessName/BusinessNameLine2Txt"),
                    "addr1": a1, "addr2": a2, "city": city, "state": state, "zip": z, "country": country,
                    "foreign": foreign, "relationship": txt(g, "RecipientRelationshipTxt")[:80],
                    "foundation_status": txt(g, "RecipientFoundationStatusTxt")[:40],
                    "purpose": txt(g, "GrantOrContributionPurposeTxt")[:300], "amount": amt,
                })

    app = supp.find("ApplicationSubmissionInfoGrp") if supp is not None else None
    filer_row = {
        "filer_ein": ein, "object_id": oid,
        "name": txt(filer, "BusinessName/BusinessNameLine1Txt") or idx.get("org_name", ""),
        "name2": txt(filer, "BusinessName/BusinessNameLine2Txt"),
        "addr1": f_addr[0], "city": f_addr[2], "state": f_addr[3], "zip": f_addr[4], "country": f_addr[5],
        "tax_year": tax_year, "tax_period_begin": txt(hdr, "TaxPeriodBeginDt") or idx.get("tax_period_begin", ""),
        "tax_period_end": tpe, "return_ts": txt(hdr, "ReturnTs"), "submitted_on": idx.get("submitted_on", ""),
        "doc_status": idx.get("doc_status", ""),
        "fmv_assets_eoy": money(txt(pf, "FMVAssetsEOYAmt")),
        "contrib_paid_part1": money(txt(pf, "AnalysisOfRevenueAndExpenses/ContriPaidRevAndExpnssAmt")),
        "total_paid_stated": money(txt(supp, "TotalGrantOrContriPdDurYrAmt")),
        "total_future_stated": money(txt(supp, "TotalGrantOrContriApprvFutAmt")),
        "n_paid_lines": sums["paid"][0], "n_future_lines": sums["future"][0],
        "sum_paid_lines": sums["paid"][1], "sum_future_lines": sums["future"][1],
        "n_person_lines": n_person,
        "preselected_only": "1" if txt(supp, "OnlyContriToPreselectedInd") else "0",
        # Application instructions are published; the contact person's name, phone and
        # e-mail (RecipientPersonNm / RecipientPhoneNum / RecipientEmailAddressTxt) are not.
        "app_form": txt(app, "FormAndInfoAndMaterialsTxt")[:500],
        "app_deadlines": txt(app, "SubmissionDeadlinesTxt")[:300],
        "app_restrictions": txt(app, "RestrictionsOnAwardsTxt")[:500],
        "website": txt(pf, "StatementsRegardingActyGrp/WebsiteAddressTxt")[:200],
        "parse_error": "",
    }
    return filer_row, grants


def work(idx):
    try:
        data = fetch(idx["object_id"], idx["url"])
    except Exception as e:  # noqa: BLE001
        return None, [], f"FETCH {idx['object_id']}: {e}"
    try:
        f, g = parse(data, idx)
        return f, g, ""
    except Exception as e:  # noqa: BLE001
        return None, [], f"PARSE {idx['object_id']}: {e}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("index_csv")
    ap.add_argument("limit", type=int)
    ap.add_argument("out")
    ap.add_argument("--workers", type=int, default=32)
    a = ap.parse_args()

    with open_text(a.index_csv) as f:
        rows = list(csv.DictReader(f))[: a.limit]
    # Largest files first so the long tail of the pool isn't one 200 MB return.
    rows.sort(key=lambda r: -int(r.get("file_size") or 0))
    filers_out = a.out.replace(".csv.gz", "") + "_filers.csv.gz"
    ensure_dir(os.path.dirname(os.path.abspath(a.out)))
    t0 = time.time()
    n_lines = 0
    errors = []
    with open_text(a.out, "w") as gf, open_text(filers_out, "w") as ff:
        gw = csv.DictWriter(gf, fieldnames=GRANT_FIELDS)
        fw = csv.DictWriter(ff, fieldnames=FILER_FIELDS)
        gw.writeheader()
        fw.writeheader()
        with mp.get_context("fork").Pool(a.workers) as pool:
            for i, (frow, grants, err) in enumerate(pool.imap_unordered(work, rows, chunksize=4), 1):
                if err:
                    errors.append(err)
                    continue
                fw.writerow(frow)
                gw.writerows(grants)
                n_lines += len(grants)
                if i % 2000 == 0:
                    print(f"  {i}/{len(rows)} filings, {n_lines} lines, {time.time()-t0:.0f}s", file=sys.stderr)
    print(f"done: {len(rows)-len(errors)} filings, {n_lines} grant lines, {len(errors)} errors, "
          f"{time.time()-t0:.0f}s -> {a.out}", file=sys.stderr)
    if errors:
        with open(a.out.replace(".csv.gz", "") + "_errors.txt", "w") as f:
            f.write("\n".join(errors))
        print("first errors:", errors[:5], file=sys.stderr)


if __name__ == "__main__":
    main()
