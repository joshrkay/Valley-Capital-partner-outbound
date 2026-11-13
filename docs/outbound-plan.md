# Outbound plan: finding the people who hold the notes, and getting in front of them

**Status: draft v1, November 13, 2026.** A thinking document, not a spec. Written from the website repository and from general knowledge of this market. Nothing here has been checked with a principal, with counsel, or against live data sources. Items marked **[verify]** are things I believe but did not confirm. Section 8 is a working understanding of the rules, not legal advice.

> **Where this lives.** This is the private outbound repository. It was split out of the public website repository (`joshrkay/Valley-Capital-partner`, PR #9, merge commit `8865c88`) on November 13, 2026. Paths such as `desk/...`, `scripts/desk/...`, `src/pages/...`, `docs/voice.md` and `docs/terminology.md` refer to the website repository, where the news desk lives. The few website files these rules depend on are copied into `site-snapshot/` (see the README).

**Readers:** the principals who will decide what to build, and whoever builds it.

## The short version

1. **The universe is small and everyone in it talks.** A few hundred to a few thousand people decide whether a note is sold. One careless blast does not cost a unit of "list quality"; it costs the firm's name with the people it needs. So the design goal is not volume. It is the right person, at the right moment, with a first touch that is accurate and sounds like the voice guide.
2. **Agents do the research, the paperwork and the discipline. A principal makes the touch.** Agents find signals, find people, write briefs, draft messages, enforce cadence and sort replies. A named principal sends the email, signs the letter, and dials the phone. This is the same split the news desk already uses: nothing sends itself.
3. **Rank the channels by fit, not by cost per touch.** Introductions first. Then a short plain-text email from a principal. Then a physical letter to the top accounts. Then a human phone call, with a call sheet an agent prepared. LinkedIn and events support these. Cold AI voice calls, ringless voicemail and texting are out (section 4).
4. **Two different motions hide inside "outbound."** Reaching **lenders and the people around them** (banks, servicers, funds, brokers, counsel, receivers) is the core motion and is what this plan covers. Reaching **property owners** directly is a second motion with different rules and a conflict with a promise the site makes. It waits (section 2).
5. **The agents cannot fix what is missing upstream.** The site is hidden from search engines, names no principal, lists no phone or address, and the contact mailbox may not exist (README, "Before launch"). A bank officer will check all of that within a minute of the first email. Section 9 lists what has to be true first.

## 1. Why a spray does not work here

- **A buyer of troubled loans is asking people to admit a problem.** The first message has to feel safe: confidential, no obligation, no contact with the borrower. The site already says this (`/contact/`, `/banks/confidentiality/`). The outreach must say the same thing in the same words.
- **The voice guide forbids the usual tricks.** No predatory imagery, no "opportunity" framing, no naming a distressed party, no riding a closure or a failure (`docs/voice.md`). A cold AI voicemail that says "we saw your hotel loan is in trouble" breaks every one of those rules at once.
- **Mistakes are visible and permanent.** One wrong figure, one invented "I read your post on...", one message to the wrong person at a bank that is already in a process with us, and that account is closed for years.
- **A principal's time is the real limit.** Every reply is a conversation only a principal can have. Agents must not produce more interest than the principals can follow up within a day.

## 2. Who we need to reach

| Group | Who, exactly | Why they matter | Best first channel | Agent job |
|---|---|---|---|---|
| **A. Note sellers** | Special assets heads, chief credit officers and workout officers at community and regional banks (at a small bank, the president too). Asset managers and loan sale desks at special servicers. Debt funds, mortgage REITs, bridge lenders, life companies and SBA lenders holding stressed loans. | They decide whether a note is sold and to whom. | Introduction, then email from a principal, then a letter, then a call | Find signals, name the person, brief, draft, schedule |
| **B. Intermediaries** | Loan sale advisors and note brokers. Investment sales brokers in each sector. Creditors' rights and restructuring attorneys. Receivers. Appraisers and consultants who see problems early. Title officers and bank auditors, who work beside special assets officers every day. | They hear first and they control who is invited. One relationship produces repeat flow. | Registration on advisors' buyer lists, introduction, events, a coffee | Rank them (see 3.2), track the relationship, prepare for meetings |
| **C. Property owners** | Owners and sponsors with a loan in trouble. | Source of direct property purchases and discounted-payoff capital. | Direct mail, human calls | **Not in this plan.** Later, separately. |

**Group C waits, for two reasons.** First, the site promises banks that we do not contact the borrower, guarantors, the brand or hotel staff without the sender's consent. Any owner outreach needs a hard block on every asset we are looking at, bidding on, or under NDA on. Second, owner outreach carries different legal exposure and a different reputation risk (the press has attached allegations of predatory conduct to this kind of approach, which is why the voice guide bars "path to ownership" and "loan-to-own" framing). Build the lender-side motion first and the suppression machinery with it.

**Two routes into a bank's debt** (from an outside note the principals shared; unverified, so the pilot should test it):

- **Through an advisor.** Mid-size and larger banks often hire a loan sale advisor to run a formal bid process and to vet buyers. The route in is to be on the advisor's buyer list: register, sign its master confidentiality agreement, and supply proof of funds. That needs the credibility package (section 9, and research agenda D9) before it can start.
- **Direct.** Smaller banks (the note says under about $10 billion in assets) more often sell individual loans without an advisor, to avoid fees and publicity. This is where agents 1 to 3 do most of their work.
- **First-touch ask.** Where the right person at a bank is not clear, ask who handles loan dispositions. Do not ask what the bank has for sale. A named chief credit officer or special assets head can be asked to route it, and the role check still applies.

**The three sectors change who "the holder" is.** I am reasoning from general market structure here, not from firm data **[verify with a principal]**:

- **Hospitality:** community and regional banks, CMBS special servicers, SBA lenders, and funds. The site already speaks to the first three.
- **Multifamily:** the larger pool of stress sits with banks and with floating-rate bridge lenders, their CLO managers and special servicers. Agency loans mostly are not sold as notes.
- **Retail:** banks, CMBS special servicers, life companies.

Each sector needs its own **buy box** before any of this runs (decision 1, section 11).

## 3. Discovery: signals first, then names

Find *why now* before finding *who*. A name with no reason is a cold contact. A reason with a name is a conversation.

### 3.1 Signals (what tells us an account is worth a touch)

| Signal | Where | Cost | What it says | Sectors |
|---|---|---|---|---|
| Bank non-accrual and past-due trends | FFIEC and FDIC Call Report data, bulk download | Free | Which banks are carrying more problem real estate loans, by category. Multifamily has its own line; hotel and retail do not, so they fall into broader commercial real estate lines. | All, uneven |
| Bank says it will sell | Earnings releases, 10-Q and 8-K text of public banks. EDGAR full-text search. | Free | "Plans to sell non-performing loans" is the clearest buy signal there is. | All |
| Regulatory orders | FDIC, OCC and Federal Reserve enforcement actions | Free | A bank under an order often has to cut classified assets. | All |
| Transfers to special servicing | CMBS trusts' monthly distribution reports and loan-level data on EDGAR (Form 10-D, ABS-EE) **[verify field coverage]**. Paid: CMBS analytics vendors. | Free to paid | Names the property type, status, the special servicer, and the transfer date. | All |
| Maturity walls | The same trust data, plus bridge-loan maturities | Free to paid | Loans that will not refinance. | All |
| Receiverships and foreclosure filings | County and state court dockets. Aggregators sell national data. | Free (patchy) to paid | A receiver and a lender's counsel have just been named. Mining the dockets also ranks counsel (3.2). | All |
| People moves | Licensed data providers; job postings | Paid | A new special assets head wants a first look at the book. A posting for a workout officer means a bank is building capacity. | All |
| Trade press | The news desk's existing listeners (`desk/sources.json`) | Existing | Market color, named sales, lender statements. | Hospitality now |
| Events | Speaker and attendee pages | Free | Who will be in a room we can be in. | All |

Only the trade-press row runs on the news desk's listener today. Every other row needs its own adapter (section 5.1).

**Rule: a signal about a specific asset is context for a principal, not a hook for a message.** The voice guide says to react to the pattern, not the party. An outreach draft may say "we buy hotel loans from banks that have decided to sell." It may not say "we saw the hotel on X Street laid off its staff." The brief can contain the asset; the draft cannot, unless the recipient raised it.

### 3.2 Names (getting from an institution to a person)

1. **Start from the institution, then the role,** not from a bought list of titles. For a bank: who runs special assets or credit, and at a small bank, the president. For a servicer: the asset manager on the trust's loans, found through the trust's own reports. For a fund: the head of asset management or workouts.
2. **Rank intermediaries from the record.** Counting the lender's counsel and the receivers named on court filings, by state and sector, gives a list of who does the most work. Attorneys are findable through bar directories and firm sites.
3. **Waterfall enrichment for contact details.** Try the sources in order, verify the address before it is used, and stop when verified. **Test any data vendor first:** take 50 people the principals already know and see which vendor finds them correctly. Coverage in this niche is uneven and vendor claims will not tell you.
4. **Every contact carries provenance:** where each field came from, when it was found, how confident the match is. This is for deletion requests, for accuracy, and so a principal can see why a name is there.
5. **Never use** personal email addresses, personal mobile numbers, or anyone's data from a source we cannot name.
6. **Public records name the people who act.** A notice of default, an assignment of mortgage, a bankruptcy declaration or a relief-from-stay motion names the officer who signed for the lender and the outside counsel. That is good evidence of who holds the role and a map of warm paths through counsel. It is also about a particular asset, so it is context for a principal and **never something to mention in a message**. Reaching the bank through its counsel or title officer is often the fastest warm path.

### 3.3 The account list

Two tiers, not one big list.

- **Tier A (target 100 to 300 accounts):** named person, a brief written for them, a human-made first touch, a letter. Selected by signal strength and fit with the buy box.
- **Tier B (everyone else that fits):** a lighter touch (plain-text email from a principal at a modest rate, content, events), and promotion to Tier A when a signal fires.

## 4. Channels, ranked for this audience

| # | Channel | Fit for this audience | Who acts | What the agent does | Main risk |
|---|---|---|---|---|---|
| 1 | **Introduction** | Highest. A warm path beats every other channel. | A principal asks a mutual contact | Reads the principals' own contact exports and email history (with their consent) and finds first- and second-degree paths. Drafts the *request to the connector*, not a pitch to the target. | Burning a relationship by over-asking. Cap asks per connector. |
| 2 | **Plain-text email from a principal's own mailbox** | High. It is what these people expect, and the site has the answers. | A principal sends | Researches, drafts, lints, queues for approval. Links to one page on the site (for example `/banks/information-to-send/`). | Deliverability (bank gateways are strict). Section 4.1. |
| 3 | **Letter on letterhead, signed** | High for Tier A. Senior bankers still open mail, and few get any. | A principal signs | Drafts the letter and the one-pager, verifies the address, sends through a print-and-mail service. | Cost per piece, so Tier A only. |
| 4 | **Phone, human-dialed** | High once there is a reason to call (a signal, an email already sent). It is how many of these conversations start. | A principal calls | Prepares the **call sheet**: who, why now, three facts, an opening line, objections, best times. Logs the outcome. | Calling without a reason. Calling mobiles. Recording without consent (section 8). |
| 5 | **Voicemail, left by a human** | Fine as a short follow-up to a real call attempt. | A principal | The call sheet includes a 20-second script. | None beyond the call rules. |
| 6 | **LinkedIn** | Medium. Good for awareness and for checking a person is real. | A principal, from their own account | Drafts a connection note; drafts a short post from existing site content. Never operates the account. | LinkedIn bans automation. Personal account at risk. |
| 7 | **Content and an opt-in note** | Medium, slow, compounding. The blog and the monthly Hotel loan watch are already this. | The news desk, then a person | Extend the desk to multifamily and retail when the buy box exists. | Quality. The desk's lint and review gate stay. |
| 8 | **Events and meetings** | High for Group B. | A principal | Pulls speaker and exhibitor lists, proposes who to meet, writes the brief for each meeting and the follow-up. | Time and travel cost. |

Events worth checking for Group B (from the same note; unverified): the Information Management Network (IMN) distressed real estate and note conferences, Turnaround Management Association events, Risk Management Association regional chapters, NAIOP, the Urban Land Institute, and state bankers' associations.

### 4.4 Restraint and a quarterly rhythm (from outside notes; unverified)

The notes the principals shared agree on restraint: a short first email (under about 100 words), a call two or three days after it, one follow-up a week or so later, and then no more than one touch a quarter, timed three or four weeks before quarter-end (March, June, September, December) when banks feel balance-sheet pressure to clear problem assets. Weekly follow-up reads as desperation. They also describe a zero-ask nurture: short notes sharing useful public market information.

Our placeholder sequence is heavier: five touches in about 18 days. **I recommend a lighter first sequence (letter, email, call, one follow-up email) and a quarterly nurture of zero-ask notes built from the firm's own published research** (the news desk and the monthly Hotel loan watch), public sources only, never deal flow, and never a recommendation of a named receiver or other third party without counsel. The guard ends a sequence at `SEQUENCE_COMPLETE` today; nurture timing is not built. Decision 9.

### 4.1 What we will not do, and why

- **No AI-voiced outbound calls and no AI voicemail to prospects.** The FCC has said an AI-generated voice is an "artificial voice" under the TCPA (2024) and that ringless voicemail counts as a call (2022) **[verify current status]**. That means consent rules for mobile numbers and state-law exposure. More important, the first sentence a bank officer hears from this firm should be a person.
- **No text messages and no WhatsApp.** No consent, wrong channel for this audience.
- **No automated LinkedIn tools.**
- **No tracking pixels or click-tracking links in cold email.** Bank security gateways quarantine them and recipients distrust them.
- **No cold email through a transactional email service.** The firm already has Resend connected. Its use is transactional and opt-in mail, such as the newsletter. Most such providers prohibit unsolicited or purchased-list mail in their terms and can suspend an account and damage its sending reputation **[verify the provider's current acceptable use policy]**. Use real mailboxes on a separate sending domain, or a sequencing tool built for it.
- **No blast.** Daily send caps per mailbox, set low and raised only when replies and bounces stay healthy.
- **No "certainty of execution", "all-cash" or "close in N days" language** until the firm confirms it can deliver each one and counsel approves it. The outside note's sample opener leans on exactly these. The claims system blocks them by design (`claims.json`); the site's own approved wording is "no financing contingency" and "proof of funds is provided with a bid."

### 4.2 Email mechanics that decide whether anyone sees it

- Authentication on the sending domain (SPF, DKIM, DMARC) and a warm-up period before real sends.
- Send from a secondary domain close to the main one, so a reputation problem does not reach `valleycapitalpartner.com`. (Note that the domain in the site's own contact address, `valleycapitalpartner.com`, is singular "partner" while the firm name is "Partners." Decide the canonical domain before any mail goes out.)
- Plain text. Under 120 words. One link at most. No attachment on a first touch. A real signature with a name, a role, a phone number and a street address (the address is also a legal requirement, section 8).
- Reply-to goes to the principal, not to a shared inbox.

### 4.3 A first-touch sequence for a Tier A account (an example to react to, not a tested sequence)

| Day | Touch | Notes |
|---|---|---|
| -3 | Letter mailed | Lands near day 0. One page. Names the person. Says what we do and what we do not do. |
| 0 | Email from the principal | Short, plain. References the letter. Links to one site page. |
| 4 | LinkedIn connection request | Only if the principal already uses the account for this. |
| 8 | Call, then a short voicemail if no answer | Human. With the call sheet. |
| 15 | Second email | One useful thing: a post or Library note that fits the account's situation. Not "just following up." |
| 45 | Check for a new signal | If one fired, one new touch that references the pattern, not the asset. |
| 90 | Stop | Move to quarterly nurture. Never more than five or six touches in 90 days. |

Any "no" or opt-out is permanent. A reply of any kind stops the sequence and alerts a principal.

## 5. The agents

Pattern: **code first, a cheap model to sort, a mid-tier model to write, a person decides, and no agent has a path to send.** This is how `scripts/desk/` is built: the model returns JSON, the script builds the artifact and runs the checks, and nothing publishes itself. What carries over is the pattern, the test kit, the model config (`desk/models.json`) and the banned-word list. What does not carry over is covered in 5.1: the desk's listener reads only RSS and one JSON feed, and its guard checks only numbers, links and names.

| # | Agent | Job | Autonomy | Model and effort | When |
|---|---|---|---|---|---|
| 1 | **Suppression and cadence guard** | Blocks any touch to a suppressed account, caps volume, enforces the sequence, stops on reply, keeps an audit log. | Code only, no model | none | First |
| 2 | **Briefer** | One page per account before any touch: the institution's exposure and trend, the signals, the person, shared connections, what they have said in public, a suggested angle, and the source for every fact. | Research only, no outside effect | Sonnet, high effort | First |
| 3 | **Drafter** | Email, letter, LinkedIn note, call sheet, in the voice. Code checks banned words, per-audience terminology, invented figures, invented personalization, and anything naming a party. | Drafts only. A person approves each one. | Sonnet, high effort | First |
| 4 | **Signal watcher** | Daily. Reads the signals in 3.1 through source adapters (5.1), resolves each to one institution, dedupes, scores, and writes "why now" cards. | Research only | Haiku, low effort, plus code | Second |
| 5 | **Account ranker and contact finder** | Builds and ranks the account list from public data; finds and verifies the named person; records provenance. | Research only | Code; Haiku for title and role matching | Second |
| 6 | **Reply triage** | Sorts replies: interested, not now, wrong person, opt-out, bounce, out of office. Processes opt-outs at once. Alerts a principal on "interested." Never replies with substance. | Classifies and alerts only | Haiku, low effort | Third |
| 7 | **Referral mapper** | Finds warm paths from the principals' own contacts; drafts the ask to the connector. | Drafts only | Sonnet | Third |
| 8 | **Meeting prep** | Event lists, who to meet, per-meeting brief, follow-up draft. | Drafts only | Sonnet | Third |
| 9 | **Reporter** | Weekly funnel by channel, sector and segment, and how much each human edited each draft. | Read only | Code, with a Sonnet summary | Third |

**Model tiers.** No agent here needs the top tier. If a draft is weak, raise the effort setting before moving to a larger model. `desk/models.json` already runs triage on Haiku at low effort and drafting on Sonnet at high effort; copy that. Cost estimates should be measured on the first run, not assumed (the desk README makes the same point about its own figures).

**Autonomy levels.** Level 0 is research with no outside effect. Level 1 is a draft that a person approves one at a time, and **every outward touch starts at Level 1.** Level 2 is auto-sending a pre-approved template to a narrow segment, and is considered only for Group B email after a period in which a person has reviewed a sample and found no errors. **Never autonomous:** phone calls, any reply with substance, anything naming a borrower or an asset, and anything touching an account under NDA.

**System of record.** Use a CRM the principals will actually open, and have agents write to it. Do not build a CRM. If none exists, pick one that keeps a thread history and has an API.

### 5.1 What the desk gives us, and what it does not

**The listener.** `scripts/desk/listen.mjs` accepts two source types: RSS or Atom feeds, and one Federal Register JSON shape. Any other type fails with `unknown source type`. Of the signals in 3.1, only trade press runs on it today. The rest need dedicated adapters, each producing one normalized record format:

- Call Report bulk files (tabular, quarterly).
- EDGAR trust filings, 10-D and ABS-EE (XML, loan-level, large).
- Court dockets and county records (different in every jurisdiction; scraped or bought as a vendor export).
- Vendor exports and APIs (CSV or JSON).
- People moves and job postings.

Every adapter has three shared needs: **entity resolution** (one bank, trust or person appears under several names and has to become one record), **provenance** on every record (source, date fetched, confidence), and an **access-controlled store** (section 7). Treat this as the largest build in the plan. It is most of the work in agents 4 and 5.

**The guard.** `scripts/desk/guard.mjs` checks banned phrases, numeric figures, links and capitalized names against a brief. It does not load `scripts/terminology.json`, which today holds rules for `/banks/` only, and it cannot tell whether a non-numeric sentence such as "I read your..." has a source. **The outbound linter is new work.** It needs:

1. Machine-readable terminology for every audience (banks, servicers, counsel, receivers, brokers). `docs/terminology.md` holds the human version.
2. An allowlist of approved firm claims.
3. Structured fact records. Each personalized statement in a draft carries an ID that points to one stored source record, and a draft fails if any statement lacks one.

## 6. Guardrails that live in code, not in a prompt

1. **Suppression list.** Opt-outs. Every asset and party we have signed an NDA on, bid on, or hold (the voice guide's "never write about an asset or party we have bid on, hold, or signed an NDA about," made executable). Anyone who said no. Employees, regulators and press. Competitors. Personal addresses.
2. **The site's promises are the outreach's promises.** The outbound linter (new work, see 5.1) holds a machine-readable list of approved firm claims and per-audience terminology (banks hear "loan sale"; special servicers hear "note sale"), and starts from the banned words in `desk/lint.json`. It refuses any claim not on the list, including "proof of funds" and "certainty of execution" beyond what the pages say.
3. **No invented personalization.** Every personalized fact in a draft must have a stored source link, or the draft fails. This extends the desk's invented-figure check from numbers to any personalized statement, using the fact records described in 5.1.
4. **Volume caps** per mailbox per day and per account per quarter, set in a config file.
5. **A kill switch,** one setting that stops all sending.
6. **An audit log** of every draft, edit, approval and send, with who approved it.
7. **Untrusted text.** Anything read from the web (an enrichment page, a filing, a reply) is data, never instructions, and is fenced and escaped as the desk does. A reply that says "ignore previous instructions" must be inert.
8. **One person at a bank at a time.** A reply or opt-out from anyone at a bank stops outreach to everyone there; the weekly cap, gap and 90-day cap count the whole bank; and a second contact waits out a quiet period (45 days, a placeholder). Banks talk to each other and inside themselves.
9. **Insider does not mean broker or pusher.** The linter blocks broker language ("a group of investors", "I represent buyers"), asking what is for sale or for a list of loans, deadline pressure such as quarter-end, quoted prices and discounts, and "own balance sheet" or "as-is, where-is" talk, all of which are firm statements with no approved claim. Outside notes recommend several of these; the voice guide and the claims system rule them out until the firm can truthfully stand behind each one.

## 7. What runs where

- **Scheduled jobs** for watchers and rankers, run the way the desk's are (`.github/workflows/desk.yml`). The Anthropic key stays a secret. Job logs must not contain contact data.
- **Database** for accounts, people, signals, touches and suppression. The firm has a Supabase connection; it fits, or the CRM's own objects can hold most of it. Decide with the CRM choice.
- **Sending** from real mailboxes or a sequencing tool, behind the guard in agent 1. Letters through a print-and-mail API. Calls from a principal's phone.
- **Review surface:** a table in the CRM or the database, behind access control. Do not build a UI first. **Do not use pull requests, issues, branches, workflow logs or artifacts for review.** The desk can, because its drafts are public-facing posts; outbound briefs are not.
- **Data rule:** named contacts, relationship maps, facts derived from a principal's email history, suppression lists, and anything that identifies an asset under NDA never go into this repository, its pull requests, issues, workflow logs or artifacts. Copies in Git history and metadata cannot be fully removed by a deletion request or an access change. This code now lives in its own private repository, separate from the public website repository, for that reason. Keep prospect data out of it as well: a repository can change hands or visibility.

## 8. Compliance: a working understanding, to be confirmed by counsel

I am not a lawyer, and several of these rules have moved in the last two years. Treat this list as the questions to put to counsel before anything sends.

- **Email (CAN-SPAM):** applies to business email. Accurate sender and subject, a physical postal address, an unsubscribe that works and is honored within ten business days (we will honor it at once). No purchased-list claims we cannot support.
- **Phone (TCPA and state law):** consent rules for calls to mobile numbers; the Do Not Call registry protects residential and personal numbers; states add their own telemarketing, calling-hours and registration rules. AI voices and ringless voicemail are treated as regulated calls **[verify]**. Our plan sidesteps most of this by using human-placed calls to business lines.
- **Call recording:** several states require every party's consent. If an AI note-taker joins a call, say so and ask first.
- **Privacy:** California's privacy law covers business contacts as well as consumers. Keep the provenance record, offer deletion, and publish a privacy notice on the site.
- **AI disclosure:** a principal who sends an agent-drafted message owns it. Do not claim a relationship or a familiarity that is not there.
- **Raising capital:** keep outbound strictly to sellers and partners. Soliciting investors for a fund can trigger general-solicitation rules. If the firm ever raises outside capital, that is a separate, counsel-led process.
- **Contacting borrowers:** see section 2, group C. Not in scope.

## 9. What has to be true first

These come from the website repository's own "Before launch" list and voice guide. The agents depend on all of them.

- [ ] The site is live and indexable, not `noindex` (`vercel.json`, `public/robots.txt`).
- [ ] **A named principal,** a phone number and a street address on the site (`docs/voice.md` says no principal is named anywhere yet). Recipients will look.
- [ ] A working mailbox, a decided sending domain, authentication set up, and a warm-up period.
- [ ] A **buy box per sector:** loan size range, regions, collateral subtypes, loan status, lien position. Agents cannot rank accounts or write an accurate first line without it. Hospitality has most of this on the site; multifamily and retail have none.
- [ ] **A way to answer "what have you closed?"** Bank officers ask. The site has no track record, so the principals need an honest, short answer to give by phone and in a reply, and counsel should approve it.
- [ ] **The credibility package:** a proof-of-funds letter, a one-page approved record of past acquisitions, and a confidentiality agreement counsel has pre-approved, ready to turn around in about a day (research agenda D9). Advisors' buyer lists and bank compliance screening ask for these before sharing a loan tape.
- [ ] A CRM chosen and the principals' existing contacts loaded.
- [ ] Counsel's answers to section 8.

## 10. How we will know it is working

There is no benchmark for this market in my head and I will not invent one. Set targets after the first 60 days of data. Measure:

- **Coverage:** share of Tier A accounts with a verified named decision-maker.
- **Conversations:** accounts with a real two-way conversation, by channel. This is the number that matters first.
- **Looks:** one-page summaries or loan tapes received, NDAs signed, indicative prices given, bids made, closings.
- **Time to first reply** and the share of replies that are interested.
- **Draft quality:** how much a principal edits each draft, and how often a draft is rejected. A draft that is always rewritten means the briefer or the prompt is wrong.
- **Harm:** opt-outs, complaints, bounce rate, and any message that should not have gone. The target for the last is zero.

## 11. Decisions needed

Each has a recommended default so work can start without a meeting.

1. **The buy box, all three sectors.** Loan size range, regions, subtypes, loan status, and **what the firm will not touch** (stating exclusions makes a message more believable than claiming to buy everything). (Already confirmed, November 13: the firm buys both properties and notes in all three sectors.) *Default: write hospitality's buy box from the site, and fill the other two with a principal in an hour.*
2. **Who sends and how much time they have.** The names, and the hours a week for calls and replies. This sets the volume cap. *Default: one principal, a cap of about 15 new Tier A touches a week until replies are being answered within a day.*
3. **Who first: sellers, intermediaries, or both.** *Default: both, with the intermediaries first, because they are fewer, they refer, and a mistake with them costs less.*
4. **Appetite for any AI-voiced calling.** *Default: none outbound. Revisit an AI-assisted inbound line for after-hours intake only after counsel has weighed in.*
5. **Tools and budget:** CRM, a data vendor (after the 50-name test), a mailbox or sequencing tool, a print-and-mail service. *Default: choose the CRM first; run the vendor test before paying for anything.*
6. **Pilot scope.** *Default: hospitality only, 50 Tier A accounts hand-chosen by the principals, agents 1 to 3 only, a principal sends everything. Judge the pilot on conversations and draft edits, then add the signal watcher and ranker, then the other sectors.*
7. **Contacts per bank.** *Default: one at a time, enforced by the guard (decision rule in section 6, item 8). Outside notes suggest 2 to 3 per bank; if the principals want that, a second contact starts after the first has finished or pointed elsewhere.*
8. **Firm commitments to lead with.** Can the firm truthfully say it is an all-cash principal buyer, how fast it closes after receiving a loan file, and that it does not retrade without a diligence finding? *Default: say only what the site already says (principal buyer, confidentiality agreement first, hold to the figure unless diligence turns up a reason, no financing contingency). Anything more needs the principals' evidence and counsel's approval, then it becomes a claim.*
9. **Cadence.** *Default: keep the placeholder until the pilot, but I recommend the lighter sequence and a quarterly nurture described in 4.4. Say so and I will change the config and build the nurture timing.*
10. **Capital and response time.** Is every deal funded from the firm's own capital and the family office (the site's statement), or is any deal syndicated per deal? If any is, first messages must say so plainly, because "a group of investors" reads as a broker and raising money can trigger securities rules. And can the principals acknowledge every loan tape within 24 to 48 hours, with a reason when they pass? *Default: own capital only; acknowledge within two business days.*

## 12. Build order

1. **Before any code:** decisions 1 to 3, the items in section 9, and a hand-built list of 50 accounts. The principals know who these are.
2. **Pilot:** agents 1 to 3 (guard, briefer, drafter), a principal sends. Tune the prompts on real briefs and real edits.
3. **Add** the signal watcher and the account ranker and contact finder (agents 4 and 5), with the source adapters from 5.1. Open multifamily and retail as their buy boxes arrive.
4. **Add** reply triage, the referral mapper, meeting prep, the reporter (agents 6 to 9) and the quarterly nurture. Consider Level 2 for Group B email only after a clean audit.

Two pieces of work in the website repository to schedule when the pilot starts: extending `desk/sources.json`, `desk/keywords.json` and the desk prompts to multifamily and retail for the blog (they are hotel-only today, and the README flags this; the outbound signal sources are a separate build, 5.1), and adding a `/banks/` and `/servicers/` page per new sector once its buy box exists.
