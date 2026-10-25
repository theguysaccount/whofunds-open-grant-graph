#!/usr/bin/env python3
"""Turn resolved grant lines into everything the site and the open-data release need.

  python3 pipeline/build_site.py data/work/ty2023 --year 2023

Reads  <dir>/pf_grants_resolved.csv.gz, <dir>/pf_grants_filers.csv.gz, the BMF and
       data/work/efile_names.csv.gz
Writes site/data/org/NNN.json.gz      organisation records (who funds them, peers, prospects)
       site/data/fdn/NNN.json.gz      foundation records (where the money went)
       site/data/names.json.gz        every org + foundation name (pages and search share it)
       site/data/stats.json           headline numbers and tables, all computed here
       site/data/fixit.json           top refused matches for the public fix-it queue
       site/public/sitemap*.xml, robots.txt
       data/release/*.csv.gz          the CC0 release (published lines only; no individuals)
"""

import argparse
import collections
import csv
import gzip
import hashlib
import json
import math
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (  # noqa: E402
    GT_XML_URL, PROPUBLICA_FILING_URL, RAW, RELEASE, ROOT, WORK, display_filed_name, ensure_dir, fmt_ein,
    money, name_tokens, open_text,
)

SITE = os.path.join(ROOT, "site")
SITE_DATA = os.path.join(SITE, "data")
PUBLIC = os.path.join(SITE, "public")
SCOPES = ("resolved", "unmatched", "individual", "foreign", "unitemized")
MEGA_FUNDER = 3000      # recipients; above this a funder says nothing about similarity
FDN_LINES_MAX = 2000    # lines kept per foundation record (the CSV release has every line)
CODES = {"ADDR_EXACT_NAME": "A", "ADDR_CONTAINMENT": "C", "ZIP5": "Z", "CITY_STATE": "S", "ALIAS": "L",
         "NAME_EXACT_NATIONAL": "N", "NAME_TOKEN": "T", "EIN_IN_TEXT": "E"}

SMALL = {"OF", "AND", "THE", "FOR", "IN", "AT", "ON", "TO", "A", "AN", "BY", "WITH", "FROM", "DE", "LA", "DEL", "Y", "OR"}
ACRONYMS = set("""YMCA YWCA YMHA YWHA NAACP ACLU USA US PTA PTO PTSA PTSO SPCA ASPCA NPR PBS WGBH WBUR WNET KQED WNYC
MIT UCLA NYU UCSF USC UNC LSU SMU TCU BYU CUNY SUNY AIDS HIV LGBT LGBTQ LGBTQIA STEM VFW NAMI JCC UJA ADL UNICEF
UNCF CEO NFL NBA MLB NHL NCAA YWCA ALS MS CF ARC AARP KIPP IDEA TED RSVP FIRST UN WWF NRDC EDF IRC CRS HFH HFHI
II III IV VI VII VIII IX XI NY NYC LA DC SF USO PFLAG GLSEN NARAL IJM ONE CARE AJC JDC HIAS ORT AIPAC JNF ZOA""".split())


def nice_name(s):
    """Readable display casing for an all-caps filed or registered name."""
    s = " ".join((s or "").split())
    if not s:
        return s
    if re.search(r"[a-z]", s) and re.search(r"[A-Z]", s):
        return re.sub(r",?\s+(Inc|Incorporated|LLC|Ltd|NFP)\.?$", "", s, flags=re.I)
    s = re.sub(r"^\s*(\(\d{1,5}\)|\d{1,5}[.)])\s*", "", s)
    out = []
    for i, w in enumerate(s.split(" ")):
        core = re.sub(r"[^A-Za-z0-9]", "", w).upper()
        if core in ACRONYMS or (any(c.isdigit() for c in core) and not re.match(r"^\d+(ST|ND|RD|TH)$", core)):
            out.append(w.upper())
        elif i > 0 and core in SMALL:
            out.append(w.lower())
        else:
            parts = re.split(r"([\-/'.&(])", w.lower())
            out.append("".join(p[:1].upper() + p[1:] if p and p[0].isalpha() else p for p in parts))
    t = " ".join(out)
    t = re.sub(r",?\s+(Inc|Incorporated|Llc|Ltd|Nfp)\.?$", "", t, flags=re.I)
    t = re.sub(r"'S\b", "'s", t)
    t = re.sub(r"\bMc([a-z])", lambda m: "Mc" + m.group(1).upper(), t)
    return t


def clean_filed(s):
    """Filed payee name for display: numbering removed, care-of tails removed, and empty
    if any part could identify a person (re-checked here even though the resolver did)."""
    s = re.sub(r"^\s*(\(\d{1,5}\)|\d{1,5}[.)])\s*", "", " ".join((s or "").split()))
    return display_filed_name(s)


def ntee_major(code):
    return (code or "")[:1]


def shard_of(ein):
    return ein[:3]


def write_json_gz(path, obj):
    ensure_dir(os.path.dirname(path))
    data = json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    with gzip.GzipFile(path, "wb", compresslevel=9, mtime=0) as f:
        f.write(data)
    return len(data)


def load_bmf_meta():
    meta = {}
    bdir = os.path.join(RAW, "bmf")
    for fn in sorted(os.listdir(bdir)):
        if fn.endswith(".csv"):
            with open_text(os.path.join(bdir, fn)) as f:
                for r in csv.DictReader(f):
                    meta[fmt_ein(r["EIN"])] = (r["NAME"], r["CITY"], r["STATE"], r["NTEE_CD"], r["SUBSECTION"],
                                               r["FOUNDATION"], money(r["REVENUE_AMT"]))
    return meta


def load_display_names():
    """EIN -> most recent name the organisation filed a return under."""
    p = os.path.join(WORK, "efile_names.csv.gz")
    best = {}
    with open_text(p) as f:
        for r in csv.DictReader(f):
            k = r["ein"]
            rank = (r["tax_year"], r["form"] in ("990", "990EZ", "990PF"))
            if k not in best or rank > best[k][0]:
                best[k] = (rank, r["name"])
    return {k: v[1] for k, v in best.items()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("workdir")
    ap.add_argument("--year", default="2023")
    ap.add_argument("--peers", type=int, default=6)
    ap.add_argument("--prospects", type=int, default=8)
    ap.add_argument("--base-url", default="https://theguysaccount.github.io/whofunds-open-grant-graph")
    a = ap.parse_args()
    t0 = time.time()

    bmf = load_bmf_meta()
    disp = load_display_names()

    def org_name(ein, fallback=""):
        if ein in disp:
            return nice_name(disp[ein])
        if ein in bmf:
            return nice_name(bmf[ein][0])
        return nice_name(fallback)

    # ---------------- filers ----------------
    filers = {}
    with open_text(os.path.join(a.workdir, "pf_grants_filers.csv.gz")) as f:
        for r in csv.DictReader(f):
            filers[r["filer_ein"]] = r
    print(f"filers {len(filers)} ({time.time()-t0:.0f}s)", file=sys.stderr)

    # ---------------- grant lines ----------------
    fdn_lines = collections.defaultdict(list)          # filer -> published line tuples
    fdn_k = collections.defaultdict(lambda: {s: [0, 0] for s in SCOPES + ("withheld",)})
    edges = collections.defaultdict(lambda: collections.defaultdict(list))  # org -> filer -> lines
    totals = {s: [0, 0] for s in SCOPES}
    future = {s: [0, 0] for s in SCOPES}
    strategies = collections.Counter()
    variants = collections.Counter()
    fail_rows = collections.Counter()
    fail_dollars = collections.Counter()
    fail_near = {}
    release_rows = 0
    ensure_dir(RELEASE)
    rel_path = os.path.join(RELEASE, f"whofunds_ty{a.year}_grants.csv.gz")
    rel_fields = ["tax_year", "filer_ein", "filer_name", "object_id", "source_filing_url", "source_xml_url", "section",
                  "line_no", "scope", "recipient_ein", "recipient_name", "recipient_name_as_filed", "recipient_city",
                  "recipient_state", "recipient_country", "amount", "purpose", "match_score", "margin",
                  "runner_up_ein", "runner_up_score", "strategy", "matched_variant"]
    with open_text(os.path.join(a.workdir, "pf_grants_resolved.csv.gz")) as f, open_text(rel_path, "w") as rf:
        rw = csv.DictWriter(rf, fieldnames=rel_fields)
        rw.writeheader()
        for r in csv.DictReader(f):
            amt = int(r["amount"] or 0)
            scope = r["scope"]
            fe = r["filer_ein"]
            if r["section"] == "future":
                future[scope][0] += 1
                future[scope][1] += amt
                continue
            totals[scope][0] += 1
            totals[scope][1] += amt
            k = fdn_k[fe]
            k[scope][0] += 1
            k[scope][1] += amt
            published = r["publish"] == "1"
            if scope in ("unmatched", "foreign") and not published:
                k["withheld"][0] += 1
                k["withheld"][1] += amt
            if scope == "unmatched":
                key = (" ".join(name_tokens(r["recipient_name"])), r["state"])
                if published:
                    fail_rows[key] += 1
                    fail_dollars[key] += amt
                    if r["nearest_ein"] and key not in fail_near:
                        fail_near[key] = (r["nearest_ein"], r["nearest_name"], r["match_score"], r["display_name"])
            if scope == "resolved":
                strategies[r["strategy"]] += 1
                variants[r["matched_variant"]] += 1
                oe = r["recipient_ein"]
                edges[oe][fe].append((amt, r["purpose_public"], r["tax_period_end"], r["object_id"],
                                      float(r["match_score"] or 0), float(r["margin"] or 0), r["strategy"],
                                      clean_filed(r["display_name"])))
                fdn_lines[fe].append((oe, "", r["city"], r["state"], amt, r["purpose_public"],
                                      float(r["match_score"] or 0), float(r["margin"] or 0), r["strategy"], "r"))
            elif published and scope in ("unmatched", "foreign"):
                fdn_lines[fe].append(("", clean_filed(r["display_name"]), r["city"],
                                      r["state"] if scope == "unmatched" else r["country"], amt, r["purpose_public"],
                                      0, 0, "", "u" if scope == "unmatched" else "f"))
            if scope in ("resolved", "unmatched", "foreign") and published:
                fil = filers.get(fe, {})
                rw.writerow({
                    "tax_year": r["tax_year"], "filer_ein": fe, "filer_name": fil.get("name", ""),
                    "object_id": r["object_id"],
                    "source_filing_url": PROPUBLICA_FILING_URL.format(ein=fe, object_id=r["object_id"]),
                    "source_xml_url": GT_XML_URL.format(object_id=r["object_id"]), "section": r["section"],
                    "line_no": r["line_no"], "scope": scope, "recipient_ein": r["recipient_ein"],
                    "recipient_name": r["recipient_bmf_name"] if scope == "resolved" else "",
                    "recipient_name_as_filed": clean_filed(r["display_name"]), "recipient_city": r["city"],
                    "recipient_state": r["state"], "recipient_country": r["country"], "amount": amt,
                    "purpose": r["purpose_public"], "match_score": r["match_score"] if scope == "resolved" else "",
                    "margin": r["margin"] if scope == "resolved" else "", "runner_up_ein": r["runner_up_ein"],
                    "runner_up_score": r["runner_up_score"], "strategy": r["strategy"],
                    "matched_variant": r["matched_variant"],
                })
                release_rows += 1
    print(f"lines read; orgs {len(edges)}; release rows {release_rows} ({time.time()-t0:.0f}s)", file=sys.stderr)

    # ---------------- graph: funder degrees, peers, prospects ----------------
    funders_of = {o: set(fs) for o, fs in edges.items()}
    grantees_of = collections.defaultdict(set)
    for o, fs in funders_of.items():
        for fe in fs:
            grantees_of[fe].add(o)
    deg = {fe: len(g) for fe, g in grantees_of.items()}

    def fw(fe):  # a funder with many grantees says less about similarity
        return 1.0 / math.log(2 + deg[fe])

    # The BMF files many group-exemption members under the parent's name ("BOY SCOUTS OF
    # AMERICA" for every council). For those, with no e-file name of their own, show the
    # name foundations most often wrote for this EIN.
    bmf_name_count = collections.Counter(v[0] for v in bmf.values())

    def display_for(o):
        if o in disp:
            return nice_name(disp[o])
        b = bmf.get(o)
        if b and bmf_name_count[b[0]] >= 25:
            filed = collections.Counter(l[7] for ls in edges[o].values() for l in ls if l[7])
            if filed:
                return nice_name(filed.most_common(1)[0][0])
        return org_name(o)

    org_meta = {}
    for o in edges:
        b = bmf.get(o)
        org_meta[o] = (display_for(o), nice_name(b[1]) if b else "", b[2] if b else "", b[3] if b else "",
                       b[4] if b else "", b[5] if b else "")
    org_total = {o: sum(l[0] for ls in fs.values() for l in ls) for o, fs in edges.items()}

    peers_of = {}
    prospects_of = {}
    t1 = time.time()
    for n_done, (o, fs) in enumerate(funders_of.items(), 1):
        score = collections.Counter()
        my_ntee = ntee_major(org_meta[o][3])
        my_state = org_meta[o][2]
        for fe in fs:
            if deg[fe] > MEGA_FUNDER:
                continue
            wgt = fw(fe)
            for p in grantees_of[fe]:
                if p != o:
                    score[p] += wgt
        if not score:
            peers_of[o], prospects_of[o] = [], []
            continue
        ranked = []
        for p, s in score.most_common(200):
            m = org_meta[p]
            bonus = (1.5 if my_ntee and ntee_major(m[3]) == my_ntee else 1.0) * (1.15 if m[2] == my_state else 1.0)
            ranked.append((s * bonus, p))
        ranked.sort(reverse=True)
        top_peers = [p for _, p in ranked[:25]]
        peers_of[o] = [(p, len(funders_of[p] & fs)) for p in top_peers[: a.peers]]
        pros = collections.Counter()
        pros_amt = collections.Counter()
        pros_k = collections.Counter()
        for rank_i, p in enumerate(top_peers):
            pw = 1.0 / (1 + rank_i * 0.15)
            for fe in funders_of[p]:
                # Matching-gift and giving-platform programs (AmazonSmile: 300k+ recipients)
                # are real funders but not prospects anyone can approach.
                if fe in fs or deg[fe] > MEGA_FUNDER:
                    continue
                pros[fe] += pw
                pros_k[fe] += 1
                pros_amt[fe] += sum(l[0] for l in edges[p][fe])
        prospects_of[o] = [(fe, pros_k[fe], pros_amt[fe]) for fe, _ in pros.most_common(40) if pros_k[fe] >= 2][: a.prospects]
        if n_done % 50000 == 0:
            print(f"  peers {n_done}/{len(funders_of)} ({time.time()-t1:.0f}s)", file=sys.stderr)

    # ---------------- foundation display + co-funders ----------------
    def fdn_name(fe):
        fil = filers.get(fe)
        return nice_name((fil or {}).get("name") or disp.get(fe) or (bmf.get(fe) or ("",))[0])

    def fdn_place(fe):
        fil = filers.get(fe) or {}
        return nice_name(fil.get("city", "")), fil.get("state", "")

    # ---------------- names table (shared by every page) ----------------
    def squash(x):
        return re.sub(r"[^A-Z0-9]", "", (x or "").upper().replace(" THE ", " ").replace("INC", ""))

    names = {"o": {}, "f": {}}
    for o in edges:
        m = org_meta[o]
        names["o"][o] = [m[0], m[1], m[2], m[3], org_total[o], len(funders_of[o])]
    for fe, fil in filers.items():
        c, s_ = fdn_place(fe)
        names["f"][fe] = [fdn_name(fe), c, s_, 1 if fil.get("preselected_only") == "1" else 0,
                          len(grantees_of.get(fe, ())),
                          sum(v[1] for kk, v in fdn_k[fe].items() if kk != "withheld")]
    nb = write_json_gz(os.path.join(SITE_DATA, "names.json.gz"), names)
    print(f"names table raw {nb/1e6:.1f}MB", file=sys.stderr)

    # ---------------- write org shards ----------------
    shards = collections.defaultdict(dict)
    for o, fs in edges.items():
        name, city, st, ntee, sub, fnd = org_meta[o]
        bname = nice_name((bmf.get(o) or ("",))[0])
        known = {squash(name), squash(bname)}
        flist = []
        for fe, ls in fs.items():
            fil = filers.get(fe) or {}
            flist.append([fe, sum(l[0] for l in ls), fil.get("object_id", ""), fil.get("tax_period_end", ""),
                          [[l[0], l[1], round(l[4], 2), round(l[5], 2), CODES.get(l[6], "?"),
                            "" if squash(l[7]) in known else l[7]] for l in sorted(ls, key=lambda x: -x[0])]])
        flist.sort(key=lambda x: -x[1])
        rec = {"e": o, "n": name, "bn": bname if squash(bname) != squash(name) else "", "c": city, "s": st,
               "nt": ntee, "sub": sub, "t": org_total[o], "nf": len(fs), "nl": sum(len(ls) for ls in fs.values()),
               "f": flist, "p": [[p, k] for p, k in peers_of.get(o, [])],
               "q": [[fe, k, amt] for fe, k, amt in prospects_of.get(o, [])]}
        shards[shard_of(o)][o] = rec
    org_bytes = 0
    for sh, recs in shards.items():
        org_bytes += write_json_gz(os.path.join(SITE_DATA, "org", sh + ".json.gz"), recs)
    print(f"org shards {len(shards)} raw {org_bytes/1e6:.0f}MB ({time.time()-t0:.0f}s)", file=sys.stderr)

    # ---------------- write foundation shards ----------------
    cofund = {}
    for fe, gs in grantees_of.items():
        c = collections.Counter()
        if len(gs) <= 5000:
            for o in gs:
                for fe2 in funders_of[o]:
                    if fe2 != fe:
                        c[fe2] += 1
        cofund[fe] = [(fe2, k) for fe2, k in c.most_common(8) if k >= 2]
    fshards = collections.defaultdict(dict)
    for fe, fil in filers.items():
        lines = fdn_lines.get(fe, [])
        lines.sort(key=lambda x: -x[4])
        n_published = len(lines)
        lines = lines[:FDN_LINES_MAX]
        k = fdn_k[fe]
        c, s_ = fdn_place(fe)
        rec = {"e": fe, "np": n_published, "n": fdn_name(fe), "c": c, "s": s_, "tp": fil["tax_period_end"], "o": fil["object_id"],
               "ts": int(fil["total_paid_stated"] or 0), "fmv": int(fil["fmv_assets_eoy"] or 0),
               "nr": len(grantees_of.get(fe, ())), "k": k,
               "app": {"pre": 1 if fil["preselected_only"] == "1" else 0, "form": fil["app_form"],
                       "dl": fil["app_deadlines"], "rs": fil["app_restrictions"], "web": fil["website"]},
               # resolved: [ein, amount, purpose, score, margin, code]; unresolved: [name, city, st/country, amount, purpose, kind]
               "g": [[l[0], l[4], l[5], round(l[6], 2), round(l[7], 2), CODES.get(l[8], "?")] for l in lines if l[0]],
               "u": [[nice_name(l[1]), nice_name(l[2]), l[3], l[4], l[5], l[9]] for l in lines if not l[0]],
               "cf": [[fe2, n] for fe2, n in cofund.get(fe, [])]}
        fshards[shard_of(fe)][fe] = rec
    fdn_bytes = 0
    for sh, recs in fshards.items():
        fdn_bytes += write_json_gz(os.path.join(SITE_DATA, "fdn", sh + ".json.gz"), recs)
    print(f"fdn shards {len(fshards)} raw {fdn_bytes/1e6:.0f}MB ({time.time()-t0:.0f}s)", file=sys.stderr)

    # ---------------- stats ----------------
    paid_lines = sum(v[0] for v in totals.values())
    paid_dollars = sum(v[1] for v in totals.values())
    multi = sum(1 for fs in funders_of.values() if len(fs) > 1)

    def top_recipients(key, n=20):
        rows = sorted(edges, key=key, reverse=True)[:n]
        return [[o, org_meta[o][0], org_meta[o][2], org_total[o], len(funders_of[o])] for o in rows]

    big_fdn = sorted(filers, key=lambda fe: -sum(v[1] for kk, v in fdn_k[fe].items() if kk != "withheld"))[:25]
    stats = {
        "year": a.year, "built": time.strftime("%Y-%m-%d"),
        "foundations": len(filers), "foundations_with_grants": sum(1 for fe in filers if fdn_k[fe]["resolved"][0]
                                                                     + fdn_k[fe]["unmatched"][0] + fdn_k[fe]["individual"][0]
                                                                     + fdn_k[fe]["foreign"][0] + fdn_k[fe]["unitemized"][0]),
        "paid_lines": paid_lines, "paid_dollars": paid_dollars, "scopes": totals, "future": future,
        "orgs": len(edges), "orgs_multi_funded": multi,
        "edges": sum(len(fs) for fs in funders_of.values()),
        "strategies": strategies.most_common(), "variants": variants.most_common(),
        "release_rows": release_rows,
        "top_received": top_recipients(lambda o: org_total[o]),
        "top_widely": top_recipients(lambda o: (len(funders_of[o]), org_total[o])),
        "top_grantmakers": [[fe, fdn_name(fe), fdn_place(fe)[1],
                             sum(v[1] for kk, v in fdn_k[fe].items() if kk != "withheld"),
                             fdn_k[fe]["resolved"][1]] for fe in big_fdn],
        "top_failures": [[k[0], k[1], c, fail_dollars[k], (fail_near.get(k) or ("", "", "", ""))[3]]
                         for k, c in fail_rows.most_common(40)],
    }
    ensure_dir(SITE_DATA)
    with open(os.path.join(SITE_DATA, "stats.json"), "w") as f:
        json.dump(stats, f, indent=1)

    # fix-it queue: refused matches with a nearest candidate, by dollars
    fix = []
    for k, d in fail_dollars.most_common(3000):
        near = fail_near.get(k)
        if not near or not near[3]:
            continue
        fix.append({"name": nice_name(near[3]), "state": k[1], "rows": fail_rows[k], "dollars": d,
                    "near_ein": near[0], "near_name": nice_name(near[1]), "near_score": near[2]})
        if len(fix) >= 500:
            break
    with open(os.path.join(SITE_DATA, "fixit.json"), "w") as f:
        json.dump(fix, f, separators=(",", ":"))

    # ---------------- release extras ----------------
    with open_text(os.path.join(RELEASE, f"whofunds_ty{a.year}_organizations.csv.gz"), "w") as f:
        w = csv.writer(f)
        w.writerow(["ein", "name", "irs_bmf_name", "city", "state", "ntee", "subsection", "received_total",
                    "n_funders", "n_grant_lines"])
        for o in sorted(edges):
            m = org_meta[o]
            w.writerow([o, m[0], (bmf.get(o) or ("",))[0], m[1], m[2], m[3], m[4], org_total[o],
                        len(funders_of[o]), sum(len(ls) for ls in edges[o].values())])
    with open_text(os.path.join(RELEASE, f"whofunds_ty{a.year}_foundations.csv.gz"), "w") as f:
        w = csv.writer(f)
        w.writerow(["ein", "name", "city", "state", "object_id", "tax_period_end", "total_paid_stated",
                    "fmv_assets_eoy", "preselected_only"] +
                   [f"{s}_{m}" for s in SCOPES + ("withheld",) for m in ("lines", "dollars")])
        for fe in sorted(filers):
            fil = filers[fe]
            k = fdn_k[fe]
            w.writerow([fe, fdn_name(fe), fdn_place(fe)[0], fdn_place(fe)[1], fil["object_id"],
                        fil["tax_period_end"], fil["total_paid_stated"], fil["fmv_assets_eoy"],
                        fil["preselected_only"]] + [k[s][i] for s in SCOPES + ("withheld",) for i in (0, 1)])

    # ---------------- sitemaps + robots ----------------
    ensure_dir(PUBLIC)
    base = a.base_url.rstrip("/")
    urls = [f"{base}/org/{o}" for o in sorted(edges, key=lambda o: -len(funders_of[o]))]
    urls += [f"{base}/foundation/{fe}" for fe in sorted(filers, key=lambda fe: -len(grantees_of.get(fe, ())))
             if fdn_lines.get(fe)]
    maps = []
    for i in range(0, len(urls), 45000):
        fn = f"sitemap-{i // 45000 + 1}.xml"
        with open(os.path.join(PUBLIC, fn), "w") as f:
            f.write('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n')
            for u in urls[i:i + 45000]:
                f.write(f"<url><loc>{u}</loc></url>\n")
            f.write("</urlset>\n")
        maps.append(fn)
    with open(os.path.join(PUBLIC, "sitemap.xml"), "w") as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n')
        for p in ["sitemap-pages.xml"] + maps:
            f.write(f"<sitemap><loc>{base}/{p}</loc></sitemap>\n")
        f.write("</sitemapindex>\n")
    with open(os.path.join(PUBLIC, "sitemap-pages.xml"), "w") as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n')
        for p in ["", "method", "data", "corrections", "about"]:
            f.write(f"<url><loc>{base}/{p}</loc></url>\n")
        f.write("</urlset>\n")
    with open(os.path.join(PUBLIC, "robots.txt"), "w") as f:
        f.write(f"User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: {base}/sitemap.xml\n")

    # checksums for the release
    sums = {}
    for fn in sorted(os.listdir(RELEASE)):
        if fn.endswith(".csv.gz"):
            h = hashlib.sha256()
            with open(os.path.join(RELEASE, fn), "rb") as fh:
                for chunk in iter(lambda: fh.read(1 << 20), b""):
                    h.update(chunk)
            sums[fn] = {"sha256": h.hexdigest(), "bytes": os.path.getsize(os.path.join(RELEASE, fn))}
    with open(os.path.join(SITE_DATA, "release.json"), "w") as f:
        json.dump(sums, f, indent=1)
    print(f"done {time.time()-t0:.0f}s", file=sys.stderr)


if __name__ == "__main__":
    main()
