"""Tests for the WHOFUNDS pipeline (standard library only).

  python3 -m unittest discover -s tests -v
"""

import csv
import glob
import gzip
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))

import common  # noqa: E402
import extract_pf_grants as ex  # noqa: E402
import resolve_eins as rs  # noqa: E402
from common import (is_placeholder, looks_like_person, name_tokens, norm_street, public_purpose,  # noqa: E402
                    safe_to_display)


def grant(name, **kw):
    r = {"recipient_kind": "business", "recipient_name": name, "recipient_name2": "", "addr1": "", "addr2": "",
         "city": "", "state": "MA", "zip": "", "country": "US", "foreign": "0", "foundation_status": "PC",
         "purpose": "GENERAL SUPPORT", "amount": "1000", "filer_ein": "999999999", "section": "paid"}
    r.update(kw)
    return r


class Normalisation(unittest.TestCase):
    def test_line_numbering_and_legal_suffix(self):
        self.assertEqual(name_tokens("(580) NEW LONDON BARN PLAYHOUSE INC"), ["NEW", "LONDON", "BARN", "PLAYHOUSE"])

    def test_spaced_acronym_and_abbreviations(self):
        self.assertEqual(name_tokens("N A A C P Legal Defense & Educ Fund")[:1], ["NAACP"])
        self.assertEqual(name_tokens("St. Jude Children's Research Hosp"), ["SAINT", "JUDE", "CHILDRENS", "RESEARCH", "HOSPITAL"])

    def test_numbers_survive(self):
        self.assertIn("1", name_tokens("1 WORKER 1 VOTE INC"))

    def test_street_keys(self):
        self.assertEqual(norm_street("P.O. Box 924"), ("", "924"))
        self.assertEqual(norm_street("1350 Massachusetts Avenue Suite 801")[0], "1350 MASSACHUSETTS AVE")
        self.assertEqual(norm_street("100 N Main Street #200")[0], "100 N MAIN ST")


class Placeholders(unittest.TestCase):
    def test_positives(self):
        for n in ["SEE ATTACHED", "See Statement 17", "VARIOUS NEEDY PATIENTS", "ATCH 4", "GRANTS",
                  "HIPPA REGULATIONS PREVENT LISITNG OF NAMES", "Eligible Patients (See Schedule #2)",
                  "NATIONWIDE FOUNDATION 2023 GRANTS", ""]:
            self.assertTrue(is_placeholder(n), n)

    def test_negatives(self):
        for n in ["HABITAT FOR HUMANITY", "GRANTS PASS SCHOOL DISTRICT", "ATCHISON HOSPITAL",
                  "THE FOUNDATION FOR THE CAROLINAS", "SEEDS OF PEACE"]:
            self.assertFalse(is_placeholder(n), n)


class Individuals(unittest.TestCase):
    def test_named_people_are_individuals(self):
        cases = [
            grant("Tyler Pelesh - University of Tampa", purpose="Scholarship Recipient", foundation_status="I"),
            grant("Kiley Dion - Dean College", purpose="Scholarship Recipient"),
            grant("CURRY COLLEGE FBO ALLYSON FOYE", purpose="SCHOLARSHIP"),
            grant("TAIBAT O AHMED", foundation_status="N/A", purpose="SCHOLARSHIP"),
            grant("Aidan Fitzpatrick", foundation_status="I", purpose="Scholarship"),
            grant("SMITH, JOHN", purpose="EDUCATION"),
            grant("", recipient_kind="person"),
            grant("VARIOUS NEEDY PATIENTS", purpose="PHARMACEUTICAL PRODUCTS TO NEEDY PATIENTS"),
        ]
        for r in cases:
            self.assertEqual(rs.classify(r), "individual", r["recipient_name"])

    def test_organisations_are_not(self):
        for name in ["HABITAT FOR HUMANITY - GREATER BOSTON", "PINE STREET INN", "UNIVERSITY OF MASSACHUSETTS - AMHERST",
                     "NORTHEASTERN UNIVERSITY-J", "YMCA - SOUTH SHORE", "DANA FARBER CANCER INSTITUTE - PAN MASS CHALLENGE"]:
            self.assertEqual(rs.classify(grant(name)), "", name)

    def test_other_scopes(self):
        self.assertEqual(rs.classify(grant("SEE ATTACHED LIST")), "unitemized")
        self.assertEqual(rs.classify(grant("", recipient_kind="placeholder")), "unitemized")
        self.assertEqual(rs.classify(grant("UNIVERSITY OF OXFORD", foreign="1", country="UK")), "foreign")

    def test_display_gate(self):
        self.assertFalse(safe_to_display("Tyler Pelesh - University of Tampa"))
        self.assertFalse(safe_to_display("JOHN SMITH"))
        self.assertEqual(common.display_filed_name("XYZ SCHOOL C/O JANE DOE"), "XYZ SCHOOL")
        self.assertEqual(common.display_filed_name("Tyler Pelesh - University of Tampa"), "")
        self.assertTrue(safe_to_display("GREATER BOSTON FOOD BANK"))
        self.assertTrue(looks_like_person("MARY BAKER"))

    def test_purpose_scrub(self):
        self.assertEqual(public_purpose("SCHOLARSHIP FOR JOHN SMITH"), "")
        self.assertEqual(public_purpose("TUITION FOR STUDENT"), "")
        self.assertEqual(public_purpose("In memory of Jane Doe"), "In memory of [name withheld]")
        self.assertEqual(public_purpose("GENERAL OPERATING SUPPORT"), "GENERAL OPERATING SUPPORT")


def bmf_row(ein, name, street, city, state, zip_, rev="0"):
    return {"EIN": ein, "NAME": name, "STREET": street, "CITY": city, "STATE": state, "ZIP": zip_,
            "SUBSECTION": "03", "FOUNDATION": "15", "NTEE_CD": "", "REVENUE_AMT": rev, "INCOME_AMT": rev,
            "ASSET_AMT": "0", "AFFILIATION": "3", "GROUP": "0000"}


class Resolver(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        rows = [
            bmf_row("111111111", "OAKLAND UNIVERSITY", "2200 N SQUIRREL RD", "ROCHESTER", "MI", "48309", "500000000"),
            bmf_row("222222222", "OAKLAND UNIVERSITY FOUNDATION", "2200 N SQUIRREL RD", "ROCHESTER", "MI", "48309"),
            bmf_row("333333333", "LINCOLN ELEMENTARY PTA 12", "1 SCHOOL ST", "SPRINGFIELD", "IL", "62701"),
            bmf_row("444444444", "YALE UNIVERSITY", "PO BOX 208239", "NEW HAVEN", "CT", "06520", "4000000000"),
            bmf_row("444444445", "YALE UNIVERSITY", "PO BOX 209010", "NEW HAVEN", "CT", "06520", "50000"),
            bmf_row("555555555", "THE GENERAL HOSPITAL CORPORATION", "55 FRUIT ST", "BOSTON", "MA", "02114", "3000000000"),
            bmf_row("666666666", "JEWISH COMMUNITY CENTERS OF GREATER BOSTON INC", "333 NAHANTON ST", "NEWTON", "MA", "02459"),
            bmf_row("666666667", "JEWISH FAMILY AND CHILDRENS SERVICE", "333 NAHANTON ST", "NEWTON", "MA", "02459"),
            bmf_row("777777777", "CHILDRENS HOSPITAL LOS ANGELES", "4650 SUNSET BLVD", "LOS ANGELES", "CA", "90027", "2000000000"),
            # fillers so token IDF behaves like a real registry
            *[bmf_row(f"9{i:08d}", f"FILLER ORGANIZATION {i} SERVICES", f"{i} ELM ST", "TOWN", "TX", "75001") for i in range(200)],
        ]
        rs.G.clear()
        rs.G.update(rs.build_index({}, rows))
        rs.G["aliases"] = {"".join(name_tokens("MASSACHUSETTS GENERAL HOSPITAL")): [(rs.G["ein_ix"]["555555555"], None, False)]}
        rs.G["cache"] = {}

    def line(self, name, addr="", city="", state="", z=""):
        return rs.resolve_line(grant(name, addr1=addr, city=city, state=state, zip=z))

    def test_exact_address(self):
        out = self.line("Oakland University", "2200 North Squirrel Road", "Rochester", "MI", "48309")
        self.assertEqual((out["scope"], out["recipient_ein"], out["strategy"]), ("resolved", "111111111", "ADDR_EXACT_NAME"))
        self.assertTrue(out["runner_up_ein"] == "" or out["runner_up_ein"] != "111111111")

    def test_foundation_veto(self):
        out = self.line("OAKLAND UNIVERSITY FOUNDATION", "2200 N SQUIRREL RD", "ROCHESTER", "MI", "48309")
        self.assertEqual(out["recipient_ein"], "222222222")
        out = self.line("OAKLAND UNIVERSITY", "PO BOX 1", "ROCHESTER", "MI", "48309")
        self.assertNotEqual(out["recipient_ein"], "222222222")

    def test_numbers_must_agree(self):
        out = self.line("LINCOLN ELEMENTARY PTA 21", "1 SCHOOL ST", "SPRINGFIELD", "IL", "62701")
        self.assertNotEqual(out["scope"], "resolved")

    def test_shared_campus_refuses_weak_names(self):
        out = self.line("JEWISH BIG BROTHERS BIG SISTERS OF GREATER BOSTON", "333 NAHANTON ST", "NEWTON", "MA", "02459")
        self.assertEqual(out["scope"], "unmatched")

    def test_dominant_entity(self):
        out = self.line("YALE UNIVERSITY", "2 WHITNEY AVE", "NEW HAVEN", "CT", "06510")
        self.assertEqual((out["scope"], out["recipient_ein"]), ("resolved", "444444444"))

    def test_alias(self):
        out = self.line("MASSACHUSETTS GENERAL HOSPITAL", "C/O BANK OF AMERICA 100 FEDERAL ST", "BOSTON", "MA", "02110")
        self.assertEqual((out["scope"], out["recipient_ein"], out["strategy"]), ("resolved", "555555555", "ALIAS"))

    def test_ein_written_on_the_line(self):
        out = self.line("CHILDRENS HOSPITAL LOS ANGELES FED ID 77 7777777", "", "LOS ANGELES", "CA", "")
        self.assertEqual((out["recipient_ein"], out["strategy"]), ("777777777", "EIN_IN_TEXT"))

    def test_refusal_keeps_nearest_for_fixit(self):
        out = self.line("OAKLAND U ATHLETICS", "PO BOX 9", "ROCHESTER", "MI", "48309")
        if out["scope"] == "unmatched" and out["nearest_ein"]:
            self.assertEqual(out["strategy"], "")


XML = b"""<?xml version="1.0" encoding="utf-8"?>
<Return xmlns="http://www.irs.gov/efile"><ReturnHeader>
<TaxPeriodEndDt>2023-12-31</TaxPeriodEndDt><TaxPeriodBeginDt>2023-01-01</TaxPeriodBeginDt>
<Filer><EIN>123456789</EIN><BusinessName><BusinessNameLine1Txt>TEST FAMILY FOUNDATION</BusinessNameLine1Txt></BusinessName>
<USAddress><AddressLine1Txt>1 MAIN ST</AddressLine1Txt><CityNm>BOSTON</CityNm><StateAbbreviationCd>MA</StateAbbreviationCd><ZIPCd>02110</ZIPCd></USAddress></Filer>
<TaxYr>2023</TaxYr></ReturnHeader>
<ReturnData><IRS990PF><FMVAssetsEOYAmt>1000000</FMVAssetsEOYAmt><SupplementaryInformationGrp>
<ApplicationSubmissionInfoGrp><RecipientPersonNm>JANE CONTACT</RecipientPersonNm><RecipientPhoneNum>5555555555</RecipientPhoneNum>
<FormAndInfoAndMaterialsTxt>LETTER</FormAndInfoAndMaterialsTxt></ApplicationSubmissionInfoGrp>
<GrantOrContributionPdDurYrGrp><RecipientBusinessName><BusinessNameLine1Txt>GREATER BOSTON FOOD BANK</BusinessNameLine1Txt></RecipientBusinessName>
<RecipientUSAddress><AddressLine1Txt>70 S BAY AVE</AddressLine1Txt><CityNm>BOSTON</CityNm><StateAbbreviationCd>MA</StateAbbreviationCd><ZIPCd>02118</ZIPCd></RecipientUSAddress>
<RecipientFoundationStatusTxt>PC</RecipientFoundationStatusTxt><GrantOrContributionPurposeTxt>GENERAL</GrantOrContributionPurposeTxt><Amt>5000</Amt></GrantOrContributionPdDurYrGrp>
<GrantOrContributionPdDurYrGrp><RecipientPersonNm>JOHN STUDENT</RecipientPersonNm>
<RecipientUSAddress><AddressLine1Txt>9 HOME RD</AddressLine1Txt><CityNm>SALEM</CityNm><StateAbbreviationCd>MA</StateAbbreviationCd><ZIPCd>01970</ZIPCd></RecipientUSAddress>
<GrantOrContributionPurposeTxt>SCHOLARSHIP</GrantOrContributionPurposeTxt><Amt>2000</Amt></GrantOrContributionPdDurYrGrp>
<GrantOrContributionPdDurYrGrp><RecipientPersonNm>GRANTS</RecipientPersonNm>
<RecipientUSAddress><AddressLine1Txt>SEE ATTACHED PDF</AddressLine1Txt><CityNm>BOSTON</CityNm><StateAbbreviationCd>MA</StateAbbreviationCd><ZIPCd>02110</ZIPCd></RecipientUSAddress>
<Amt>90000</Amt></GrantOrContributionPdDurYrGrp>
<TotalGrantOrContriPdDurYrAmt>97000</TotalGrantOrContriPdDurYrAmt></SupplementaryInformationGrp></IRS990PF></ReturnData></Return>"""


DETERMINISM_SCRIPT = r"""
import json, sys
sys.path.insert(0, sys.argv[1])
import test_pipeline as t
import resolve_eins as rs
t.Resolver.setUpClass()
names = ["Oakland University", "OAKLAND UNIVERSITY FOUNDATION", "YALE UNIVERSITY", "JEWISH BIG BROTHERS BIG SISTERS OF GREATER BOSTON",
         "MASSACHUSETTS GENERAL HOSPITAL", "FILLER ORGANIZATION 7 SERVICES", "FILLER ORGANISATION SERVICES 7"]
out = [rs.resolve_line(t.grant(n, addr1="2200 N SQUIRREL RD", city="ROCHESTER", state="MI", zip="48309")) for n in names]
print(json.dumps(out, sort_keys=True))
"""


class Determinism(unittest.TestCase):
    def test_same_output_under_different_hash_seeds(self):
        import subprocess
        here = os.path.dirname(os.path.abspath(__file__))
        outs = []
        for seed in ("1", "2"):
            env = dict(os.environ, PYTHONHASHSEED=seed, PYTHONPATH=os.path.join(ROOT, "pipeline") + os.pathsep + here)
            outs.append(subprocess.run([sys.executable, "-c", DETERMINISM_SCRIPT, here], env=env, capture_output=True,
                                       text=True, check=True).stdout)
        self.assertEqual(outs[0], outs[1])
        self.assertIn('"scope": "resolved"', outs[0])


class Extractor(unittest.TestCase):
    def test_parse_and_privacy(self):
        filer, grants = ex.parse(XML, {"ein": "123456789", "object_id": "202400000000000001"})
        self.assertEqual(filer["name"], "TEST FAMILY FOUNDATION")
        self.assertEqual(filer["total_paid_stated"], 97000)
        self.assertEqual(filer["n_paid_lines"], 3)
        self.assertNotIn("JANE CONTACT", repr(filer))          # contact person never extracted
        self.assertNotIn("5555555555", repr(filer))
        kinds = [g["recipient_kind"] for g in grants]
        self.assertEqual(kinds, ["business", "person", "placeholder"])
        person = grants[1]
        self.assertEqual((person["recipient_name"], person["addr1"], person["purpose"]), ("", "", ""))
        self.assertNotIn("JOHN STUDENT", repr(grants))
        self.assertEqual(grants[0]["recipient_name"], "GREATER BOSTON FOOD BANK")


class Release(unittest.TestCase):
    """Checks the real release file when it has been built (skipped otherwise)."""
    _found = sorted(glob.glob(os.path.join(ROOT, "data", "release", "whofunds_ty*_grants.csv.gz")))
    PATH = _found[-1] if _found else os.path.join(ROOT, "data", "release", "missing.csv.gz")

    @unittest.skipUnless(os.path.exists(PATH), "release not built")
    def test_no_individuals_and_provenance(self):
        n = 0
        with gzip.open(self.PATH, "rt", newline="") as f:
            for r in csv.DictReader(f):
                n += 1
                self.assertIn(r["scope"], ("resolved", "unmatched", "foreign"))
                self.assertTrue(r["source_filing_url"].startswith("https://projects.propublica.org/"))
                if r["scope"] == "resolved":
                    self.assertEqual(len(r["recipient_ein"]), 9)
                    self.assertTrue(r["match_score"] and r["strategy"])
                if r["recipient_name_as_filed"]:
                    self.assertTrue(safe_to_display(r["recipient_name_as_filed"]), r["recipient_name_as_filed"])
                if n >= 300000:
                    break
        self.assertGreater(n, 1000)


if __name__ == "__main__":
    unittest.main()
