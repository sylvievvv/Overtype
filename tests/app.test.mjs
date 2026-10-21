// Tests for Overtyp's deterministic layer: reading, normalising, validating, suggesting, merging,
// comparing with an existing Excel list and building the export.
// The AI extraction step needs the Claude runtime, so these tests feed in what the model is asked
// to return for each fixture (one object per table row) and check everything that happens after it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TextDecoder, TextEncoder } from "node:util";
import { JSDOM } from "jsdom";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const file = (p) => new URL(p, import.meta.url);
const html = readFileSync(file("../index.html"), "utf8");
const xlsxLib = readFileSync(require.resolve("xlsx/dist/xlsx.full.min.js"), "utf8");
const sampleExpected = JSON.parse(readFileSync(file("./fixtures/sample-contacts.expected.json"), "utf8"));
const messyExpected = JSON.parse(readFileSync(file("./fixtures/messy-contacts.expected.json"), "utf8"));

// Load the real page. CDN libraries are not fetched; SheetJS is injected for the Excel tests.
function loadApp() {
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse(w) { w.TextDecoder = TextDecoder; w.TextEncoder = TextEncoder; w.scrollTo = () => {}; },
  });
  const w = dom.window;
  w.eval(xlsxLib);
  const run = (code) => w.eval(code);
  run("contacts=[]; dupes=0; isExample=false; base=null;");
  return { w, run };
}

// The same text extraction the page does in readPdf(), with the same pdf.js version.
async function pdfText(path) {
  globalThis.DOMMatrix ??= class {}; globalThis.Path2D ??= class {}; // text only, no rendering
  const pdfjs = require("pdfjs-dist/legacy/build/pdf.js");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)), isEvalSupported: false, verbosity: 0 }).promise;
  let text = "";
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    for (const it of tc.items) text += (it.str || "") + (it.hasEOL ? "\n" : " ");
  }
  return text;
}

// What the model is instructed to return for these tables: one object per row, copied verbatim.
function rowsAsModelOutput(text) {
  const out = [];
  for (const line of text.split("\n")) {
    const p = line.trim().split(/\s{3,}/);
    if (!/^\d{4}$/.test(p[0])) continue;
    const [id, naam, bedrijf, functie, ...rest] = p;
    out.push({
      id, naam, bedrijf, functie,
      email: rest.find((x) => x.includes("@")) || "",
      telefoon: rest.find((x) => /^(\+|0)[\d ()-]{5,}$/.test(x)) || "",
      adres: rest[rest.length - 1], website: "", linkedin: "",
      conf: "hoog", twijfel: "", snippet: line.trim().slice(0, 120),
    });
  }
  return out;
}

async function loadFixture(name) {
  const app = loadApp();
  app.w.__rows = rowsAsModelOutput(await pdfText(file(`./fixtures/${name}`).pathname));
  app.run(`addContacts(__rows, ${JSON.stringify(name)})`);
  return app;
}
const flaggedOf = (run) => JSON.parse(run(`JSON.stringify(contacts.filter(needsCheck).map(c=>({id:c.bron[0].snippet.slice(0,4), reasons:c.issues.map(i=>i.m), sug:Object.fromEntries(c.issues.filter(i=>i.sug).map(i=>[i.f,i.sug]))})))`));

async function loadExistingList(w) {
  w.__buf = new w.Uint8Array(readFileSync(file("./fixtures/existing-list.xlsx")));
  await w.eval("loadBase({name:'existing-list.xlsx', arrayBuffer: async()=>__buf.buffer, text: async()=>''})");
}

// ---------- the 52-row file with four planted errors

test("sample: PDF text extraction finds all 52 rows", async () => {
  const rows = rowsAsModelOutput(await pdfText(file("./fixtures/sample-contacts.pdf").pathname));
  assert.equal(rows.length, sampleExpected.rows);
  assert.deepEqual(rows.map((r) => +r.id), Array.from({ length: 52 }, (_, i) => 1001 + i));
});

test("sample: exactly the four planted errors are flagged, with the right reasons", async () => {
  const { run } = await loadFixture("sample-contacts.pdf");
  const flagged = flaggedOf(run);
  assert.equal(run("contacts.length"), 52, "rows with different details must stay separate");
  assert.equal(run("dupes"), 0);
  assert.deepEqual(flagged.map((f) => f.id).sort(), Object.keys(sampleExpected.flagged).sort());
  for (const f of flagged) assert.deepEqual(f.reasons, sampleExpected.flagged[f.id], `reasons for row ${f.id}`);
});

test("sample: suggestions point to what was probably meant", async () => {
  const { run } = await loadFixture("sample-contacts.pdf");
  const flagged = Object.fromEntries(flaggedOf(run).map((f) => [f.id, f.sug]));
  for (const [id, sug] of Object.entries(sampleExpected.suggestions)) assert.deepEqual(flagged[id], sug, `suggestion for ${id}`);
});

test("sample: people who repeat with different details get a note, not an error", async () => {
  const { run } = await loadFixture("sample-contacts.pdf");
  const jan = JSON.parse(run(`JSON.stringify(contacts.filter(c=>c.naam==='Jan Jansen').map(c=>[c.status,c.repeat]))`));
  assert.deepEqual(jan, [["ok", 3], ["ok", 3], ["ok", 3]]);
});

// ---------- the messy file

test("messy: exact duplicates (company spelled differently) are merged automatically", async () => {
  const { run } = await loadFixture("messy-contacts.pdf");
  assert.equal(run("contacts.length"), messyExpected.afterMerge);
  assert.equal(run("dupes"), messyExpected.exactDuplicatesMerged);
});

test("messy: the right rows are flagged, and only those", async () => {
  const { run } = await loadFixture("messy-contacts.pdf");
  const flagged = flaggedOf(run);
  assert.deepEqual(flagged.map((f) => f.id).sort(), Object.keys(messyExpected.flagged).sort());
  for (const f of flagged) assert.deepEqual(f.reasons, messyExpected.flagged[f.id], `reasons for row ${f.id}`);
});

test("messy: typo suggestions (.con, gmial, comma)", async () => {
  const { run } = await loadFixture("messy-contacts.pdf");
  const sug = Object.fromEntries(flaggedOf(run).map((f) => [f.id, f.sug.email]));
  for (const [id, email] of Object.entries(messyExpected.suggestions)) assert.equal(sug[id], email, `suggestion for ${id}`);
});

test("messy: using a suggestion clears the problem", async () => {
  const { run } = await loadFixture("messy-contacts.pdf");
  run(`(()=>{ const c=contacts.find(c=>c.naam==='Anna de Boer'); c.email=c.issues.find(i=>i.sug).sug; normalize(c); validateAll(); })()`);
  assert.equal(run(`contacts.find(c=>c.naam==='Anna de Boer').status`), "ok");
});

test("messy: possible duplicate decisions (keep both, merge)", async () => {
  let app = await loadFixture("messy-contacts.pdf");
  app.run(`resolveDup(contacts.find(c=>c.naam==='Jan Jansen'),'keep')`);
  assert.equal(app.run(`contacts.filter(c=>/^Jan Jans/.test(c.naam)&&needsCheck(c)).length`), 0, "keep both clears both");
  app = await loadFixture("messy-contacts.pdf");
  app.run(`resolveDup(contacts.find(c=>c.naam==='Jan Jansen'),'merge')`);
  assert.equal(app.run(`contacts.filter(c=>/^Jan Jans/.test(c.naam)).length`), 1, "merge leaves one");
});

test("messy + existing Excel: new / already there / possible duplicates", async () => {
  const { w, run } = await loadFixture("messy-contacts.pdf");
  await loadExistingList(w);
  const g = messyExpected.withExistingList;
  assert.deepEqual(JSON.parse(run(`JSON.stringify(contacts.filter(c=>c.exists).map(c=>c.naam))`)), g.alreadyInExcel);
  assert.deepEqual(JSON.parse(run(`JSON.stringify(contacts.filter(c=>c.baseMatch).map(c=>c.bron[0].snippet.slice(0,4)))`)), g.possibleDuplicates);
  assert.equal(run(`contacts.filter(c=>!c.exists&&!c.baseMatch).length`), g.new);
  run(`(()=>{ const c=contacts.find(c=>c.naam==='Ruben Bos'); c.baseDecision='skip'; validateAll(); })()`);
  assert.equal(run(`contacts.find(c=>c.naam==='Ruben Bos').exists`), true, "skip moves it to 'already there'");
});

test("messy + existing Excel: export appends only new contacts, in the list's own columns", async () => {
  const { w, run } = await loadFixture("messy-contacts.pdf");
  await loadExistingList(w);
  const r = JSON.parse(run(`(()=>{ const r=buildExport(); const ws=r.wb.Sheets[r.wb.SheetNames[0]]; return JSON.stringify({sheets:r.wb.SheetNames, rows:XLSX.utils.sheet_to_json(ws,{header:1}), file:r.filename, good:r.good.length}); })()`));
  assert.deepEqual(r.sheets, ["Klanten", "Needs review"]);
  assert.deepEqual(r.rows[0].slice(0, 5), ["Naam", "Bedrijf", "E-mail", "Telefoon", "Plaats"]);
  assert.equal(r.rows.length, 1 + 8 + r.good, "header + 8 existing + new contacts");
  assert.ok(!r.rows.slice(9).some((row) => row[0] === "Nora Mulder"), "existing contacts are not added again");
  assert.equal(r.file, "existing-list (updated).xlsx");
});

// ---------- units

test("export without an existing list: fixed columns with street, postcode and city", () => {
  const { w, run } = loadApp();
  w.__rows = [{ naam: "Marloes de Boer", bedrijf: "De Boer Advies", email: "marloes@deboeradvies.nl", telefoon: "06 3010 4471", adres: "Kerkplein 5, 9711AB Groningen", conf: "hoog" }];
  run("addContacts(__rows,'x.pdf')");
  const rows = JSON.parse(run(`(()=>{ const r=buildExport(); return JSON.stringify(XLSX.utils.sheet_to_json(r.wb.Sheets.Contacts,{header:1})); })()`));
  assert.deepEqual(rows[0], ["First name", "Name prefix", "Last name", "Company", "Job title", "Email", "Phone", "Street address", "Postcode", "City", "Website", "LinkedIn"]);
  assert.deepEqual(rows[1].slice(0, 3), ["Marloes", "de", "Boer"]);
  assert.deepEqual(rows[1].slice(7, 10), ["Kerkplein 5", "9711 AB", "Groningen"]);
});

test("exact duplicates from two sources are merged and the missing fields filled in", () => {
  const { w, run } = loadApp();
  w.__a = [{ naam: "Anouk Verhoef", bedrijf: "Verhoef Catering", email: "anouk@verhoefcatering.nl", telefoon: "06-52418830", conf: "hoog" }];
  w.__b = [{ naam: "Anouk Verhoef", bedrijf: "Verhoef Catering BV", email: "Anouk@VerhoefCatering.nl", functie: "Account manager", conf: "hoog" }];
  run("addContacts(__a,'a.pdf'); addContacts(__b,'b.eml')");
  assert.equal(run("contacts.length"), 1);
  assert.equal(run("dupes"), 1);
  assert.equal(run("contacts[0].functie"), "Account manager");
  assert.equal(run("contacts[0].bron.length"), 2);
});

test("same email address with a different name is never merged silently", () => {
  const { w, run } = loadApp();
  w.__rows = [
    { naam: "Lotte van Dijk", bedrijf: "Noordland Services", email: "lotte.vandijk@noordlandservices.nl", telefoon: "0612345678", conf: "hoog" },
    { naam: "M. de Vries", bedrijf: "Noordland Services", email: "lotte.vandijk@noordlandservices.nl", telefoon: "0687654321", conf: "hoog" },
  ];
  run("addContacts(__rows,'x.pdf')");
  assert.equal(run("contacts.length"), 2);
  assert.equal(run("contacts.find(c=>c.naam==='M. de Vries').status"), "check");
});

test("Dutch phone numbers are normalised to one format", () => {
  const { run } = loadApp();
  const cases = {
    "06-41239876": "+31 6 41239876",
    "0529 437 120": "+31 529 437120",
    "+31 (0)38 333 4521": "+31 38 3334521",
    "0031 20 845 3321": "+31 20 8453321",
    "+44 20 7946 0958": "+442079460958",
  };
  for (const [input, out] of Object.entries(cases)) assert.equal(run(`normPhone(${JSON.stringify(input)})`), out, input);
  assert.equal(run(`normPhone("06-12 4")`), null);
});

test("names are split into first name, prefix and last name", () => {
  const { run } = loadApp();
  assert.deepEqual(JSON.parse(run(`JSON.stringify(splitName("Joost van der Meer"))`)), ["Joost", "van der", "Meer"]);
  assert.deepEqual(JSON.parse(run(`JSON.stringify(splitName("Fatima El Idrissi"))`)), ["Fatima", "", "El Idrissi"]);
  assert.deepEqual(JSON.parse(run(`JSON.stringify(splitName("Anouk"))`)), ["Anouk", "", ""]);
});

test("addresses are split into street, postcode and city", () => {
  const { run } = loadApp();
  const split = (a) => JSON.parse(run(`JSON.stringify(splitAddr(${JSON.stringify(a)}))`));
  assert.deepEqual(split("Stationsweg 14, 8011 CZ Zwolle"), { straat: "Stationsweg 14", postcode: "8011 CZ", plaats: "Zwolle" });
  assert.deepEqual(split("Amsterdam"), { straat: "", postcode: "", plaats: "Amsterdam" });
  assert.deepEqual(split("Industrieweg 3, Dalfsen"), { straat: "Industrieweg 3", postcode: "", plaats: "Dalfsen" });
});

test("emails: headers, base64 body and attachments are read", () => {
  const { run } = loadApp();
  const mime = [
    "From: =?utf-8?Q?Jo=C3=ABl_Kok?= <joel@kok.example>",
    "Subject: Test",
    'Content-Type: multipart/mixed; boundary="AA"',
    "",
    "--AA",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    "R3JvZXRlbiwgSm/Dq2wKMDYtMTIzNDU2Nzg=",
    "--AA",
    'Content-Type: application/pdf; name="list.pdf"',
    'Content-Disposition: attachment; filename="list.pdf"',
    "Content-Transfer-Encoding: base64",
    "",
    "JVBERi0xLjQ=",
    "--AA--",
    "",
  ].join("\n");
  const r = JSON.parse(run(`(()=>{const r=parseEml(${JSON.stringify(mime)}); return JSON.stringify({text:r.text, files:r.attachments.map(f=>f.name)});})()`));
  assert.match(r.text, /From: Joël Kok <joel@kok\.example>/);
  assert.match(r.text, /06-12345678/);
  assert.deepEqual(r.files, ["list.pdf"]);
});

test("long documents are cut into parts at line boundaries", () => {
  const { run } = loadApp();
  assert.equal(run(`chunks("a\\n".repeat(10)+"x".repeat(25),10).length`), 5);
});
