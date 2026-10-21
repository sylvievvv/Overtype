# Evaluation

How Overtyp was tested, what went wrong along the way, and what still has to be measured.

## Test file 1: clean relation file

[`tests/fixtures/sample-contacts.pdf`](../tests/fixtures/sample-contacts.pdf): a two-page relation file with 52 contact rows (ID, name, company, job title, email, phone, city). The data is fictional. It contains four deliberate inconsistencies:

| Row | Planted problem |
| --- | --- |
| 1008 | Eva de Vries has the address `sophie.bakker@oranjeadviesgroep`: someone else's name, and no `.nl` |
| 1020 | Fleur Blom has no email address |
| 1032 | "M. de Vries" uses Lotte van Dijk's email address |
| 1044 | Sophie Vos is listed at "ABC Solutions BV", but her email is `@westpoortinstallaties.nl` |

The file also contains something that is **not** an error: 20 of the 21 names appear two or three times, each time with a different phone number and city.

Ground truth: [`tests/fixtures/sample-contacts.expected.json`](../tests/fixtures/sample-contacts.expected.json).

## Test file 2: messy file + existing customer list

[`tests/fixtures/messy-contacts.pdf`](../tests/fixtures/messy-contacts.pdf) (20 rows) and [`tests/fixtures/existing-list.xlsx`](../tests/fixtures/existing-list.xlsx) (8 existing customers, Dutch column names). Ground truth: [`messy-contacts.expected.json`](../tests/fixtures/messy-contacts.expected.json).

| Row | What's in it | Expected |
| --- | --- | --- |
| 2001 / 2002 | *Jan Jansen* and *Jan Janssen*, same company and phone | possible duplicate, both shown side by side |
| 2003 | `…@noordlandservices.con` | flagged, suggestion `…@noordlandservices.nl` (domain known from other rows) |
| 2004 | `…@gmial.com` | flagged, suggestion `…@gmail.com` |
| 2005 | no phone, but an email | **not** flagged |
| 2006 | no email and no phone | flagged |
| 2007 | company written *A.B.C. Solutions*, email `@abcsolutions.nl` | **not** flagged |
| 2008 / 2009 | same person, *Noordland Services* vs *Noordland Services B.V.* | merged automatically |
| 2010 | phone `0612345` | flagged |
| 2016 | `…@brightconsulting,nl` | flagged, suggestion with a dot |
| 2011, 2012, 2015 | also in the existing list with the same email | already in your Excel, not exported again |
| 2013 | in the existing list with an old email address | possible duplicate: add or skip |
| 2018 | *Ruben Bos*, existing list has *Ruben Bosch* with the same email | possible duplicate: add or skip |

## What is tested

The pipeline has an AI step (extraction) and a deterministic part (everything after it). The automated tests cover the deterministic part with the real app code:

1. The PDFs are read with the same pdf.js version the app uses. All rows come out.
2. The rows are fed in as the model is instructed to return them: one object per row, copied verbatim. For tables like these, that is the expected model output.
3. Validation, suggestions, duplicate handling, the comparison with the existing list and the Excel export run, and the results are compared with the ground truth. Decisions (keep both, merge, skip, use suggestion) are tested too.

## Results: clean file

| Measure | Result |
| --- | --- |
| Rows read from the PDF | 52 / 52 |
| Planted problems flagged | 4 / 4 |
| Reasons shown per flagged row | exactly as expected (see the ground-truth file) |
| Correct rows wrongly flagged | 0 |
| Rows wrongly merged | 0 |
| Repeated people marked with a note ("appears 3× with different details") | 48 rows, none flagged as an error |
| Suggestions | 1008 → the address Eva uses in her other rows · 1020 → Fleur's address from her other row · 1044 → the company that matches the email domain |

## Results: messy file

| Measure | Result |
| --- | --- |
| Rows read | 20 / 20 |
| Exact duplicates merged | 1 / 1 (2008 + 2009) |
| Rows flagged | 7 / 7, no others |
| Typo suggestions correct | 3 / 3 |
| With the existing list | 3 already there, 2 possible duplicates, 14 new: exactly as expected |
| Export | existing 8 rows kept, only new contacts appended, in the list's own columns |

## Iterations: what didn't work at first

**1. Repeated people swamped the review step.** The first version merged every row with the same name and email, and flagged every merge with conflicting phone numbers. Result: 52 rows became 22 contacts, and **all 22** landed in "needs review". An employee would have had to check everything, which defeats the purpose.
*Fix:* rows are merged only when nothing conflicts. Same person, different details means separate rows with a quiet note, not an error.

**2. Three kinds of problems were missed.** Row 1032 ("M. de Vries" with Lotte van Dijk's address) would have been **silently merged** into Lotte's record. Rows 1008 and 1044 passed because their fields were individually valid.
*Fix:* three cross-field checks were added: the email doesn't match the name, the company doesn't match the email domain, and the same email belongs to two different names. Merging by email now requires the names to match.

**3. "Verhoef Catering" ≠ "Verhoef Catering BV".** Writing the duplicate test showed that the same company with and without its legal form counted as a conflict, so true duplicates from two sources were not merged.
*Fix:* companies are compared without legal forms (B.V., N.V., VOF).

**4. A false extra reason.** For row 1008 the app also claimed "company doesn't match the email domain", only because the domain had no TLD to compare against.
*Fix:* the domain check is skipped when the domain is incomplete; the "invalid email" reason already covers it.

**5. A possible duplicate would have flagged correct rows.** When "same name, different email" became a duplicate check, Eva de Vries' two correct rows would also have been flagged because row 1008 has the wrong address.
*Fix:* if only one of the two emails matches the person's name, only that one is flagged.

**6. The comparison was hidden.** In the first version of the duplicate panel, the side-by-side comparison collapsed to a thin line, and the panel scrolled straight to the first input. Found while checking screenshots.
*Fix:* the panel opens at the top when there is a comparison, and suggestions are also shown directly under the field.

## Test 3: unseen messy documents, extracted by Claude

Two new documents, not used while building: a forwarded email thread (a reply on top of two forwarded messages, a noreply sender, a CC to a generic *inkoop@* address, signatures, one person whose first name the sender wasn't sure about) and business cards retyped by an intern (capitals, an abbreviated name, a space inside an email address, the same person on two cards). The app's exact extraction prompt was answered by Claude and the answer run through the app. Documents and answers: [`tests/fixtures/unseen/`](../tests/fixtures/unseen/).

| Finding | Result |
| --- | --- |
| Contacts found | 9: Daan, Petra, Jorrit, Henk, Ilse from the email; Marieke, Bert, Anouk from the cards (+1, see below) |
| Correctly flagged | Petra's phone number with a digit missing, Jorrit's uncertain spelling, Henk and Ilse without an email |
| Merged | Bert's two cards; the space was removed from his email |
| City from address | Harlingen, Schiermonnikoog |

**7. The user's own address became a contact.** The email's recipient, *Sylvie* at the user's own company, was extracted as a contact.
*Fix:* the prompt now tells the model not to include the people an email is addressed to, unless they appear with details of their own in the text or a signature.

**8. A confirmed contact stayed "uncertain".** Bert's first card was marked uncertain (space in the email), but the second card confirmed the same details, and the merged contact still asked for review.
*Fix:* a merged contact is uncertain only if every source was uncertain.

## Not measured yet

Being explicit about what these numbers do **not** show:

- **Live extraction accuracy.** The AI step runs only inside Claude, so it is not part of the automated tests. The next step is a test set of about 20 documents across all input types (clean and messy tables, a poor scan, emails with several forwarded signatures, a Word document), each with a hand-made "correct" Excel, scored per field on precision and recall.
- **Errors that slip through unflagged.** This is the most important metric. An error in the review list is fine; an error that silently reaches the export is the real risk.
- **Time saved.** To be measured by retyping one 50-contact document by hand and timing it, then processing the same document with Overtyp, including review.

| Document | Contacts | By hand | With Overtyp (incl. review) |
| --- | --- | --- | --- |
| *to be measured* | | | |
