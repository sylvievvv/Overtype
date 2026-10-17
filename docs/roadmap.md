# Roadmap: from prototype to production

Overtyp now runs as a Claude artifact. That is a fast way to build and demo, but a company would not roll it out like this: every employee would need their own Claude account, there is no company login, and data agreements are missing.

## 1. Stand-alone web app

- The current interface becomes the front end on its own domain.
- A small server (for example Python + FastAPI) reads the files and calls the **Claude API** with the company's API key. Employees no longer need a Claude account; usage is paid per document and can be passed on to the customer.
- The validation, merging and Excel logic moves to the server unchanged in behaviour and stays covered by the existing tests.

## 2. Login and teams

- Sign in with the work Microsoft or Google account (single sign-on).
- Lists can be private or shared with a team; roles for employee and admin.

## 3. Privacy and GDPR

- Database and file storage in the EU.
- A data processing agreement with each customer, and checking the AI provider's commercial terms on how API data is handled.
- A retention period per customer: lists are deleted automatically after it. An audit log of who exported what.
- Optional: a version with a self-hosted open-source model for customers that do not want data to leave their environment, at the cost of more maintenance and usually lower accuracy on scans.

## 4. Reliability

- The evaluation set (see [evaluation.md](evaluation.md)) runs on every change.
- Large files are processed in a background queue, so the employee doesn't have to keep the page open.
- Monitoring of error rate, processing time and cost per document.

## 5. Integrations

- **Forward-to-inbox**: employees forward an email to an address such as `contacts@company.overtyp.app`, and the contacts appear in their list. No more saving emails as files.
- Writing directly to a shared Excel file in OneDrive or SharePoint.
- Export to CRMs such as HubSpot or Salesforce.
- Phone and address validation for more countries than the Netherlands.

## Order

1. Finish the evaluation set and the time measurement for the portfolio.
2. Build steps 1–3 and run a pilot with one company. Let that pilot decide which integration comes first.
