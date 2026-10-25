# WHOFUNDS: product one-pager

**User.** The development director or grant writer at a small or mid-size US nonprofit ($250K–$10M budget, 1–3 people raising money). Secondary users: program officers looking for co-funders, and journalists or researchers tracing money.

**Painful job.** "Find foundations that fund organizations like mine, with evidence." Today that means paying for a commercial grants database ($1,000–$3,000+ a year, with a licence that bans reuse), or opening private-foundation 990-PFs one at a time on ProPublica. A 990-PF lists each grantee as a name and a mailing address, with no tax ID, so nobody can query across filings for free.

**Promise (5-second version).** *Type any nonprofit. See every private foundation that paid it, how much and for what, with the IRS filing one click away. Free, no login, public domain.*

**The wedge.**
1. **"Who funds X" pages**, one for every resolved organization. People search their own name and their peers' names, and these pages answer that search.
2. **"Funders of organizations like you."** Each org page lists the foundations that fund its co-funded peers but not the org itself. That's a prospect list, built from facts, not recommendations.
3. **"Where Y's money went"** pages for every foundation, including whether it says it accepts unsolicited requests (from Part XV line 2).
4. **Open data.** A CC0 download with provenance on every edge, aimed at data journalists and civic-tech users.

**Why now.**
- E-filing has been mandatory for 990-PF since 2021, so the TY2023 record is close to complete as XML.
- The GivingTuesday Data Lake makes that XML free to bulk-read.
- In Sep 2025, 14 sector groups (Candid and Charity Navigator among them) formally complained to the IRS about grants-data gaps. The audience already cares.
- The incumbent dataset's licence forbids redistribution and ML use. Open, ID-resolved grant data doesn't exist.

**Activation metric (the one number).** **Funder opened:** a visitor on an organization page clicks through to at least one funder (the foundation's page or its source filing). It's instrumented as the `funder_open` event. Weekly activated visitors is the number to grow.

**First revenue event.** The first paid **Prospect Alerts** subscription: an email whenever a foundation that funds your peers files a new 990-PF, plus a prospect export with application details. It can't honestly be sold until a second tax year lands, so v1 collects alert signups as the demand test (no payments in v1).

**v1 deliberately won't:**
- rate, score, rank by quality or recommend anyone (facts and provenance only);
- publish individual recipients, contact persons or officers;
- guess when unsure (refusing a match beats a wrong edge);
- cover 990 Schedule I (public-charity grants) or years other than TY2023;
- take payments, require logins or use ads.
