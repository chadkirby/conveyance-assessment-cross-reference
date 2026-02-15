# Cowork Project: Deschutes Heights Conveyance Assessment Cross-Reference

## What This Project Is

Chad is the treasurer of the Deschutes Heights HOA. He's been auditing how the management company (VIS Group) has been handling Conveyance Assessments — a $500 fee owed on most property transfers. VIS has been getting it wrong in both directions: charging the fee on exempt transfers and failing to charge it on non-exempt transfers. They've also been transferring the collected funds to the developer (Lotus House Development Corp.) instead of keeping them in the HOA's common area maintenance fund.

We've already built a cross-reference spreadsheet matching recorded deeds from the County Auditor against GL entries. But there are gaps — some deeds have no parseable date from the OCR, and some GL entries have no matching deed. The **Homeowner Resale Reports** from VIS can help fill those gaps.

## The Governing Rule

From Article I(X) of the First Amendment to the Amended CC&Rs (recorded 2/16/2021, Auditor's File No. 4826135):

> Upon conveyance of any Lot within the Deschutes Heights development, **with the exception of conveyances from the developer, Lotus House Development, Corp.**, the grantee of the conveyance shall pay a Conveyance Assessment to the Association in the amount of Five Hundred Dollars ($500.00). This Conveyance Assessment shall be used exclusively to fund maintenance, repair and/or replacement of the Common Areas...

**The rule is binary:**
- If grantor = Lotus House Development, Corp. → **EXEMPT** (no $500 fee)
- If grantor = anyone else → **$500 DUE** from the grantee (buyer)

**The CC&R amendment took effect January 11, 2021.** Only conveyances after this date are subject to the fee.

**Critical distinctions:**
- SO UK Investment LLC is NOT exempt. Separate entity from Lotus House despite shared principal (Min-Leung Lai).
- Quit claim deeds ARE conveyances under RCW 64.04.050 ("shall be deemed and held a good and sufficient conveyance").
- No exemptions exist for trust transfers, spousal transfers, interfamily transfers, or any deed type.
- The BUYER (grantee) pays the fee, not the seller.

## What the Resale Reports Contain

Each Resale Report is a .md file (OCR'd from PDF) containing an HTML table with:
- **New Account #** — VIS internal account number
- **New Owner** — the buyer/grantee
- **Unit Address 1** — street address
- **Lot #** — the lot number (this is the key field for matching)
- **Previous Owner** — the seller/grantor (sometimes blank for new construction)
- **Process Date** — when VIS processed the transfer
- **Escrow Date** — closing date

The files are named like `2024-05-31-10-Homeowner Resale Report.md` and cover various date ranges.

## Your Task

### Step 1: Parse all Resale Report .md files

Extract every row from every Resale Report into a single dataset with columns:
- Lot number
- New owner (grantee)
- Previous owner (grantor) — may be blank
- Street address
- Process date
- Escrow date
- Source file

### Step 2: Build a master Lot Reference Table

From the resale data, build a lot-to-address mapping. This is valuable because the deed OCR doesn't always capture addresses.

### Step 3: Cross-reference with existing data

Chad will provide you with two existing data files:

1. **all_deeds_final.json** — 166 parsed deeds from County Auditor records, with fields: lot, phase, deedType, grantor, grantee, date, normalizedDate, taxParcel, recordingNumber, exciseTax, consideration, isPostAmendment.

2. **gl_complete.json** — Complete GL for account 300150, with fields: date, source, description, debit, credit, amount, unit, type (collection / payout_to_lotus / reversal / void / balance_forward).

Use the Resale Reports to:
- **Fill in missing dates** on deeds where normalizedDate is blank
- **Fill in missing grantor/grantee** on deeds where the OCR mangled the names
- **Match GL entries to specific transfers** — the Resale Report escrow dates should closely match GL collection dates
- **Identify transfers NOT in our deed records** — if a Resale Report shows a transfer for a lot that has no corresponding deed, we need to pull that deed from the County

### Step 4: Produce an updated cross-reference spreadsheet (.xlsx)

The spreadsheet should have these sheets:

**Sheet 1: "Deed-GL Cross Reference"** (post-1/11/2021 only)
- Columns: Phase, Lot, Deed Date, Deed Type, Grantor, Grantee, Category, Grantor=Lotus House?, $500 Due?, GL Date, GL Unit, GL Description, Match Status, $ Impact, Notes
- Dates must be real Excel dates (not text) so they sort and filter correctly
- Color coding: green = correct, red = under-collected, orange = over-collected, yellow = unmatched GL

**Sheet 2: "Lotus House Payments"**
Five payments totaling $49,000:
| Date | Amount | Description |
|------|--------|-------------|
| 03/10/2021 | $12,000 | Transfer Contributions Fees |
| 01/25/2022 | $14,500 | Payment per Agreement (void + re-entry, net $14,500) |
| 03/03/2023 | $10,500 | Payment per agreement |
| 03/08/2024 | $4,500 | Payment Per Agreement |
| 09/19/2025 | $7,500 | Payment per agreement |

**Sheet 3: "Lotus House Claim Detail"**
Itemizes both claims:
- Claim 1: Every post-amendment conveyance where Lotus House was the grantee (buyer) and the grantor was NOT Lotus House. Fee = $500 each, owed by Lotus House.
- Claim 2: The five improper fund transfers totaling $49,000.

**Sheet 4: "Lot Reference"**
Master lot-to-address-to-unit mapping built from Resale Reports + deeds.

## Developer Entities to Recognize

These are all developers/builders. Conveyances FROM these entities are NOT exempt (only Lotus House is):

- SO UK Investment LLC (Min-Leung Lai)
- Lotus House Development Corp (Min-Leung Lai) — **only exempt entity**
- High Definition Homes, LLC (Kellen R. Mangan)
- Gruhn Homes, Inc.
- Tronie Corporation
- Aasve Home's LLC
- JK Monarch, LLC
- Capital Development Properties LLC
- SFR Acquisitions 1 LLC / SFR Borrower 2022-1 LLC
- Evergreen State Builders LLC
- Gallardo Homes LLC
- Premier Builders Investments LLC
- Lennar Northwest, Inc.

## Technical Notes

- For xlsx generation, use openpyxl.
- Dates in the deed data come in many OCR formats. The normalizedDate field is MM/DD/YYYY when it was parseable, empty string when not.

### Date Parsing — Known Formats

The current parser missed ~25 dates. The OCR'd deeds contain at least these date formats:

1. **"Dated this 18th day of APRIL, 2013"** — ordinal + month name + year
2. **"Dated: 05/18/2022"** or **"Dated: 3/22/17"** — MM/DD/YYYY or MM/DD/YY
3. **"Dated: 3-25-2021"** — dashes instead of slashes
4. **"AUGUST 20, 2019"** or **"April 07, 2017"** — month name DD, YYYY
5. **Recording header stamps** like `10/14/2022 02:10 PM D` at the top of the page — these are the county recorder timestamps and appear BEFORE the deed body. Many of the "missing date" deeds (especially JK Monarch sales recorded through Chicago Title) have the date ONLY in this header stamp, not in a "Dated this..." line. Look for a pattern like `MM/DD/YYYY HH:MM` near the top of the page.
6. **Old-style recording stamps** like `23 APR '13 719629` or `OCT 7'19 541554` — abbreviated month with 2-digit year.

When the "Dated:" line is missing, fall back to the recording header stamp. It's typically within a few days of the actual signing date and is perfectly adequate for our purposes.

- Tax parcels encode lot numbers: 4414-00-0XX00 where XX = lot number (Phase I). Other phases use different parcel prefixes (4414-06, 4414-08, etc.).
- The subdivision has three phases: Phase I (original, lots 1-26, plat 4223746), Phase II (lots 27-66, plat 4435673), Phase III (lots 67+, plat 4688565).
