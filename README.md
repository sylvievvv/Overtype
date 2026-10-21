# Overtyp

**Turn contact details buried in PDFs, scans, Word files, spreadsheets and emails into a clean, checked Excel list.**

Overtyp reads the document, finds every contact person, normalises the data, flags what looks wrong, and lets an employee fix only those few cases before exporting to Excel.

![Demo: a PDF goes in, 52 contacts come out, the flagged ones are fixed and approved](docs/demo.gif)

▶ **[Watch the 1-minute demo with explanation](docs/demo.mp4)**

---

## The problem

In office jobs someone regularly gets a participant list, a member list or a pile of forwarded emails, and has to type every name, company, email address and phone number into Excel, page by page. I have done this work myself. It is slow, error-prone, and nobody wants to do it.

The documents are never the same: tables, loose text, email signatures, scanned business cards. A fixed template or a few regular expressions break on the second document. That is where a language model helps.

## What it does

![Overtyp with the 52-row test file loaded: 48 contacts ready, 4 flagged for review](docs/screenshots/overview.png)

- **Any common input**: PDF (including scans), photos, Word, Excel/CSV, emails (`.eml`, `.msg`) and their attachments, or text pasted with Ctrl+V.
- **Extracts a fixed set of fields**: name, company, job title, email, phone, address, website, LinkedIn, plus the source line each contact came from.
- **Normalises**: phone numbers to `+31 6 12345678`, Dutch postcodes to `1234 AB`, names split into first name / prefix / last name, addresses split into street / postcode / city.
- **Flags what needs a human**, each with a reason: invalid or missing email, an email that doesn't match the person's name, a company that doesn't match the email domain, two different people sharing one email address, unrecognised phone numbers, text the model marked as hard to read.
- **Suggests the fix** where it can see what was meant: `.con` → `.com`, `gmial` → `gmail`, a comma instead of a dot, a missing `.nl`, or the email address and company the same person uses elsewhere in the file. One click on *Use suggestion*.
- **Possible duplicates side by side**: the same name with a different email, or two very similar names at the same company (*Jan Jansen* / *Jan Janssen*). The employee chooses *Merge into one*, *Keep both* or *Delete this one*. Exact duplicates are merged automatically; records that contradict each other are never merged silently.
- **Compares with an existing Excel list** in three groups: 🟢 new, 🔵 already in your Excel, 🟠 possible duplicates (*Add as new contact* or *Skip*).
- **Review in one click**: click an underlined value and the side panel opens with that field selected. *Approve* jumps to the next case.
- **Exports to Excel**: a clean *Contacts* sheet plus a *Needs review* sheet for anything not yet checked, or only the new contacts appended to your existing list in its own columns. Afterwards a summary: how many were added, skipped and reviewed.
- **My lists**: every run is saved privately per user and can be reopened later to add more names.

| Possible duplicate: you decide | A suggestion for a misspelled domain |
| --- | --- |
| ![Two similar names at the same company shown side by side with Merge, Keep both and Delete](docs/screenshots/duplicate.png) | ![The panel suggests noordlandservices.nl for a .con typo](docs/screenshots/suggestion.png) |
| **Already in your Excel?** | **After export** |
| ![A new contact compared with a similar row from the existing Excel list](docs/screenshots/existing-duplicate.png) | ![Summary after export: 11 new contacts added, 4 skipped, 3 possible duplicates reviewed](docs/screenshots/export-done.png) |

## How it works

```mermaid
flowchart TD
    A[PDF] & B[Scan / photo] & C[Word] & D[Excel / CSV] & E[Email + attachments] & P[Pasted text] --> N
    N["1 · Normalise<br/>each format → text per page,<br/>or a page image for scans"] --> X
    X["2 · Extract (Claude)<br/>fixed JSON schema per contact,<br/>with source line and confidence"] --> V
    V["3 · Validate + suggest (code)<br/>email, phone, typos, name↔email,<br/>company↔domain, shared emails"] --> M
    M["4 · Duplicates (code)<br/>merge exact ones, flag possible ones,<br/>compare with an existing Excel list"] --> R
    R["5 · Human review<br/>only the flagged contacts"] --> O
    O["6 · Excel export<br/>new file, or appended to an existing list"]
    E -. attachments go back to step 1 .-> N
```

**Key design decision: the model only extracts; plain code decides what is trustworthy.** Validation and de-duplication are deterministic rules. They are predictable, free, unit-tested, and they catch the model's mistakes instead of trusting them. The model is also asked to mark its own uncertainty ("text cut off", "unclear which phone belongs to whom"), and those cases go to review too.

The employee never sees an "agent". They see: file in, Excel out, with a short check in between.

## Evaluation

The deterministic layer is tested on two files with known answers, and Claude's extraction on two unseen messy documents (a forwarded email thread and retyped business cards, see [evaluation](docs/evaluation.md#test-3-unseen-messy-documents-extracted-by-claude)). The two files with known answers are a clean 52-row relation file with four planted errors, and a messy 20-row file full of typos, near-duplicates, company spelling variants and missing data, compared against an existing customer list.

| Measure | Clean file (52 rows) | Messy file (20 rows + existing list) |
| --- | --- | --- |
| Rows read from the PDF | 52 / 52 | 20 / 20 |
| Problems flagged | 4 / 4 planted errors | 7 / 7 (typos, near-duplicate pair, missing data, bad phone) |
| Correct rows wrongly flagged | 0 | 0 (missing phone with an email and *A.B.C. Solutions* are accepted) |
| Right fix suggested | 3 / 3 | 3 / 3 (`.con`, `gmial`, comma) |
| Exact duplicates merged | 0 needed, 0 wrongly | 1 / 1 |
| Existing customers recognised | — | 3 already in Excel, 2 possible duplicates, 14 new |

The first version flagged **22 of 22** merged contacts, because it treated every person who appears more than once as a duplicate. That would have made the review step useless. [`docs/evaluation.md`](docs/evaluation.md) describes what went wrong, how it was fixed, and what has not been measured yet: live extraction accuracy on messy documents, and the time saved.

## Privacy by design

Contact details are personal data, so the app keeps as little as possible:

- Files are read in the browser. Original files are never uploaded or stored.
- Only the extracted text (or, for scans, the page image) is sent to Claude for recognition.
- Saved lists contain only the contact details found, stored per user. Nobody else can see them, including the app's owner. *Delete list* erases a list permanently.
- The Excel export is saved on the user's own computer.

## Running it

**Inside Claude (full functionality).** Overtyp runs as a published Claude artifact. In that environment the page can ask Claude to extract contacts through the viewer's own Claude account, store lists privately per user, and offer the Excel file for download.

**Locally or on GitHub Pages.** Open `index.html`. The example data, the review flow and the Excel export all work. AI extraction and saved lists need the Claude runtime; outside it the page says so. The [roadmap](docs/roadmap.md) describes the stand-alone version that calls the Claude API from its own server.

**Tests**

```bash
npm install
npm test
```

21 tests cover PDF text extraction, both fixtures above, suggestions, duplicate decisions, the comparison with an existing Excel list, the export layout, phone/name/address normalisation, and email (MIME) parsing including attachments.

## Tech

- Single-page app in plain HTML, CSS and JavaScript, with no build step
- [pdf.js](https://mozilla.github.io/pdf.js/) for PDFs, [mammoth](https://github.com/mwilliamson/mammoth.js) for Word, [SheetJS](https://sheetjs.com/) for Excel in and out
- An email (MIME) parser written from scratch for `.eml`, including quoted-printable, base64 and attachments
- Claude for extraction, with a strict JSON schema
- `node:test` + jsdom for tests

## Project structure

```
index.html                 the complete app
tests/app.test.mjs         automated tests
tests/fixtures/            test PDFs, an existing Excel list, and the ground truth
docs/evaluation.md         test results, iterations, what is not measured yet
docs/roadmap.md            from prototype to production
docs/screenshots/
docs/demo.mp4, demo.gif   demo video and the short version above
```

## What I would do next

See [`docs/roadmap.md`](docs/roadmap.md). In short: a stand-alone web app that calls the Claude API from its own server, company login, EU data storage with a retention period, and an inbox address employees can forward emails to.

## License

[MIT](LICENSE)
