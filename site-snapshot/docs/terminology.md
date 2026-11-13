# Terminology guide

Every audience reads this site in its own words. This guide fixes the words, so that every page says the same thing the same way, and so that a reader at a community bank recognizes their own vocabulary in the first paragraph.

The order of work is one audience at a time, so each gets its own vocabulary done properly:

1. **Community banks** (done first; this guide's main table).
2. **Regional banks** (next).
3. **Special servicers** (after that).
4. Receivers and counsel, and hotel owners, follow the same method.

## Rules

1. **Use the reader's words.** If credit officers say "principal balance", the page says "principal balance".
2. **One term per idea, per audience.** The canonical term is in the first column below. Pages use it everywhere. The "also written" column lists what the reader may write when they send us information; we read all of them and write back the canonical one.
3. **Explain on first use or link to the glossary.** A banker does not need "past due" explained; a hotel owner might need "flag" explained.
4. **The firm's own statements stay as written** on the core pages (what we buy, how we bid, what we do and do not do). New pages restate them; they do not extend them. Anything that is general explanation is labelled as such.
5. **Do not invent.** No quotes from named people, no testimonials, no statistics, no claims about the firm's track record.

`scripts/terminology.json` holds the machine-checkable rules; `npm run check` fails if a page uses a variant listed there.

## Community banks

This is how a community bank presents a problem loan, which is also how the site writes about it.

| We write | Also written by banks | Notes |
|---|---|---|
| **loan sale**, sell the loan | note sale, loan disposition | The transaction. "The note" is the document; the transaction is a loan sale. (Special servicer pages say "note sale", because that is their word.) |
| **principal balance** | outstanding balance, outstanding principal, UPB | In lists and the glossary: "unpaid principal balance (UPB)". In prose: "principal balance". |
| **past due** | delinquent, DPD | "Past due since [date]" and "days past due". |
| **non-accrual** | nonaccrual, NA status | Hyphenated, as on the rest of the site. |
| **risk rating** | grade, risk grade, classification | The categories are pass, special mention, substandard, doubtful, loss. *Classified* means substandard or worse; *criticized* includes special mention. |
| **problem loan** | troubled loan, distressed loan | The bank's side. The firm's own phrase "non-performing hotel loans" is used for what we buy. |
| **special assets** | workout group, special credits, problem asset management | The group and the officer. |
| **workout** | resolution | The process with the borrower. |
| **reserve** (specific reserve) | allowance, ACL allocation, ALLL | |
| **charge-off** | write-down | Partial or full. |
| **OREO** | ORE, other real estate owned, REO | "REO" on special servicer pages. |
| **flag** | brand, franchise, affiliation | "Franchise agreement" is the contract. |
| **rooms** | keys | "Keys" appears in the property line of the loan summary, the way hotel people write it. |
| **guarantor** | guarantee holder | The person. The document is a **guaranty**, as elsewhere on the site. |
| **comp set** | competitive set | Benchmarked in STR reports. |
| **T-12** | trailing twelve months | Spell it out on first use: "trailing twelve-month (T-12)". |
| **loan committee** | credit committee, directors loan committee | |
| **borrower** / **customer** | | "Borrower" in the loan; "customer" for the relationship. |
| **the bank**, **you** | | Depth pages address the reader as "you" and the institution as "the bank". |

## What each audience calls the transaction

| Audience | Calls it | We say |
|---|---|---|
| Community and regional banks | a loan sale | loan sale |
| Special servicers | a note sale, an asset sale, a disposition | note sale |
| Receivers and counsel | a receiver's sale; a purchase of the note | as they say it |
| Hotel owners | a payoff, a note purchase | as in the table on the Hotel Owners page |

## Tone

Plain, direct, peer to peer. Short sentences. No brochure language and no jargon for its own sake: a term earns its place by being the word the reader already uses. General explanation is labelled "general" and ends with a pointer to the bank's own counsel and auditors where the matter is legal or accounting.
