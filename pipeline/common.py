"""Shared helpers for the WHOFUNDS pipeline: paths, name/address normalisation,
recipient classification. Standard library only (Python 3.9+)."""

import csv
import gzip
import io
import os
import re
import sys
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
WORK = os.path.join(ROOT, "data", "work")
RELEASE = os.path.join(ROOT, "data", "release")

GT_XML_URL = "https://gt990datalake-rawdata.s3.amazonaws.com/EfileData/XmlFiles/{object_id}_public.xml"
PROPUBLICA_FILING_URL = "https://projects.propublica.org/nonprofits/organizations/{ein}/{object_id}/full"
PROPUBLICA_ORG_URL = "https://projects.propublica.org/nonprofits/organizations/{ein}"

csv.field_size_limit(sys.maxsize)


def open_text(path, mode="r"):
    """Open .csv or .csv.gz transparently (utf-8, universal newlines for csv)."""
    if path.endswith(".gz"):
        return io.TextIOWrapper(gzip.open(path, mode + "b"), encoding="utf-8", newline="")
    return open(path, mode, encoding="utf-8", newline="")


def ensure_dir(path):
    os.makedirs(path, exist_ok=True)
    return path


# --------------------------------------------------------------------------
# Text normalisation
# --------------------------------------------------------------------------

def ascii_upper(s):
    s = unicodedata.normalize("NFKD", s or "")
    return s.encode("ascii", "ignore").decode("ascii").upper()


# Abbreviations as they appear in filed names -> canonical token.
NAME_ABBREV = {
    "ST": "SAINT", "STE": "SAINTE", "MT": "MOUNT", "FT": "FORT",
    "UNIV": "UNIVERSITY", "UNIVERSIT": "UNIVERSITY", "UNVERSITY": "UNIVERSITY",
    "ASSN": "ASSOCIATION", "ASSOC": "ASSOCIATION", "ASSO": "ASSOCIATION", "ASSNS": "ASSOCIATIONS",
    "CTR": "CENTER", "CNTR": "CENTER", "CENTRE": "CENTER", "CTRS": "CENTERS",
    "FDN": "FOUNDATION", "FNDN": "FOUNDATION", "FOUND": "FOUNDATION", "FNDTN": "FOUNDATION",
    "FOUNDATIO": "FOUNDATION", "FOUNDATI": "FOUNDATION", "FOUNDAT": "FOUNDATION",
    "INTL": "INTERNATIONAL", "INTERNATL": "INTERNATIONAL", "NATL": "NATIONAL",
    "AMER": "AMERICAN", "AMERICAS": "AMERICAS",
    "HOSP": "HOSPITAL", "SCH": "SCHOOL", "SCHL": "SCHOOL", "SCHS": "SCHOOLS",
    "SVCS": "SERVICES", "SVC": "SERVICE", "SERV": "SERVICES", "SRVCS": "SERVICES",
    "SOC": "SOCIETY", "SOCY": "SOCIETY", "CHAP": "CHAPTER",
    "COMM": "COMMUNITY", "CMNTY": "COMMUNITY", "COMMUN": "COMMUNITY", "CMTY": "COMMUNITY",
    "COMMUNTY": "COMMUNITY", "COMUNITY": "COMMUNITY", "COUMMUNITY": "COMMUNITY",
    "CHARITABLE": "CHARITABLE", "CHAR": "CHARITABLE",
    "DEPT": "DEPARTMENT", "DEV": "DEVELOPMENT", "DEVEL": "DEVELOPMENT",
    "EDUC": "EDUCATION", "EDUCATIONAL": "EDUCATIONAL", "ED": "EDUCATION",
    "HLTH": "HEALTH", "HUMANE": "HUMANE", "MED": "MEDICAL", "MEDL": "MEDICAL",
    "MEM": "MEMORIAL", "MEML": "MEMORIAL", "MUS": "MUSEUM",
    "CATH": "CATHOLIC", "CHRISTN": "CHRISTIAN", "EPISC": "EPISCOPAL",
    "PRES": "PRESBYTERIAN", "PRESBY": "PRESBYTERIAN", "METH": "METHODIST", "BAPT": "BAPTIST",
    "LUTH": "LUTHERAN", "CONG": "CONGREGATIONAL", "EVANG": "EVANGELICAL",
    "INST": "INSTITUTE", "INSTIT": "INSTITUTE", "TECH": "TECHNOLOGY",
    "CO": "COMPANY", "CORP": "CORPORATION", "INC": "INCORPORATED",
    "LTD": "LIMITED", "BRO": "BROTHERS", "BROS": "BROTHERS",
    "YMCA": "YMCA", "YWCA": "YWCA",
    "NO": "NUMBER", "NUM": "NUMBER",
    "N": "NORTH", "S": "SOUTH", "E": "EAST", "W": "WEST",
    "NE": "NORTHEAST", "NW": "NORTHWEST", "SE": "SOUTHEAST", "SW": "SOUTHWEST",
    "CNTY": "COUNTY", "CTY": "COUNTY", "TWP": "TOWNSHIP",
    "GRTR": "GREATER", "GTR": "GREATER", "SO": "SOUTHERN",
    "SR": "SENIOR", "JR": "JUNIOR", "ELEM": "ELEMENTARY", "HS": "HIGHSCHOOL",
    "PROG": "PROGRAM", "PROGS": "PROGRAMS", "RES": "RESEARCH",
    "DIST": "DISTRICT", "AUX": "AUXILIARY", "AUXILLIARY": "AUXILIARY",
    "ALUM": "ALUMNI", "ASSISTNCE": "ASSISTANCE",
}

# Tokens that carry no identity (legal form, articles). Dropped before comparison.
NAME_NOISE = {
    "THE", "INCORPORATED", "CORPORATION", "COMPANY", "LIMITED", "LLC", "PC", "NFP",
    "PLLC", "LLP", "LP", "A", "AN", "DBA", "AKA", "FKA", "ATTN", "C", "O", "CO",
}

# Low-information words: kept, but weighted down (and never used alone for blocking).
NAME_STOP = {"OF", "AND", "FOR", "IN", "AT", "ON", "TO", "BY", "WITH", "FROM", "DE", "LA", "DEL", "LOS", "LAS", "EL"}

# If exactly one side of a candidate pair carries one of these, they are different
# legal entities more often than not (an org vs its foundation, friends group,
# alumni body, booster club, auxiliary, (c)(4) sibling, local unit...).
SEPARATORS = {
    "FOUNDATION", "FOUNDATIONS", "FRIENDS", "AUXILIARY", "ALUMNI", "ALUMNAE", "GUILD",
    "BOOSTER", "BOOSTERS", "PTA", "PTO", "PTSA", "PTSO", "PARENTS", "PARENT",
    "ENDOWMENT", "ACTION", "VOTES", "VOTERS", "PAC", "SUPPORTING", "SUPPORT",
    "AUXILIARIES", "ALUMNUS", "BOOSTERCLUB", "HOLDING", "HOLDINGS", "PROPERTIES",
    "TITLEHOLDING", "HOUSING", "EMPLOYEES", "RETIREES", "STUDENTS", "STUDENT",
    "NURSES", "VOLUNTEERS", "LEAGUE", "LODGE", "POST", "LOCAL",
    "CHAPTER", "COUNCIL", "AFFILIATE", "AFFILIATES", "TRUST", "FUND", "FUNDS",
    "ENDOWED", "CHARITABLE", "CHARITIES", "SCHOLARSHIP", "SCHOLARSHIPS",
}
# Separators that, if asymmetric, are an absolute veto (others only penalise).
HARD_SEPARATORS = {
    "FOUNDATION", "FOUNDATIONS", "FRIENDS", "AUXILIARY", "AUXILIARIES", "ALUMNI", "ALUMNAE",
    "ALUMNUS", "GUILD", "BOOSTER", "BOOSTERS", "PTA", "PTO", "PTSA", "PTSO", "ENDOWMENT",
    "ACTION", "VOTES", "VOTERS", "PAC", "HOLDING", "HOLDINGS", "PROPERTIES", "EMPLOYEES",
    "RETIREES", "NURSES", "VOLUNTEERS", "PARENTS",
}

# Words that indicate an organisation rather than a natural person.
ORG_WORDS = set("""
INCORPORATED CORPORATION COMPANY LIMITED LLC FOUNDATION FOUNDATIONS FUND FUNDS TRUST TRUSTS
ASSOCIATION ASSOCIATIONS SOCIETY SOCIETIES CHURCH CHURCHES PARISH CATHEDRAL CHAPEL TEMPLE
SYNAGOGUE CONGREGATION MOSQUE MASJID MINISTRY MINISTRIES MISSION MISSIONS DIOCESE ARCHDIOCESE
SCHOOL SCHOOLS ACADEMY COLLEGE COLLEGES UNIVERSITY UNIVERSITIES INSTITUTE INSTITUTES SEMINARY
CENTER CENTERS HOSPITAL HOSPITALS CLINIC CLINICS HEALTH HEALTHCARE MEDICAL MUSEUM MUSEUMS
LIBRARY LIBRARIES THEATER THEATRE THEATERS ORCHESTRA SYMPHONY OPERA BALLET DANCE CHOIR CHORUS
CHORALE PHILHARMONIC ENSEMBLE COUNCIL COMMITTEE CLUB CLUBS LEAGUE ALLIANCE COALITION NETWORK
PROJECT PROJECTS PROGRAM PROGRAMS SERVICES SERVICE COMMUNITY COMMUNITIES SHELTER HOUSING PANTRY
KITCHEN BANK MISSION ARMY CROSS CHARITIES CHARITY CHARITABLE RELIEF RESCUE HABITAT YMCA YWCA
BOYS GIRLS SCOUTS SCOUT COUNTY CITY TOWN TOWNSHIP VILLAGE DISTRICT DEPARTMENT FIRE POLICE
VOLUNTEER VOLUNTEERS AUXILIARY FRIENDS PTA PTO PTSA PARTNERSHIP PARTNERS INITIATIVE CAMPAIGN
CONSERVANCY TRUSTEES BOARD FEDERATION UNION GUILD LODGE POST LEGION VFW ELKS ROTARY LIONS KIWANIS
OPTIMIST HOSPICE HOME HOMES CARE ARTS ART GALLERY ZOO ZOOLOGICAL AQUARIUM GARDEN GARDENS
ARBORETUM PARK PARKS TRAIL TRAILS WATERSHED RIVERKEEPER RADIO TELEVISION PUBLIC MEDIA NEWS PRESS
JOURNAL REVIEW SANCTUARY ANIMAL ANIMALS HUMANE SPCA ASPCA FOOD COOPERATIVE CORPS INTERNATIONAL
NATIONAL AMERICAN AMERICA USA GLOBAL WORLD FELLOWSHIP BROTHERHOOD SISTERHOOD SISTERS BROTHERS
ORDER ABBEY CONVENT MONASTERY PRIORY RECTORY UNITED COUNCIL CHAMBER COMMERCE INDUSTRY BUREAU
AGENCY AUTHORITY COMMISSION OFFICE GOVERNMENT STATE COMMONWEALTH TRIBE TRIBAL NATION NATIONS
BAND TROOP PACK SQUADRON BATTALION REGIMENT VETERANS AUXILIARY DAYCARE PRESCHOOL MONTESSORI
ELEMENTARY HIGHSCHOOL MIDDLE HIGH JUNIOR SENIOR CAMP CAMPS RANCH FARM FARMS RESERVE PRESERVE
LAND LANDS WILDLIFE AUDUBON NATURE ENVIRONMENTAL ENVIRONMENT CONSERVATION RESEARCH LAB
LABORATORY OBSERVATORY STUDIO STUDIOS FESTIVAL FESTIVALS PLAYERS PLAYHOUSE CONSERVATORY
INSTITUTION INSTITUTIONS ORGANIZATION ORGANISATION ORGANIZATIONS COUNSELING TREATMENT RECOVERY
OUTREACH ADVOCATES ADVOCACY ACTION AID AIDS CANCER HEART DIABETES ALZHEIMERS AUTISM DISEASE
DISEASES CHILDREN CHILDRENS KIDS YOUTH FAMILIES WOMEN WOMENS MENS ELDERS SENIORS NEIGHBORHOOD
NEIGHBORS PEOPLE PEOPLES HUMANITY HOPE LEGAL JUSTICE LAW RIGHTS LIBERTIES CIVIL FREEDOM
DEMOCRACY POLICY PROGRESS ENTERPRISE ENTERPRISES VENTURE VENTURES CAPITAL LOAN LOANS CREDIT
SAVINGS FINANCIAL ECONOMIC DEVELOPMENT EDUCATION EDUCATIONAL LEARNING LITERACY READING STEM
SCIENCE SCIENCES TECHNOLOGY ENGINEERING MATHEMATICS MUSIC MUSICAL CULTURAL CULTURE HERITAGE
HISTORICAL HISTORY PRESERVATION LANDMARKS RESTORATION BIBLE GOSPEL CHRISTIAN CATHOLIC JEWISH
ISLAMIC MUSLIM HINDU BUDDHIST LUTHERAN METHODIST BAPTIST PRESBYTERIAN EPISCOPAL EVANGELICAL
PENTECOSTAL ORTHODOX ASSEMBLY ASSEMBLIES TABERNACLE FAITH WORSHIP SPIRITUAL HOLY SAINT SAINTS
CHAPTER DIVISION REGION REGIONAL AREA VALLEY BAY COAST COASTAL MOUNTAIN ISLAND ISLANDS
""".split())

PLACEHOLDER_PATTERNS = re.compile(
    r"^(SEE |PER |REFER |ATTACH|STATEMENT|SCHEDULE|VARIOUS|SUNDRY|MISC|MISCELLANEOUS|OTHER |OTHERS$|"
    r"ANONYMOUS|N ?A$|NONE$|NOT APPLICABLE|TOTAL|GRANTS? PAID|CONTRIBUTIONS? PAID|LIST |"
    r"MULTIPLE |NUMEROUS |SEVERAL |ALL |PATIENTS?$|INDIVIDUALS?$|STUDENTS?$|SCHOLARSHIPS?$|"
    r"ATCH\b|ATTCH|ATT\b|STMT|GRANTS?$|CONTRIBUTIONS?$|DONATIONS?$|GIFTS?$|FOUNDATION$|CHARITIES$|CHARITY$|"
    r"DETAILS |UNDER HEALTH INSURANCE|HIPP?AA?\b|ELIGIBLE |QUALIFIED |NEEDY |UNKNOWN|TBD$|TO BE DETERMINED)"
)
PLACEHOLDER_CONTAINS = re.compile(
    r"(SEE ATTACHED|SEE STATEMENT|SEE SCHEDULE|ATTACHED LIST|ATTACHED SCHEDULE|ATTACHED STATEMENT|"
    r"VARIOUS RECIPIENTS|VARIOUS INDIVIDUALS|VARIOUS ORGANIZATIONS|VARIOUS CHARITIES|VARIOUS NONPROFITS|"
    r"VARIOUS PUBLIC CHARITIES|VARIOUS 501|SEE ADDENDUM|SEE ATTACHMENT|SEE EXHIBIT|SEE LIST|"
    r"LESS THAN \$?\d|UNDER \$?\d|GRANTS UNDER|GRANTS LESS|HEALTH INSURANCE PORTABILITY|HIPP?AA? |"
    r"PREVENT LIST|AVAILABLE UPON REQUEST|AVAILABLE ON REQUEST|PATIENT PROGRAM|PATIENT ASSISTANCE|"
    r"\b(19|20)\d\d GRANTS$|SEE PART |SEE NOTE|NAMES WITHHELD|CONFIDENTIAL)"
)
PLACEHOLDER_PERSONS = re.compile(r"(PATIENT|NEEDY|INDIVIDUAL|PERSONS|STUDENT|SCHOLARSHIP RECIPIENT|HIPP?AA|"
                                 r"HEALTH INSURANCE PORTABILITY|RECIPIENTS|FAMILIES|BENEFICIARIES|VICTIMS)")

INDIVIDUAL_STATUS = re.compile(r"(INDIV|PERSON|STUDENT|PATIENT|SCHOLAR|RECIPIENT IS A|NATURAL)")
PURPOSE_IDENTIFIES_PERSON = re.compile(
    r"(\bFBO\b|\bF B O\b|FOR THE BENEFIT OF|ON BEHALF OF|TUITION FOR|SCHOLARSHIP FOR |"
    r"STUDENT:|PATIENT:|MEDICAL EXPENSES FOR|ASSISTANCE TO [A-Z]+ [A-Z]+$)"
)


def name_tokens(name, expand=True):
    """Normalised token list for an organisation name (noise words removed)."""
    s = ascii_upper(name)
    s = re.sub(r"^\s*(\(\d{1,5}\)|\d{1,5}[.)])\s*", " ", s)   # '(580) NEW LONDON BARN' line numbering
    s = s.replace("&", " AND ").replace("+", " AND ")
    s = re.sub(r"['`’]", "", s)
    s = re.sub(r"\bC/O\b.*$", " ", s)          # drop 'c/o ...' tails
    s = re.sub(r"\bF/?K/?A\b.*$", " ", s)       # drop 'formerly known as ...'
    s = re.sub(r"[^A-Z0-9]+", " ", s)
    # "N A A C P" / "Y M C A" -> "NAACP" / "YMCA" (before 'N' can become NORTH).
    s = re.sub(r"\b(?:[A-Z] ){1,}[A-Z]\b", lambda m: m.group(0).replace(" ", ""), s)
    out = []
    for t in s.split():
        if expand:
            t = NAME_ABBREV.get(t, t)
        if t in NAME_NOISE:
            continue
        out.append(t)
    # Join common split words.
    joined = " ".join(out)
    joined = joined.replace("HIGH SCHOOL", "HIGHSCHOOL").replace("BOOSTER CLUB", "BOOSTERCLUB")
    joined = joined.replace("TITLE HOLDING", "TITLEHOLDING").replace("Y M C A", "YMCA").replace("Y W C A", "YWCA")
    joined = re.sub(r"\bSAINT (\w+)S\b", r"SAINT \1S", joined)
    return joined.split()


def norm_name(name):
    return " ".join(name_tokens(name))


def name_numbers(tokens):
    return {t for t in tokens if any(ch.isdigit() for ch in t)}


def initials(tokens):
    return "".join(t[0] for t in tokens if t not in NAME_STOP and t and t[0].isalpha())


STREET_SUFFIX = {
    "STREET": "ST", "STR": "ST", "AVENUE": "AVE", "AV": "AVE", "AVENU": "AVE", "ROAD": "RD",
    "BOULEVARD": "BLVD", "BOUL": "BLVD", "DRIVE": "DR", "DRV": "DR", "LANE": "LN", "COURT": "CT",
    "PLACE": "PL", "SQUARE": "SQ", "PARKWAY": "PKWY", "PKY": "PKWY", "HIGHWAY": "HWY", "TERRACE": "TER",
    "CIRCLE": "CIR", "TRAIL": "TRL", "TURNPIKE": "TPKE", "EXPRESSWAY": "EXPY", "PLAZA": "PLZ",
    "NORTH": "N", "SOUTH": "S", "EAST": "E", "WEST": "W", "NORTHEAST": "NE", "NORTHWEST": "NW",
    "SOUTHEAST": "SE", "SOUTHWEST": "SW", "SUITE": "STE", "APARTMENT": "APT", "FLOOR": "FL",
    "FLR": "FL", "ROOM": "RM", "BUILDING": "BLDG", "BLD": "BLDG", "DEPARTMENT": "DEPT", "MOUNT": "MT",
    "SAINT": "ST", "FORT": "FT", "CENTER": "CTR", "FIRST": "1ST", "SECOND": "2ND", "THIRD": "3RD",
    "FOURTH": "4TH", "FIFTH": "5TH", "SIXTH": "6TH", "SEVENTH": "7TH", "EIGHTH": "8TH",
    "NINTH": "9TH", "TENTH": "10TH", "ONE": "1", "TWO": "2", "THREE": "3",
}
UNIT_WORDS = {"STE", "APT", "FL", "RM", "UNIT", "BLDG", "DEPT", "MSC", "MS", "MAILSTOP", "MAIL", "STOP", "PMB", "LBBY", "LOBBY"}


def norm_street(addr1, addr2=""):
    """Return (street_key, po_box) for an address line.

    street_key: house number + street name tokens with unit designators removed.
    po_box: the box number if this is a PO box address, else ''.
    """
    s = ascii_upper((addr1 or "") + " " + (addr2 or ""))
    s = s.replace("#", " STE ")
    s = re.sub(r"[^A-Z0-9 ]+", " ", s)
    s = re.sub(r"\bP\s*O\s*BOX\b|\bPOST OFFICE BOX\b|\bPOB\b|\bP O B\b|\bBOX\b", " POBOX ", s)
    toks = [STREET_SUFFIX.get(t, t) for t in s.split()]
    po = ""
    if "POBOX" in toks:
        i = toks.index("POBOX")
        if i + 1 < len(toks):
            po = toks[i + 1]
    # Street part: from the first token that starts with a digit (house number).
    street = []
    started = False
    skip_next = False
    for t in toks:
        if skip_next:
            skip_next = False
            continue
        if t == "POBOX":
            skip_next = True
            continue
        if t in UNIT_WORDS:
            skip_next = True
            continue
        if not started:
            if t[0].isdigit():
                started = True
            else:
                continue
        street.append(t)
        if len(street) >= 4:
            break
    key = " ".join(street) if len(street) >= 2 else ""
    return key, po


def zip5(z):
    z = re.sub(r"[^0-9]", "", z or "")
    return z[:5] if len(z) >= 5 else ""


def norm_city(c):
    s = ascii_upper(c)
    s = re.sub(r"[^A-Z ]+", " ", s)
    s = re.sub(r"\bSAINT\b", "ST", s)
    s = re.sub(r"\bFORT\b", "FT", s)
    s = re.sub(r"\bMOUNT\b", "MT", s)
    return " ".join(s.split())


def is_placeholder(name):
    s = " ".join(re.sub(r"[^A-Z0-9$ ]+", " ", ascii_upper(name)).split())
    if not s:
        return True
    return bool(PLACEHOLDER_PATTERNS.match(s) or PLACEHOLDER_CONTAINS.search(s))


def has_org_evidence(tokens):
    for t in tokens:
        if t in ORG_WORDS or t in SEPARATORS:
            return True
        if any(ch.isdigit() for ch in t):
            return True
    return False


def looks_like_person(raw_name):
    """Conservative: True when an unresolved name could plausibly be a natural person.

    Used only to *withhold* unresolved lines from publication, so false positives
    cost a little display recall and false negatives are what we must avoid.
    """
    s = ascii_upper(raw_name)
    if re.search(r"\b(MR|MRS|MS|DR|MISS|REV|JR|SR|II|III|IV)\b\.?", s) and not re.search(r"\b(CHURCH|SCHOOL|FOUNDATION|FUND|INC)\b", s):
        return True
    toks = name_tokens(raw_name, expand=False)
    if not toks:
        return False
    expanded = [NAME_ABBREV.get(t, t) for t in toks]
    if has_org_evidence(expanded):
        return False
    if "FAMILY" in toks or "ESTATE" in toks:
        return True
    if len(toks) == 1:
        return False  # single words are almost always org names or acronyms
    return 2 <= len(toks) <= 4 and all(t.isalpha() for t in toks)


def _load_names(fn):
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), fn)
    with open(p, encoding="utf-8") as f:
        return {line.strip() for line in f if line.strip()}


# 1990 Census given names (virtue/place words removed) and the 40,000 most common
# 2010 Census surnames. Both US-government public domain.
FIRST_NAMES = _load_names("names_first.txt")
SURNAMES = _load_names("names_last.txt")


def person_name_like(seg):
    """Precise test: 2-3 alphabetic tokens shaped like GIVEN [I] SURNAME or SURNAME GIVEN,
    with no organisation words. Used to *classify* a line as naming an individual."""
    s = " ".join(re.sub(r"[^A-Z ]+", " ", ascii_upper(seg).replace("'", "")).split())
    toks = s.split()
    if not 2 <= len(toks) <= 4:
        return False
    if has_org_evidence([NAME_ABBREV.get(t, t) for t in toks]):
        return False
    core = [t for t in toks if len(t) > 1]
    if len(core) < 2:
        return False
    first, last = core[0], core[-1]
    return (first in FIRST_NAMES and last in SURNAMES) or (first in SURNAMES and last in FIRST_NAMES)


ALL_FIRST_NAMES = _load_names("names_first.txt") | {
    "TYLER", "MADISON", "JORDAN", "MORGAN", "TAYLOR", "PARKER", "MASON", "HUNTER", "CARTER", "COOPER",
    "SPENCER", "AUSTIN", "DALLAS", "CHASE", "HOLLY", "GRACE", "HOPE", "FAITH", "JOY", "ROSE", "LILY",
    "IVY", "DAWN", "APRIL", "MAY", "JUNE", "SUMMER", "AUTUMN", "ANGEL", "CHRISTIAN", "NOEL", "HAZEL",
    "VIOLET", "JASMINE", "IRIS", "PEARL", "RUBY", "CRYSTAL", "AMBER", "JADE", "SAVANNAH", "SIERRA",
    "LINCOLN", "JACKSON", "WARREN", "GORDON", "ALLEN", "KENT", "MARION", "CLINTON", "FRANKLIN", "TROY",
}

SPLIT_MARKERS = re.compile(r"\s+-+\s+|\s*/\s*|\(|\)|\s+FBO\s+|\s+C/O\s+|\s+ATTN:?\s+|\s+%\s*|;|\s+FOR\s+")


def loose_person_segment(seg, context_scholarship=False):
    """A fragment that could be a person's name when it sits next to an org name,
    e.g. 'Tyler Pelesh - University of Tampa'. Deliberately loose."""
    s = " ".join(re.sub(r"[^A-Z, ]+", " ", ascii_upper(seg).replace("'", "")).split())
    if "," in s:
        parts = [p.strip() for p in s.split(",")]
        if len(parts) == 2 and parts[1].split() and parts[1].split()[0] in ALL_FIRST_NAMES:
            return not has_org_evidence(parts[0].split() + parts[1].split())
        s = s.replace(",", " ")
    toks = s.split()
    if not 2 <= len(toks) <= 4 or has_org_evidence([NAME_ABBREV.get(t, t) for t in toks]):
        return False
    if context_scholarship:
        return True
    core = [t for t in toks if len(t) > 1]
    return bool(core) and (core[0] in ALL_FIRST_NAMES or (len(core) >= 2 and core[-1] in ALL_FIRST_NAMES))


def strip_care_of(name):
    """Drop 'c/o Jane Doe', 'Attn: ...', '% ...' tails, which usually name a person."""
    return re.split(r"\s*(?:\bC/O\b|\bATTN\b|%|\bFBO\b|\bF/B/O\b|\bIN CARE OF\b)", name, flags=re.I)[0].strip(" ,-")


def safe_to_display(raw_name):
    """True only when no part of a filed recipient name could be a natural person."""
    name = strip_care_of(raw_name)
    if not name or looks_like_person(name):
        return False
    parts = [p for p in SPLIT_MARKERS.split(ascii_upper(name)) if p and p.strip()]
    return not any(loose_person_segment(p) for p in parts if p.strip() != ascii_upper(name).strip())


def display_filed_name(raw_name):
    """The filed payee name as it may be shown: care-of tails removed, and nothing at all
    when any remaining part could be a natural person."""
    name = strip_care_of(" ".join((raw_name or "").split()))
    return name if safe_to_display(name) else ""


ENTITY_WORD = r"(?:FOUNDATION|FDN|FUND|TRUST|INC|INCORPORATED|CORP|CORPORATION|ASSOCIATION|SOCIETY|ENDOWMENT|INSTITUTE|NFP|LTD|LLC)"
FDN_CARE_OF = re.compile(r"\s*(?:\bC/[O0]\b|%|\bATTN\b|\bATTENTION\b|\bIN CARE OF\b).*$", re.I)
FDN_CO_TAIL = re.compile(r"(\b" + ENTITY_WORD + r")\.?,?\s+CO\b.*$", re.I)  # "X FOUNDATION CO JOHN DOE"
NAME2_SKIP = re.compile(r"^\(?\s*(?:AKA|A/K/A|FKA|F/K/A|NKA|N/K/A|DBA|D/B/A|FORMERLY|FOUNDED BY|SUCCESSOR|C/0|CO|C O|ATTN|ATTENTION|CARE OF)\b")
NAME2_TRUSTEE = re.compile(r"\b(?:TRUSTEES?|TTEES?|TR|BANK|N\.?\s?A|TRUST CO(?:MPANY)?|WEALTH|ADVISORS?|LLP|CPAS?|ESQ|AGENT|EXECUTORS?|ADMINISTRATORS?|PRIVATE CLIENT|FIDUCIARY|ATTORNEYS?|PLLC|PC)\b")
NAME2_INSTRUMENT = re.compile(r"\s*\b(?:U/?A/?D?|U/?W|UTA|DTD|DATED)\b.*$")
NAME2_CONTINUES = re.compile(r"^(?:FOR|OF|AND|&|IN|TO|ON|AT|THE)\b")
NAME2_ENTITY_ONLY = re.compile(r"^(?:(?:CHARITABLE|FAMILY|MEMORIAL|PRIVATE|SUPPORTING)\s+)*" + ENTITY_WORD + r"(?:\s+(?:INC|INCORPORATED|CORP|LTD|NFP|LLC))?\.?$")


def foundation_name(line1, line2=""):
    """A filer's own name for display. The e-file splits long names across two lines
    ("THE JOHN AND JANE DOE" / "FAMILY FOUNDATION"), and the lines also carry care-of
    contacts, trustees, and a.k.a. names. Keeps continuations, drops the rest."""
    n1 = " ".join((line1 or "").split())
    n1 = FDN_CO_TAIL.sub(r"\1", FDN_CARE_OF.sub("", n1)).strip(" ,-")
    n2 = " ".join((line2 or "").split())
    u1, u2 = ascii_upper(n1), ascii_upper(n2)
    if not n1 or not n2 or u2 == u1 or NAME2_SKIP.match(u2):
        return n1
    n2 = NAME2_INSTRUMENT.sub("", strip_care_of(n2)).strip(" ,-")
    u2 = ascii_upper(n2)
    if not n2 or NAME2_TRUSTEE.search(u2) or looks_like_person(n2):
        return n1
    if re.search(r"\b" + ENTITY_WORD + r"\.?$", u1) and not (NAME2_CONTINUES.match(u2) or NAME2_ENTITY_ONLY.match(u2)):
        return n1
    return f"{n1} {n2}"


HONOREE = re.compile(r"\b(IN (?:LOVING )?(?:MEMORY|HONOU?R) OF|HONORING|MEMORIAL FOR|IN MEMORIAM|TRIBUTE TO)\b.*$", re.I)


def purpose_is_sensitive(purpose):
    return bool(PURPOSE_IDENTIFIES_PERSON.search(ascii_upper(purpose)))


def public_purpose(purpose):
    """Purpose text safe to publish: withheld when it identifies a beneficiary,
    honoree names replaced."""
    p = " ".join((purpose or "").split())
    if not p or purpose_is_sensitive(p):
        return ""
    return HONOREE.sub(lambda m: m.group(1) + " [name withheld]", p)[:240]


def money(v):
    try:
        return int(round(float(str(v).replace(",", "").strip() or 0)))
    except ValueError:
        return 0


def fmt_ein(ein):
    ein = re.sub(r"[^0-9]", "", str(ein or ""))
    return ein.zfill(9) if ein else ""
