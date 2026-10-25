#!/usr/bin/env python3
"""Recover the recipient EIN for each 990-PF grant line against the IRS Business
Master File, and put every line in exactly one scope:

  resolved    US organisation matched to one EIN, with a score and a margin
  individual  a natural person, or a line that names one; never published
  foreign     non-US payee; out of scope for a US-EIN resolver
  unitemized  'see attached', 'various', blank names: no payee to resolve
  unmatched   US organisation with no confident match (shown as filed when safe)

  python3 pipeline/resolve_eins.py data/work/ty2023/pf_grants.csv.gz data/work/ty2023/pf_grants_resolved.csv.gz

Method (also on the site's /method page):
  * Every EIN carries name variants: its BMF name, the segments of a BMF name
    like "PROJECT BREAD - THE WALK FOR HUNGER", the names it files its own
    returns under (e-file index), and curated aliases (pipeline/aliases.csv).
  * Candidates come from blocks: exact street or PO box + ZIP5, street-number
    containment, ZIP5, city+state, aliases, and national exact / rare-token names.
  * Name similarity is IDF-weighted Dice with one-edit, stem and split-word
    tolerance. A token like FOUNDATION, FRIENDS, ALUMNI or ACTION on only one
    side vetoes the pair (an organisation is not its foundation); numbers must
    agree (PTA 12 is not PTA 21).
  * Accept only above a threshold that rises as address evidence weakens, with a
    margin over the runner-up EIN that rises as the name match weakens.
  * When several EINs share one name in one state (a university and its trusts),
    the one with >=10x the revenue stands for the name.
"""

import argparse
import collections
import csv
import gc
import math
import multiprocessing as mp
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (  # noqa: E402
    HARD_SEPARATORS, INDIVIDUAL_STATUS, NAME_STOP, RAW, SEPARATORS, SPLIT_MARKERS, WORK, ascii_upper,
    PLACEHOLDER_PERSONS, ensure_dir, fmt_ein, has_org_evidence, initials, is_placeholder, loose_person_segment,
    display_filed_name, looks_like_person, money, name_numbers, name_tokens, norm_city, norm_street, open_text,
    person_name_like, public_purpose, safe_to_display, zip5,
)

HERE = os.path.dirname(os.path.abspath(__file__))
ALIAS_FILE = os.path.join(HERE, "aliases.csv")

OUT_FIELDS = [
    "scope", "reason", "recipient_ein", "recipient_bmf_name", "match_score", "margin",
    "runner_up_ein", "runner_up_score", "strategy", "matched_variant", "publish", "display_name",
    "purpose_public", "nearest_ein", "nearest_name",
]

THRESH = {"ADDR_EXACT_NAME": 0.55, "ADDR_CONTAINMENT": 0.72, "ZIP5": 0.80, "CITY_STATE": 0.90,
          "ALIAS": 0.0, "NAME_EXACT_NATIONAL": 0.97, "NAME_TOKEN": 0.93}
ADDR_BONUS = {"ADDR_EXACT_NAME": 0.20, "ADDR_CONTAINMENT": 0.12, "ZIP5": 0.06, "CITY_STATE": 0.02,
              "ALIAS": 0.0, "NAME_EXACT_NATIONAL": 0.0, "NAME_TOKEN": 0.0}
LEVEL = {"ADDR_EXACT_NAME": 6, "ADDR_CONTAINMENT": 5, "ZIP5": 4, "CITY_STATE": 3, "ALIAS": 2,
         "NAME_EXACT_NATIONAL": 1, "NAME_TOKEN": 0}
NATIONAL = {"NAME_EXACT_NATIONAL", "NAME_TOKEN"}
MIN_MARGIN = 0.08
ALIAS_FINAL = 1.10
SEGMENT_DISCOUNT = 0.92  # "X - STUDENT CHAPTER" should not pass as X itself
NATIONAL_MARGIN = 0.15
NATIONAL_MIN_DISTINCT = 14.0
NATIONAL_BIG_ORG = 1_000_000   # revenue at which an out-of-state name match may stand alone
US_STATES = set("""AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV
NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR GU VI AS MP""".split())

INDIVIDUAL_MARKERS = re.compile(r"\b(FBO|F B O|FOR THE BENEFIT OF|ON BEHALF OF|STUDENT ID|ACCT NO|ACCOUNT NO)\b")
SCHOLARISH_PURPOSE = re.compile(r"(SCHOLAR|TUITION|STUDENT|AWARD RECIPIENT|BOOK AWARD|EDUCATIONAL ASSISTANCE|"
                                r"FINANCIAL ASSISTANCE|MEDICAL ASSISTANCE|PATIENT|HARDSHIP|RELIEF OF|PERSONAL|"
                                r"EMERGENCY ASSISTANCE|INDIVIDUAL|CAMPERSHIP|STIPEND|FELLOWSHIP AWARD|RECIPIENT)")
PATIENT_FILER = re.compile(r"PATIENT (ASSISTANCE|ACCESS|PROGRAM|FOUNDATION|SERVICES)|CARES FOUNDATION|PATIENT ASSIST")
MIDDLE_INITIAL = re.compile(r"^[A-Z][A-Z'\-]+ [A-Z] [A-Z][A-Z'\-]+$")
LAST_FIRST = re.compile(r"^[A-Z][A-Z'\-]+, ?[A-Z][A-Z'\-]+( [A-Z])?$")

G = {}  # read-only globals shared with forked workers
EMPTY = frozenset()


class Org:
    """One BMF organisation. Slots (not dicts) keep two million of these in ~1/4 the memory."""
    __slots__ = ("ein", "name", "vs", "key", "po", "city", "state", "zip", "rev", "assets", "dom")

    def __init__(self, ein, name, vs, key, po, city, state, zip_, rev, assets):
        self.ein, self.name, self.vs, self.key, self.po = ein, name, vs, key, po
        self.city, self.state, self.zip, self.rev, self.assets, self.dom = city, state, zip_, rev, assets, -1


def post(d, k, i):
    """Postings: a bare int for one org (most keys), a list for several."""
    v = d.get(k)
    if v is None:
        d[k] = i
    elif v.__class__ is int:
        if v != i:
            d[k] = [v, i]
    elif v[-1] != i:
        v.append(i)


def posting(d, k):
    v = d.get(k)
    if v is None:
        return ()
    return (v,) if v.__class__ is int else v


# --------------------------------------------------------------------------
# Index
# --------------------------------------------------------------------------

def variant(name, src):
    toks = name_tokens(name)
    if not toks:
        return None
    toks = tuple(sys.intern(t) for t in toks)   # one string object per distinct token
    nums = name_numbers(toks)
    return (toks, frozenset(toks), "".join(toks), initials(toks), frozenset(nums) if nums else EMPTY, src)


def iter_bmf():
    """Stream BMF rows (never hold all two million dicts at once)."""
    bdir = os.path.join(RAW, "bmf")
    for fn in sorted(os.listdir(bdir)):
        if fn.endswith(".csv"):
            with open_text(os.path.join(bdir, fn)) as f:
                yield from csv.DictReader(f)


def load_efile_names():
    p = os.path.join(WORK, "efile_names.csv.gz")
    out = collections.defaultdict(list)
    if os.path.exists(p):
        with open_text(p) as f:
            for r in csv.DictReader(f):
                out[r["ein"]].append(r["name"])
    return out


TRUST_MARKERS = re.compile(r"\b(TTEE|TRUSTEE|FBO|F B O|TR|TRUST|UA|U A|UW|U W|TUW|TW|EST|ESTATE|CUSTODIAN|AGENT)\b")


def build_index(efile_names, bmf_rows=None):
    """bmf_rows: optional in-memory rows (tests); by default the BMF files are streamed twice."""
    rows = (lambda: iter(bmf_rows)) if bmf_rows is not None else iter_bmf
    # Primary BMF names held by large organisations: an e-file name equal to one of
    # these on a *different*, much smaller EIN (a trust naming its beneficiary) is ignored.
    big_name = {}
    for r in rows():
        rev = max(money(r["REVENUE_AMT"]), money(r["INCOME_AMT"]))
        k = "".join(name_tokens(r["NAME"]))
        if k and rev > big_name.get(k, (0, ""))[0]:
            big_name[k] = (rev, fmt_ein(r["EIN"]))
    orgs = []
    intern = sys.intern
    for r in rows():
        ein = fmt_ein(r["EIN"])
        vs = []
        seen = set()
        cand = [(r["NAME"], "bmf")]
        for seg in re.split(r"\s+-+\s+|\s+DBA\s+|\s+D/B/A\s+|/", r["NAME"]):
            if seg.strip() and seg.strip() != r["NAME"].strip():
                cand.append((seg, "bmf_segment"))
        own_rev = max(money(r["REVENUE_AMT"]), money(r["INCOME_AMT"]))
        own_trust = bool(TRUST_MARKERS.search(ascii_upper(r["NAME"])))
        for n in efile_names.get(ein, ()):
            k = "".join(name_tokens(n))
            if TRUST_MARKERS.search(ascii_upper(n)) or own_trust:
                continue
            other = big_name.get(k)
            if other and other[1] != ein and other[0] >= 10 * max(1, own_rev):
                continue
            cand.append((n, "efile"))
        for n, src in cand:
            v = variant(n, src)
            if v and v[2] not in seen:
                seen.add(v[2])
                vs.append(v)
        if not vs:
            continue
        key, po = norm_street(r["STREET"])
        orgs.append(Org(ein, " ".join(r["NAME"].split()), tuple(vs), key, po, intern(norm_city(r["CITY"])),
                        intern(r["STATE"]), intern(zip5(r["ZIP"])), own_rev, money(r["ASSET_AMT"])))
    print(f"BMF orgs: {len(orgs)}", file=sys.stderr)
    df = collections.Counter()
    for o in orgs:
        toks = set()
        for v in o.vs:
            toks |= v[1]
        df.update(toks)
    n = len(orgs)
    idf = {t: math.log(n / c) for t, c in df.items()}

    # Keys are flat strings ("02138|HARVARD"); values are bare ints or lists (see post()).
    by_addr, by_zip_tok, by_city_tok, by_exact, by_rare = {}, {}, {}, {}, {}
    for i, o in enumerate(orgs):
        toks = set()
        for v in o.vs:
            toks |= v[1]
            post(by_exact, v[2], i)
        if o.zip:
            if o.key:
                post(by_addr, o.zip + "|" + o.key, i)
            if o.po:
                post(by_addr, o.zip + "|PO " + o.po, i)
            for t in toks:
                if t not in NAME_STOP:
                    post(by_zip_tok, o.zip + "|" + t, i)
        for t in toks:
            if t in NAME_STOP:
                continue
            if o.city and idf.get(t, 0) > 4.0:
                post(by_city_tok, o.city + "|" + o.state + "|" + t, i)
            if df[t] <= 300:
                post(by_rare, t, i)

    # Duplicate names within a state: the dominant entity stands for the name.
    groups = collections.defaultdict(list)
    for i, o in enumerate(orgs):
        groups[(o.vs[0][2], o.state)].append(i)
    n_dom = 0
    for members in groups.values():
        if len(members) < 2:
            continue
        members.sort(key=lambda i: (orgs[i].rev, orgs[i].assets), reverse=True)
        top, second = orgs[members[0]], orgs[members[1]]
        if top.rev >= NATIONAL_BIG_ORG and top.rev >= 10 * max(1, second.rev):
            for j in members[1:]:
                orgs[j].dom = members[0]
                n_dom += 1
    print(f"BMF orgs indexed: {n}; dominated duplicates: {n_dom}", file=sys.stderr)
    return {"orgs": orgs, "idf": idf, "df": df, "by_addr": by_addr, "by_zip_tok": by_zip_tok,
            "by_city_tok": by_city_tok, "by_exact": by_exact, "by_rare": by_rare,
            "ein_ix": {o.ein: i for i, o in enumerate(orgs)}}


def load_aliases(ix):
    """normalised alias -> [(org index, states or None)]. Every EIN is checked against the BMF."""
    out = collections.defaultdict(list)
    if not os.path.exists(ALIAS_FILE):
        return out
    with open(ALIAS_FILE, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if not r.get("alias") or r["alias"].startswith("#"):
                continue
            ein = fmt_ein(r["ein"])
            if ein not in ix["ein_ix"]:
                print(f"  alias skipped (EIN not in BMF): {r['alias']} -> {ein}", file=sys.stderr)
                continue
            raw = (r.get("states") or "").strip()
            neg = raw.startswith("!")
            states = {s.strip() for s in raw.lstrip("!").split("|") if s.strip()} or None
            out["".join(name_tokens(r["alias"]))].append((ix["ein_ix"][ein], states, neg))
    return out


# --------------------------------------------------------------------------
# Similarity
# --------------------------------------------------------------------------

def w(t):
    v = G["idf"].get(t, 12.0)
    return v * 0.15 if t in NAME_STOP else v


def stem(t):
    if len(t) >= 8 and t.endswith("AL"):
        t = t[:-2]
    if len(t) >= 5 and t.endswith("S") and not t.endswith("SS"):
        t = t[:-1]
    return t


def edit1(a, b):
    if a == b:
        return True
    la, lb = len(a), len(b)
    if abs(la - lb) > 1:
        return False
    if la == lb:
        diff = [i for i in range(la) if a[i] != b[i]]
        if len(diff) == 1:
            return True
        return len(diff) == 2 and diff[1] == diff[0] + 1 and a[diff[0]] == b[diff[1]] and a[diff[1]] == b[diff[0]]
    if la > lb:
        a, b = b, a
    i = j = 0
    skipped = False
    while i < len(a) and j < len(b):
        if a[i] == b[j]:
            i += 1
            j += 1
        elif skipped:
            return False
        else:
            skipped = True
            j += 1
    return True


def sim_variant(a, v):
    """IDF-weighted Dice in [0,1] between grant variant a and org variant v, with vetoes."""
    a_toks, a_set, a_sq, a_ini, a_nums, _ = a
    b_toks, b_set, b_sq, b_ini, b_nums, _ = v
    asym = a_set ^ b_set
    if asym & HARD_SEPARATORS:
        return 0.0
    if a_nums and b_nums and a_nums != b_nums:
        return 0.0
    if a_sq == b_sq:
        sim = 1.0
    else:
        # Every float sum runs in sorted token order: set order follows the per-process hash
        # seed, and last-bit rounding must not decide a margin that lands on a threshold.
        common = a_set & b_set
        wc = sum(w(t) for t in sorted(common))
        ra = [t for t in a_toks if t not in common]
        rb = [t for t in b_toks if t not in common]
        used_a, used_b = set(), set()
        # split words: MUSIC WORKS ~ MUSICWORKS, EARTH JUSTICE ~ EARTHJUSTICE
        for x, y, ux, uy in ((ra, rb, used_a, used_b), (rb, ra, used_b, used_a)):
            for k in range(len(x) - 1):
                cat = x[k] + x[k + 1]
                if cat in y and cat not in uy and x[k] not in ux and x[k + 1] not in ux:
                    wc += 0.95 * w(cat)
                    ux.update((x[k], x[k + 1]))
                    uy.add(cat)
        for t in ra:
            if t in used_a or len(t) < 4:
                continue
            for u in rb:
                if u in used_b or len(u) < 4:
                    continue
                if stem(t) == stem(u) or (len(t) >= 5 and len(u) >= 5 and edit1(t, u)):
                    wc += 0.85 * min(w(t), w(u))
                    used_a.add(t)
                    used_b.add(u)
                    break
        wa = sum(w(t) for t in sorted(a_set)) or 1e-9
        wb = sum(w(t) for t in sorted(b_set)) or 1e-9
        ca, cb = min(1.0, wc / wa), min(1.0, wc / wb)
        sim = 0.0 if ca + cb == 0 else 2 * ca * cb / (ca + cb)
        if len(a_toks) == 1 and 2 <= len(a_toks[0]) <= 6 and a_toks[0] == b_ini:
            sim = max(sim, 0.90)
        elif len(b_toks) == 1 and 2 <= len(b_toks[0]) <= 6 and b_toks[0] == a_ini:
            sim = max(sim, 0.90)
    soft = (asym & SEPARATORS) - HARD_SEPARATORS
    if soft:
        sim *= 0.88 ** min(2, len(soft))
    if bool(a_nums) != bool(b_nums):
        sim *= 0.85
    return sim


def best_sim(a, o):
    best, src = 0.0, ""
    for v in o.vs:
        s = sim_variant(a, v)
        if v[5] == "bmf_segment":
            s *= SEGMENT_DISCOUNT
        if s > best:
            best, src = s, v[5]
    return best, src


# --------------------------------------------------------------------------
# Classification
# --------------------------------------------------------------------------

def segment_is_person(seg):
    seg = " ".join(re.sub(r"[^A-Z,' \-]+", " ", ascii_upper(seg)).split())
    if not seg:
        return False
    if MIDDLE_INITIAL.match(seg) or LAST_FIRST.match(seg):
        return not has_org_evidence(name_tokens(seg))
    return person_name_like(seg)


def classify(r):
    """Scope for lines that are out of scope before any matching, else ''."""
    if r["recipient_kind"] == "person":
        return "individual"
    if r["recipient_kind"] == "placeholder":
        return "unitemized"
    name = (r["recipient_name"] + " " + r["recipient_name2"]).strip()
    up = ascii_upper(name)
    if is_placeholder(r["recipient_name"]):
        # "VARIOUS NEEDY PATIENTS", "Eligible patients (see schedule)", or any "see statement"
        # line from a patient-assistance foundation: individuals, not an organisation.
        if PLACEHOLDER_PERSONS.search(up) or PLACEHOLDER_PERSONS.search(ascii_upper(r["purpose"])) \
                or PATIENT_FILER.search(G.get("filer_names", {}).get(r["filer_ein"], "")):
            return "individual"
        return "unitemized"
    if INDIVIDUAL_MARKERS.search(up):
        return "individual"
    status = ascii_upper(r["foundation_status"])
    purpose = ascii_upper(r["purpose"])
    scholarish = bool(SCHOLARISH_PURPOSE.search(purpose))
    # "Jane Doe - Dean College", "Dean College (Jane Doe)", "Dean College / J. Doe"
    parts = [p.strip() for p in SPLIT_MARKERS.split(up) if p and p.strip()]
    if len(parts) > 1 and has_org_evidence(name_tokens(up)):
        if any(loose_person_segment(p, context_scholarship=scholarish) for p in parts):
            return "individual"
    if segment_is_person(r["recipient_name"]):
        return "individual"
    loose = looks_like_person(r["recipient_name"])
    if loose and (INDIVIDUAL_STATUS.search(status) or (status in ("I", "IND", "N/A", "NA", "NONE", "") and scholarish)):
        return "individual"
    if r["foreign"] == "1" or (r["country"] and r["country"] not in ("US", "")):
        return "foreign"
    return ""


# --------------------------------------------------------------------------
# Resolution
# --------------------------------------------------------------------------

def gather(a, z, key, po, city, state):
    cands = {}

    def add(i, strat):
        cur = cands.get(i)
        if cur is None or LEVEL[strat] > LEVEL[cur]:
            cands[i] = strat

    tset = sorted(a[1])  # sorted: candidate order must not depend on hash randomization
    if z:
        if key:
            for i in posting(G["by_addr"], z + "|" + key):
                add(i, "ADDR_EXACT_NAME")
        if po:
            for i in posting(G["by_addr"], z + "|PO " + po):
                add(i, "ADDR_EXACT_NAME")
        for t in tset:
            if t in NAME_STOP:
                continue
            lst = posting(G["by_zip_tok"], z + "|" + t)
            if len(lst) <= 400:
                for i in lst:
                    add(i, "ZIP5")
    if city:
        rare = sorted((t for t in tset if t not in NAME_STOP), key=lambda t: (-G["idf"].get(t, 12), t))[:3]
        for t in rare:
            lst = posting(G["by_city_tok"], city + "|" + state + "|" + t)
            if len(lst) <= 300:
                for i in lst:
                    add(i, "CITY_STATE")
    for i in posting(G["by_exact"], a[2]):
        add(i, "NAME_EXACT_NATIONAL")
    rare = sorted((t for t in tset if t in G["by_rare"]), key=lambda t: (G["df"].get(t, 0), t))[:2]
    if rare:
        pool = set(posting(G["by_rare"], rare[0]))
        if len(rare) > 1:
            pool &= set(posting(G["by_rare"], rare[1]))
        if len(pool) <= 60:
            for i in pool:
                add(i, "NAME_TOKEN")
    return cands


def required_margin(sim, strat):
    if strat in NATIONAL:
        return NATIONAL_MARGIN
    return MIN_MARGIN + max(0.0, 0.80 - sim)


def resolve_one(name, z, key, po, city, state):
    a = variant(name, "grant")
    if a is None:
        return None
    orgs = G["orgs"]
    cands = gather(a, z, key, po, city, state)
    scored = {}
    for i, strat in cands.items():
        o = orgs[i]
        if strat == "ZIP5" and key and o.key:
            ka, kb = key.split(), o.key.split()
            if ka[0] == kb[0] and len(ka) > 1 and len(kb) > 1 and ka[1] == kb[1]:
                strat = "ADDR_CONTAINMENT"
        sim, src = best_sim(a, o)
        if sim <= 0:
            continue
        final = sim + ADDR_BONUS[strat]
        if i not in scored or final > scored[i][0]:
            scored[i] = (final, sim, strat, i, src)
    # A curated alias outranks national name matches (1.0) and weak local ones, but loses
    # to a different EIN at the exact filed address with a near-identical name (>= 1.15).
    for i, states, neg in G["aliases"].get(a[2], ()):
        if states is None or ((state not in states) if neg else (state in states)):
            if i not in scored or scored[i][0] < ALIAS_FINAL:
                scored[i] = (ALIAS_FINAL, 1.0, "ALIAS", i, "alias")
    if not scored:
        return ("no_candidates", None)
    # One entry per EIN; drop duplicates dominated by a present, equally scored entity.
    ranked = sorted(scored.values(), key=lambda s: (-s[0], orgs[s[3]].ein))
    present = {s[3]: s for s in ranked}
    ranked = [s for s in ranked
              if not (orgs[s[3]].dom in present and present[orgs[s[3]].dom][0] >= s[0] - 0.02)]
    # A curated alias target also stands for near-identically named entities under 1% of its
    # revenue ("Trustees of Princeton University" the alumni-class entity vs the university).
    alias_rev = max((orgs[s[3]].rev for s in ranked if s[2] == "ALIAS"), default=0)
    if alias_rev:
        ranked = [s for s in ranked if s[2] == "ALIAS" or not (s[1] >= 0.95 and orgs[s[3]].rev * 100 < alias_rev)]
    top = ranked[0]
    final, sim, strat, i, src = top
    run = ranked[1] if len(ranked) > 1 else None
    margin = final - run[0] if run else final
    if strat in NATIONAL:
        o = orgs[i]
        distinct = sum(w(t) for t in sorted(a[1]))
        if state and state not in US_STATES:
            return ("below_threshold", (top, run, margin))
        if o.state != state and o.rev < NATIONAL_BIG_ORG:
            return ("below_threshold", (top, run, margin))
        # A large organisation's exact, nationally unique name is identifying even when built
        # from common words ("American Heart Association", "Feeding America").
        big_exact = strat == "NAME_EXACT_NATIONAL" and o.rev >= 10_000_000 and distinct >= 8 and \
            len(posting(G["by_exact"], a[2])) == 1
        if sim < THRESH[strat] or (distinct < NATIONAL_MIN_DISTINCT and not big_exact):
            return ("below_threshold", (top, run, margin))
        if run and run[1] >= 0.90:
            return ("ambiguous_national", (top, run, margin))
    elif strat != "ALIAS" and sim < THRESH[strat]:
        return ("below_threshold", (top, run, margin))
    if run and margin < required_margin(sim, strat):
        return ("ambiguous", (top, run, margin))
    return ("ok", (top, run, margin))


EIN_IN_TEXT = re.compile(r"(?:\bEIN|\bFEIN|\bFED(?:ERAL)?\.? ?(?:ID|TAX ID|I D)|\bTAX ?ID|\bTIN)\s*(?:NO\.?|NUMBER|#)?\s*:?\s*#?\s*(\d{2})\s*-?\s*(\d{7})\b")


def ein_in_text(r):
    """Some filers type the payee's EIN into the name or address ("... FED ID 95 1690977")."""
    blob = ascii_upper(" ".join((r["recipient_name"], r["recipient_name2"], r["addr1"], r["addr2"])))
    m = EIN_IN_TEXT.search(blob)
    if not m:
        return None
    i = G["ein_ix"].get(m.group(1) + m.group(2))
    if i is None:
        return None
    o = G["orgs"][i]
    base = EIN_IN_TEXT.sub(" ", blob)
    a = variant(base, "grant")
    sim = best_sim(a, o)[0] if a else 0.0
    return (i, sim) if sim >= 0.3 else None


def resolve_line(r):
    out = dict.fromkeys(OUT_FIELDS, "")
    scope = classify(r)
    out["purpose_public"] = public_purpose(r["purpose"])
    shown = display_filed_name(r["recipient_name"]) if scope != "individual" else ""
    disp_ok = bool(shown)
    out["display_name"] = shown
    if scope:
        out["scope"] = scope
        out["publish"] = "1" if scope == "foreign" and disp_ok else "0"
        return out
    hit = ein_in_text(r)
    if hit:
        o = G["orgs"][hit[0]]
        if o.ein != r["filer_ein"]:
            out.update(scope="resolved", recipient_ein=o.ein, recipient_bmf_name=o.name, publish="1",
                       strategy="EIN_IN_TEXT", matched_variant="filed_ein", match_score=f"{hit[1]:.3f}",
                       margin="1.000")
            return out
    z = zip5(r["zip"])
    key, po = norm_street(r["addr1"], r["addr2"])
    city, state = norm_city(r["city"]), r["state"]
    names = [r["recipient_name"]]
    n2 = r["recipient_name2"]
    if n2 and not re.match(r"^(C/?O|ATTN|ATTENTION|%)\b", ascii_upper(n2)):
        names.append(r["recipient_name"] + " " + n2)
    best = None
    for nm in names:
        # Key on the token tuple: "2 LIFE" and "2LIFE" squash alike but tokenize differently.
        ck = (tuple(name_tokens(nm)), z, key, po, city, state)
        res = G["cache"].get(ck)
        if res is None:
            res = resolve_one(nm, z, key, po, city, state)
            G["cache"][ck] = res
        if res is None:
            continue
        if best is None or (res[0] == "ok" and best[0] != "ok") or (
                res[0] == best[0] and res[1] and best[1] and res[1][0][0] > best[1][0][0]):
            best = res
    if best is None:
        out.update(scope="unitemized", publish="0")
        return out
    status, info = best
    if info:
        top, run, margin = info
        o = G["orgs"][top[3]]
        if status == "ok" and o.ein == r["filer_ein"]:
            status = "self_match"
        out["match_score"] = f"{top[1]:.3f}"
        out["margin"] = f"{margin:.3f}"
        if status == "ok":
            out.update(scope="resolved", recipient_ein=o.ein, recipient_bmf_name=o.name, publish="1",
                       strategy=top[2], matched_variant=top[4])
            if run:
                out["runner_up_ein"] = G["orgs"][run[3]].ein
                out["runner_up_score"] = f"{run[1]:.3f}"
            return out
        # Refused: keep the nearest candidate for the public fix-it queue, never as an edge.
        out["nearest_ein"] = o.ein
        out["nearest_name"] = o.name
    out["reason"] = status
    out["scope"] = "unmatched"
    out["publish"] = "1" if disp_ok else "0"
    return out


def work(rows):
    return [resolve_line(r) for r in rows]


def work_pair(rows):
    """Worker side of the pool: return the chunk with its results so order needs no bookkeeping."""
    return rows, work(rows)


def read_chunks(path, size=2000):
    """Stream grant lines in chunks (the full file never sits in memory)."""
    with open_text(path) as f:
        reader = csv.DictReader(f)
        chunk = []
        for r in reader:
            chunk.append(r)
            if len(chunk) >= size:
                yield chunk
                chunk = []
        if chunk:
            yield chunk


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("grants")
    ap.add_argument("out")
    ap.add_argument("--workers", type=int, default=12, help="1 = single process (lowest memory, for CI)")
    a = ap.parse_args()
    t0 = time.time()
    ix = build_index(load_efile_names())
    G.update(ix)
    G["aliases"] = load_aliases(ix)
    G["cache"] = {}
    filers_path = a.grants.replace(".csv.gz", "") + "_filers.csv.gz"
    G["filer_names"] = {}
    if os.path.exists(filers_path):
        with open_text(filers_path) as f:
            G["filer_names"] = {r["filer_ein"]: ascii_upper(r["name"]) for r in csv.DictReader(f)}
    print(f"index built {time.time()-t0:.0f}s; aliases {sum(len(v) for v in G['aliases'].values())}", file=sys.stderr)

    with open_text(a.grants) as f:
        in_fields = csv.DictReader(f).fieldnames
    ensure_dir(os.path.dirname(os.path.abspath(a.out)))
    counts = collections.Counter()
    done = 0
    gc.collect()
    gc.freeze()  # keep forked workers from copying the shared index pages during GC
    pool = mp.get_context("fork").Pool(a.workers) if a.workers > 1 else None
    try:
        chunks = read_chunks(a.grants)
        pairs = ((c, work(c)) for c in chunks) if pool is None else pool.imap(work_pair, chunks)
        with open_text(a.out, "w") as f:
            wtr = csv.DictWriter(f, fieldnames=in_fields + OUT_FIELDS)
            wtr.writeheader()
            for chunk, res in pairs:
                for r, o in zip(chunk, res):
                    r.update(o)
                    if r["recipient_kind"] == "person" or r["scope"] == "individual":
                        # A natural person's name, street and purpose never go past this point.
                        r.update(recipient_name="", recipient_name2="", addr1="", addr2="", zip="", purpose="",
                                 purpose_public="", display_name="", nearest_ein="", nearest_name="")
                    wtr.writerow(r)
                    counts[(r["section"], r["scope"])] += 1
                done += len(chunk)
                if G["cache"] and len(G["cache"]) > 400000:
                    G["cache"].clear()  # bounded memory in single-process mode
                if done % 100000 < 2000:
                    print(f"  {done} lines {time.time()-t0:.0f}s", file=sys.stderr)
    finally:
        if pool is not None:
            pool.close()
            pool.join()
    print("done", dict(counts), f"{time.time()-t0:.0f}s", file=sys.stderr)


if __name__ == "__main__":
    main()
