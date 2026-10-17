# Evaluation

How Overtyp was tested, what went wrong along the way, and what still has to be measured.

## Test file

[`tests/fixtures/sample-contacts.pdf`](../tests/fixtures/sample-contacts.pdf): a two-page relation file with 52 contact rows (ID, name, company, job title, email, phone, city). The data is fictional. It contains four deliberate inconsistencies:

| Row | Planted problem |
| --- | --- |
| 1008 | Eva de Vries has the address `sophie.bakker@oranjeadviesgroep`: someone else's name, and no `.nl` |
| 1020 | Fleur Blom has no email address |
| 1032 | "M. de Vries" uses Lotte van Dijk's email address |
| 1044 | Sophie Vos is listed at "ABC Solutions BV", but her email is `@westpoortinstallaties.nl` |

The file also contains something that is **not** an error: 20 of the 21 names appear two or three times, each time with a different phone number and city.

Ground truth: [`tests/fixtures/sample-contacts.expected.json`](../tests/fixtures/sample-contacts.expected.json).

## What is tested

The pipeline has an AI step (extraction) and a deterministic part (everything after it). The automated tests cover the deterministic part with the real app code:

1. The PDF is read with the same pdf.js version the app uses. All 52 rows come out.
2. The rows are fed in as the model is instructed to return them: one object per row, copied verbatim. For a clean table like this one, that is the expected model output.
3. Validation and duplicate handling run, and the result is compared with the ground truth.

## Results

| Measure | Result |
| --- | --- |
| Rows read from the PDF | 52 / 52 |
| Planted problems flagged | 4 / 4 |
| Reasons shown per flagged row | exactly as expected (see the ground-truth file) |
| Correct rows wrongly flagged | 0 |
| Rows wrongly merged | 0 |
| Repeated people marked with a note ("appears 3× with different details") | 48 rows, none flagged as an error |

## Iterations: what didn't work at first

**1. Repeated people swamped the review step.** The first version merged every row with the same name and email, and flagged every merge with conflicting phone numbers. Result: 52 rows became 22 contacts, and **all 22** landed in "needs review". An employee would have had to check everything, which defeats the purpose.
*Fix:* rows are merged only when nothing conflicts. Same person, different details means separate rows with a quiet note, not an error.

**2. Three kinds of problems were missed.** Row 1032 ("M. de Vries" with Lotte van Dijk's address) would have been **silently merged** into Lotte's record. Rows 1008 and 1044 passed because their fields were individually valid.
*Fix:* three cross-field checks were added: the email doesn't match the name, the company doesn't match the email domain, and the same email belongs to two different names. Merging by email now requires the names to match.

**3. "Verhoef Catering" ≠ "Verhoef Catering BV".** Writing the duplicate test showed that the same company with and without its legal form counted as a conflict, so true duplicates from two sources were not merged.
*Fix:* companies are compared without legal forms (B.V., N.V., VOF).

**4. A false extra reason.** For row 1008 the app also claimed "company doesn't match the email domain", only because the domain had no TLD to compare against.
*Fix:* the domain check is skipped when the domain is incomplete; the "invalid email" reason already covers it.

## Not measured yet

Being explicit about what these numbers do **not** show:

- **Live extraction accuracy.** The AI step runs only inside Claude, so it is not part of the automated tests. The next step is a test set of about 20 documents across all input types (clean and messy tables, a poor scan, emails with several forwarded signatures, a Word document), each with a hand-made "correct" Excel, scored per field on precision and recall.
- **Errors that slip through unflagged.** This is the most important metric. An error in the review list is fine; an error that silently reaches the export is the real risk.
- **Time saved.** To be measured by retyping one 50-contact document by hand and timing it, then processing the same document with Overtyp, including review.

| Document | Contacts | By hand | With Overtyp (incl. review) |
| --- | --- | --- | --- |
| *to be measured* | | | |
