# Research agenda for the first three outbound agents

**Status: draft v1, November 13, 2026.** Companion to `outbound-plan.md`. Written from the website repository and general knowledge of this market. Nothing here has been checked against live sources, by a principal, or by counsel. **[verify]** marks a claim I believe but did not confirm.

> **Where this lives.** This is the private outbound repository. It was split out of the public website repository (`joshrkay/Valley-Capital-partner`, PR #9, merge commit `8865c88`) on November 13, 2026. Paths such as `desk/...`, `scripts/desk/...`, `src/pages/...`, `docs/voice.md` and `docs/terminology.md` refer to the website repository, where the news desk lives. The few website files these rules depend on are copied into `site-snapshot/` (see the README).

**What this is.** For each of the three agents, the research it has to do, where it looks, how a finding counts as established, and what has to be researched by people before the agent can be trusted. It drives the code in this repository: the briefer's playbooks (`playbooks.json`) are section 2 turned into data.

**Two kinds of research.**

- **Run-time:** the agent does it every time it runs. Only the briefer does open research on the web. The guard and the drafter do none; they use what the briefer and the people have stored.
- **Build-time:** people do it once, then keep it current. Every agent is only as good as this. It is listed per agent, with an owner and a priority.

## 0. Standards for all research

1. **Evidence tiers.** Government or regulator record, then the company's own document (filing, release, website), then reputable press, then anything else. A finding carries its tier.
2. **Every finding is a record:** the claim, a verbatim quote, the URL, publisher, publication date, retrieval date, evidence tier, and what kind of fact it is. No record, no use.
3. **Verified in code, not by the model's say-so.** The URL must be one the agent actually retrieved. The quote must appear in what was retrieved. A second, cheaper model checks that the quote supports the claim. Anything that fails is dropped; anything that cannot be checked is context only, never quoted in a message.
4. **Safe by default.** A fact is context unless it earns draft use. Facts about a specific asset, a risk, or a person's private life are never draft-use.
5. **Contradictions are reported, not smoothed.** If two sources disagree, both go in the brief.
6. **Gaps are reported.** "Could not find" is a result.
7. **Professional information only.** Role, tenure, public statements, public speaking. No family, health, home address, politics, or anything from a private source. The brief states what it did not look at.
8. **Licensing and terms.** Do not ingest paywalled or licensed content (Trepp, CoStar and similar) without a license. Do not fetch pages the site's terms forbid us to read (LinkedIn, for one). Keep short quotes, not full text.
9. **Web pages are untrusted.** The research agent has no tools that act in the world, only search and read, and its output is validated. Text on a page is data and never an instruction.
10. **Stop conditions.** Hard caps on searches, fetches and continuation turns, and a report of what was spent. A brief that ran out of budget says so.

## 1. Agent 1: the guard (suppression and cadence)

The guard is code, so it does no run-time research. It is only as good as the reference data behind it. All of this is build-time.

| # | Research | Question | Where | Owner | Output | Priority |
|---|---|---|---|---|---|---|
| G1 | **Channel and state rules** | Which channels are allowed to which recipients in which states? Calling hours by recipient time zone. Call-recording consent states. State telemarketing registration. What counts as an artificial voice or a ringless voicemail today. Which B2B exemptions apply. | FCC rulings, state statutes and regulators' pages, counsel | Counsel, with a research agent for the first pass | `rules` table the guard enforces | Before any send |
| G2 | **Our own do-not-contact set** | Every asset, party and affiliate we hold, have bid on, or have signed an NDA on. | The principals' own deal records | Principals | Suppression list, kept outside the repository | Before any send |
| G3 | **Entity graph** | If we suppress one bank, which affiliates, holding-company siblings and servicer parents go with it? | FFIEC National Information Center relationships for banks; SEC filings and corporate records for servicers and funds **[verify coverage]** | Research agent, checked by a person | Alias and affiliate lists on each suppression entry | Before pilot |
| G4 | **Who else is not a prospect** | Regulators, press, competitors, our own people, our counsel. | The principals; public deal announcements for the other note buyers | Principals | Classification lists | Before pilot |
| G5 | **Contact validity** | Is the email deliverable? Is this person still in the role? Is a phone number a business landline or a mobile? | Email verification vendor, job-change signals, line-type lookup | Vendor test on 50 known names | Verification fields on each contact; minimum-confidence threshold | Before pilot |
| G6 | **Personal-domain and role-account lists** | Which domains and local parts are never to be used? | Public lists, kept short and reviewed | Anyone | Two lists in config | Done in v1 |
| G7 | **Safe sending limits** | What volume per mailbox per day keeps bank gateways accepting our mail? | Seed-list placement tests across a spread of bank domains; sending-provider guidance **[verify]** | Whoever sets up the domain | Caps in `config.json` | During warm-up |
| G8 | **Cadence** | How many touches, how far apart, on which channels, does this audience tolerate? | No benchmark exists in this repo. Learn from the pilot. | Principals, from reply data | Sequence in `config.json` | After 60 days |
| G9 | **One person at a bank at a time** | Institutions are small worlds. The guard stops outreach to everyone at a bank after a reply or opt-out from anyone there, counts caps across the bank, and waits a quiet period (45 days is a placeholder) before starting a second contact. Is that the right rule, and the right period? Outside notes suggest 2 to 3 contacts per bank; that is a decision for the principals. | The principals, from experience | A `config.json` setting | After the pilot |

The guard's v1 ships G6 and the checks for G1, G2, G4, G5 and G8 as configuration with the shipped values marked as placeholders. Nothing in `config.json` is a researched number.

## 2. Agent 2: the briefer (deep research)

This is the agent that researches. It takes one account and one named person and produces a brief in which every claim carries a verified source.

### 2.1 The protocol

1. **Plan.** From the account type's playbook, list the questions that apply and note what the dossier already answers.
2. **Search wide, then read primary sources.** A search result is a lead, not evidence. Open the filing, the release, the regulator record, the bio page.
3. **Triangulate.** A claim needs a primary source, or two independent ones. One blog post is not enough.
4. **Record** each finding as a record (section 0.2).
5. **Report gaps and contradictions.**
6. **Screen** for reasons not to approach (2.4).
7. **Recommend an angle** at the level of the pattern, never an asset (section 2.4 of the plan).
8. **Stop** at the budget or when new searches stop adding anything.

### 2.2 Questions, by account type

Each row is a playbook question. `P` = required. The answer's evidence standard is the highest tier the question normally allows.

**Banks (community and regional)**

| ID | Question | Where to look | Standard |
|---|---|---|---|
| bank.identity | Legal name, charter and regulator, holding company, headquarters, size, ownership (public, private, mutual), any pending merger. P | FDIC BankFind, FFIEC NIC, state regulator, the bank's own site, SEC if public | Government |
| bank.exposure | How much commercial real estate by category (multifamily is its own line on the Call Report; hotel and retail are not), how much is past due or non-accrual by category, and the trend over eight quarters. How that compares with peers. P | FFIEC and FDIC Call Report data and UBPR. For public banks, the credit-quality tables in the 10-K and 10-Q, which sometimes break out hotels and retail. | Government, then company |
| bank.intent | Has the bank said it will sell, reduce or exit commercial real estate or problem loans? Has it sold loans before, to whom, through which advisor? P | Earnings releases and call transcripts, 8-K, annual report, trade press, recorded assignments of mortgage and UCC-3 assignments (past loan sales, and who bought) | Company, then press |
| bank.regulatory | Any consent order, written agreement, memorandum of understanding, or prompt-corrective-action status; any enforcement action naming the institution. | FDIC, OCC, Federal Reserve enforcement databases | Government |
| bank.people | Who holds the decision for the kind of debt we want. Title keywords by department (from outside notes the principals shared; unverified): special assets, workout, managed assets, recovery, OREO, credit resolution for non-performing and sub-performing loans; secondary marketing, whole loan, loan sales, loan syndications, capital markets for performing pools, participations and whole-loan sales; chief credit officer, chief lending officer, senior credit officer, who at a smaller bank often decides loan sales directly; and the president. For the named person: title, tenure, prior roles, public speaking, associations. Confirmed from two sources, dated. A name on a recorded affidavit, assignment of mortgage or court declaration is good evidence of the role, but it concerns a particular asset, so it is marked asset-specific and kept out of any message. P | Bank leadership pages, press releases, filings, conference speaker pages, association directories, recorded assignments of mortgage, notices of default and court declarations (the officer who signed) | Company |
| bank.access | Who advises or represents the bank (counsel, loan sale advisor, title officers, auditors), and which of those do we already know? Outside counsel named in foreclosure, receivership and bankruptcy filings is often the fastest warm path to the banker. | Filings, press, foreclosure notices, bankruptcy dockets, court filings | Company, then press |
| bank.timing | Next earnings date, recent leadership change, regulatory exam signals, conferences the person will attend. | Investor relations page, press, event sites | Company |
| bank.assets | Loans or properties publicly tied to the bank in a court or regulatory record. **Context only, never in a message.** | Court dockets, press | Government |
| bank.risk | Anything that means we should not approach now: receivership or imminent failure, an active sale process run by an advisor, adverse enforcement action against the named person. | FDIC failed-bank and receivership pages, enforcement databases, press | Government |

**Special servicers**

| ID | Question | Where to look | Standard |
|---|---|---|---|
| servicer.identity | Parent company, ownership, ratings as a special servicer, offices, scale. P | Company site, rating agency publications **[verify]**, filings | Company |
| servicer.portfolio | What they are special servicing by property type and size, and recent transfers, as far as public trust reports show. P | SEC filings for CMBS trusts (10-D, ABS-EE) **[verify field coverage]**; licensed analytics only if we hold a license | Government |
| servicer.disposition | How they resolve loans (note sales, REO sales, discounted payoffs), which advisors they use, who buys. | Press, trust reports, advisor announcements | Press, company |
| servicer.people | Named asset managers and heads of asset management for our sectors; tenure; speaking. Two-source confirmation. P | Company site, press, events | Company |
| servicer.rights | Who is the controlling class or directing certificateholder on trusts they manage, where public. | Trust documents on EDGAR | Government |
| servicer.risk | Active process with a named advisor; litigation or rating action that would make an approach unwelcome. | Press, filings | Company |

**Debt funds, mortgage REITs, bridge lenders, other lenders**

| ID | Question | Where to look | Standard |
|---|---|---|---|
| fund.identity | Type, sponsor, size, strategy, listing status. P | Company site, SEC | Company |
| fund.portfolio | Loan book by property type, non-accrual and sold-loan disclosures, maturities, the CLO or securitization structure. P | 10-K and 10-Q, investor presentations | Company |
| fund.intent | Stated plans to sell or resolve non-performing loans, and who they sold to. | Earnings materials, press | Company |
| fund.people | Heads of asset management, workouts, credit. | Company, press | Company |
| fund.risk | Same screen as banks. | | |

**Creditors' rights and restructuring counsel**

| ID | Question | Where to look | Standard |
|---|---|---|---|
| counsel.identity | Firm, office, practice group, partners handling receiverships and foreclosures. P | Firm site, state bar | Company |
| counsel.record | Public dockets: how many receivership or foreclosure filings by state and sector, for which lenders, with which receivers. | CourtListener and state court portals **[verify access]** | Government |
| counsel.standing | Bar status and any public discipline for the named lawyer. | State bar lookup | Government |
| counsel.people | The named partner: role, publications, speaking, associations. | Firm site, events | Company |

**Receivers**

| ID | Question | Where to look | Standard |
|---|---|---|---|
| receiver.record | Appointments by court, sector and year; the counsel and lenders they work with. P | Court records, press | Government |
| receiver.identity | Firm, principals, sectors, states, licensing where required. | Company site, state records | Company |

**Loan sale advisors and note brokers**

| ID | Question | Where to look | Standard |
|---|---|---|---|
| broker.identity | Firm, sectors, geographies, principals. P | Company site | Company |
| broker.activity | Public closed-deal and offering announcements: size, sector, lender type. | Press, company site | Company, press |
| broker.clients | Which lenders and servicers they act for, where public. | Press, company site | Company |

### 2.3 What the briefer never does

- No asset-level claim in a draftable section. Asset facts live under "Context only" and are marked.
- No private or sensitive personal information, and no inference about a person's circumstances.
- No fetching of LinkedIn or other terms-barred pages, and no use of a licensed source without a license.
- No guessing at an email address, phone number or personal contact.
- No recommendation to approach a party that the screen flags.

### 2.4 Verification in code

Every finding is checked after the model returns:

1. **URL provenance.** The cited URL must be one the agent retrieved in this run (from the search or fetch results the API returned). A URL the agent did not retrieve is invented. Drop.
2. **Quote.** The quote must appear in the retrieved text for that URL. Where the text is not available to us (some search results are returned encrypted), the finding is marked **unchecked**: it stays in the brief as context and is never quoted in a message unless a second independent source corroborates it.
3. **Support.** A second, cheaper model reads each claim with its quote and answers yes, partly, or no. "No" drops the finding. "Partly" makes it context only.
4. **Draft use is earned.** A finding can be used in a draft only if it is verified, comes from an acceptable tier, is not about a specific asset, and is not a risk or private matter.
5. **Staleness.** Findings carry their date. Roles and statements older than the configured limit are flagged in the brief.

### 2.5 Cost and limits

Deep research is the expensive step. Caps are in `models.json`: searches, fetches, continuation turns and output tokens, per account. The run reports what it used. **The first run measures the real cost; I have not.** Use it on Tier A accounts only. If quality is short, raise effort before raising the model; the one place a top-tier model may genuinely pay for itself is this one, and it is a one-line change.

### 2.6 Build-time research the briefer needs

| # | Research | Why | Owner |
|---|---|---|---|
| B1 | **Test set of real accounts** (10 to 15 the principals already know well) with a hand-written "what is true" sheet. | The only way to tell whether the briefer's findings are right, complete and not invented. Score precision (is it true), recall (did it find what we know), and fabrication (zero tolerance). | Principals, one hour |
| B2 | **Which sources are readable.** Test the fetch tool against the major source sites (FDIC, FFIEC, EDGAR, regulator pages, court portals, bank sites). Many are script-heavy or block automated readers. | Tells us which playbook questions the web agent can answer and which need a data adapter (agents 4 and 5). | Research agent |
| B3 | **Public-bank disclosure patterns:** which banks break out hotel, multifamily and retail in their filings. | Decides which exposure questions get a real number and which stay "not disclosed." | Research agent |
| B4 | **Advisor and buyer map:** who runs loan sales for banks and servicers, and who buys, from public announcements. Candidates named in an outside note the principals shared, all unverified: DebtX, Garnet Capital, First Financial Network, Mission Capital (the note says it is part of Marcus & Millichap; confirm), Eastdil Secured. Confirm each exists, who owns it, what it sells, and how a buyer registers. | Seeds `bank.access`, `servicer.disposition`, and the competitor list. | Research agent, then a principal |
| B5 | **Do-not-approach rules,** reviewed by a principal: which situations mean wait. | The screen is only as good as the rules. | Principals |
| B6 | **Buyer-list requirements:** for each loan sale advisor and platform, what a buyer must provide to be placed on the list and receive offering materials (master confidentiality agreement, proof of funds, compliance screening, any fee or approval). | The outside note says mid-size and larger banks often hand loans to an advisor who runs a bid process and vets buyers, and that smaller banks more often sell directly. Unverified; the pilot should test it. | Research agent, then a principal |
| B7 | **Public-record sources for the officer who signs:** for the pilot's states and counties, what is actually reachable and at what cost: county recorders (notices of default, lis pendens, assignments of mortgage), federal bankruptcy dockets through PACER (an account and per-page fees **[verify]**), state UCC databases (UCC-3 assignments; coverage of loan sales is partial **[verify]**). | A signature on a recorded document names the lender's officer and its outside counsel, and shows which banks sell and who buys. The web fetch tool probably cannot use most of these (logins, forms, per-county layouts), so they likely need a data adapter (agents 4 and 5), a person, or a paid vendor. | Research agent, then a principal |
| B8 | **Licensed tools, and what each license allows:** which the firm holds or would buy (S&P Capital IQ Pro / SNL for executive directories, Trepp, Debtwire, Reorg, BauerFinancial, LinkedIn Sales Navigator, a conference's attendee app) and whether the terms allow feeding results to an AI agent, exporting contacts, or soliciting attendees. | Section 0.8: licensed content is not ingested without a license. Sales Navigator is for a person's own use, and LinkedIn's terms generally bar scraping and bulk export **[verify]**. Event attendee lists are usually for networking at the event, not for cold outreach **[verify]**. | Principals, counsel |

## 3. Agent 3: the drafter

The drafter does no open research. It writes from facts the briefer verified and claims people approved. Its research is mostly about what is true about the firm, and what works.

| # | Research | Question | Where | Owner | Priority |
|---|---|---|---|---|---|
| D1 | **Approved firm claims** | What can the firm truthfully say about itself in a first message: proof of funds, track record, how it closes, who it is? Each needs evidence and counsel's sign-off. Today the only approved claims are the ones already on the site. This includes whether the firm can truthfully say it is an all-cash principal buyer, how fast it closes after receiving a loan file, and that it does not retrade without a diligence finding: outside notes recommend leading with all three. The site already supports three approved statements (principal buyer, sign a confidentiality agreement first, hold to the figure unless diligence turns up a reason to change it). It does not support the rest, so they are blocked until the principals confirm and counsel approves. | The principals' records; counsel | Principals, counsel | **Blocks quality.** No track record is on the site, and banks ask. |
| D2 | **Per-audience terminology** | What does a servicer, a counsel, a receiver, a fund, a broker call the transaction and the parties? `docs/terminology.md` covers community banks only; its order of work puts regional banks and special servicers next. Outside notes offer vocabulary to test with the principals, none of it verified: sub-performing loan (SPL), "paper" and "credits" as shorthand, allonge and lost note affidavit, wet-ink original, credit file. Where a note differs from `docs/terminology.md` (for example UPB versus principal balance), the guide wins until a principal says otherwise. The aim is the principals' own real vocabulary, never a term used to suggest experience the firm has not claimed. | `docs/research/market-voice.md`, listening to the principals' own contacts, the audience's own documents | Research agent, checked by a principal | Before drafting for that audience |
| D3 | **What a credible first message contains** | What do special-assets officers, servicers and advisors respond to, and what makes them delete it? What do they ask first (who funds you, what have you closed, how do you treat the borrower)? | The principals' own sent and received mail (private; stays out of the repository), conversations with three or four contacts, public loan-sale cover letters | Principals | Before pilot |
| D4 | **How banks must run a sale** | What do banks need for a loan sale (board approval, valuation, a documented process, conflicts)? This decides what a first message can offer without looking like an off-market lowball. | The 2009 interagency policy statement on commercial real estate loan workouts **[verify current status]**, regulator guidance, counsel | Counsel | Before pilot |
| D5 | **Objections and approved answers** | The top five objections from each audience and the true, approved reply to each, for the call sheet. | Principals' experience; `market-voice.md` | Principals | Before first calls |
| D6 | **Channel formats** | Limits and norms: LinkedIn note length, email length and plain-text norms, what attachments banks' gateways accept, letter conventions. | Platform documentation, the seed-list tests (G7) | Research agent | Before pilot |
| D7 | **Sender facts** | Names, titles, phone, address, a few honest lines of background for each sender. None is on the site yet. | The principals | Principals | **Blocks any send.** |
| D8 | **An evaluation set** | Ten to twenty first messages the principals wrote and would be proud of, for each audience, with the facts behind them. Measure the drafter by how close it comes and by how much a principal edits. | The principals | Principals | During pilot |
| D9 | **The credibility package** | What must exist before a bank or an advisor will share a loan tape: a proof-of-funds letter from the capital partner; a one-page, honest record of past acquisitions (type, size, collateral) that counsel has approved; and a confidentiality agreement counsel has pre-approved, ready to turn around in about a day. The site promises proof of funds with a bid and states no track record. | The principals' records; counsel | Principals, counsel | **Blocks the advisor route and any second conversation.** |

## 4. Research that crosses all three

- **Data-source catalogue.** For every source: what it holds, its terms of use, rate limits, whether it needs a declared contact (EDGAR does **[verify]**), and whether an automated reader can use it. One page, kept current.
- **Privacy.** What personal data we keep, for how long, and how a deletion request works. California's privacy law reaches business contacts **[verify]**; counsel confirms. Briefs are deleted after a set period without engagement.
- **Where data lives.** Prospect data stays outside this repository (see `outbound-plan.md`, section 7). The code enforces this: it refuses a data directory inside the repository.

## 5. Order of work

1. **Now, by people:** D7 (sender facts), D1 (approved claims), G2 (do-not-contact set), B1 (test accounts). These block everything.
2. **Now, by a research agent with web access:** B2, B3, B4, G1 (first pass), D2, D6. I can run these on request; none needs private data.
3. **With counsel:** G1, D4, privacy.
4. **First pilot run:** the briefer on the B1 accounts, scored against the principals' sheets. Fix the playbooks and prompts from what it gets wrong.
5. **Then** the drafter on the briefs that passed.

## 6. Open questions

1. Is the briefer allowed to run on any account, or only ones a principal has approved? (Code default: only accounts a principal has put in the data directory.)
2. How long do briefs and findings live? (Code default: no automatic deletion yet; set a period with counsel.)
3. Which data vendors, if any, may be used for contact details? The briefer does not look for emails or phone numbers.
