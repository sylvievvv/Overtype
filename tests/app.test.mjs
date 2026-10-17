// Tests for Overtyp's deterministic layer: reading, normalising, validating and merging contacts.
// The AI extraction step needs the Claude runtime, so these tests feed in what the model is asked
// to return for the fixture (one object per table row) and check everything that happens after it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TextDecoder, TextEncoder } from "node:util";
import { JSDOM } from "jsdom";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const expected = JSON.parse(readFileSync(new URL("./fixtures/sample-contacts.expected.json", import.meta.url), "utf8"));

// Load the real page (CDN libraries are not fetched; the code under test doesn't need them).
function loadApp() {
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse(w) { w.TextDecoder = TextDecoder; w.TextEncoder = TextEncoder; w.scrollTo = () => {}; },
  });
  const w = dom.window;
  const run = (code) => w.eval(code);
  run("contacts=[]; dupes=0; isExample=false; base=null;");
  return { w, run };
}

// The same text extraction the page does in readPdf(), using the same pdf.js version.
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

// What the model is instructed to return for this clean table: one object per row, copied verbatim.
function rowsAsModelOutput(text) {
  const out = [];
  for (const line of text.split("\n")) {
    const p = line.trim().split(/\s{3,}/);
    if (!/^\d{4}$/.test(p[0])) continue;
    const [id, naam, bedrijf, functie, ...rest] = p;
    out.push({
      id, naam, bedrijf, functie,
      email: rest.find((x) => x.includes("@")) || "",
      telefoon: rest.find((x) => /^0\d/.test(x)) || "",
      adres: rest[rest.length - 1], website: "", linkedin: "",
      conf: "hoog", twijfel: "", snippet: line.trim().slice(0, 120),
    });
  }
  return out;
}

const fixture = new URL("./fixtures/sample-contacts.pdf", import.meta.url).pathname;

test("PDF text extraction finds all 52 rows", async () => {
  const rows = rowsAsModelOutput(await pdfText(fixture));
  assert.equal(rows.length, expected.rows);
  assert.deepEqual(rows.map((r) => +r.id), Array.from({ length: 52 }, (_, i) => 1001 + i));
});

test("fixture: exactly the four planted inconsistencies are flagged, with the right reasons", async () => {
  const { w, run } = loadApp();
  const rows = rowsAsModelOutput(await pdfText(fixture));
  w.__rows = rows;
  run("addContacts(__rows, 'sample-contacts.pdf')");
  const flagged = JSON.parse(run(`JSON.stringify(contacts.filter(c=>c.status==='check').map(c=>({id:c.bron[0].snippet.slice(0,4), reasons:c.issues.map(i=>i.m)})))`));
  assert.equal(run("contacts.length"), 52, "rows with different details must stay separate");
  assert.equal(run("dupes"), 0);
  assert.deepEqual(flagged.map((f) => f.id).sort(), Object.keys(expected.flagged).sort());
  for (const f of flagged) assert.deepEqual(f.reasons, expected.flagged[f.id], `reasons for row ${f.id}`);
});

test("people who repeat with different details get a note, not an error", async () => {
  const { w, run } = loadApp();
  w.__rows = rowsAsModelOutput(await pdfText(fixture));
  run("addContacts(__rows, 'sample-contacts.pdf')");
  const jan = JSON.parse(run(`JSON.stringify(contacts.filter(c=>c.naam==='Jan Jansen').map(c=>[c.status,c.repeat]))`));
  assert.deepEqual(jan, [["ok", 3], ["ok", 3], ["ok", 3]]);
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
