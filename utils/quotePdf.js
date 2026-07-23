const MONEY = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });

function cleanText(value) {
  return String(value ?? "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^\x20-\x7E\u00A3]/g, "");
}

function pdfEscape(value) {
  return cleanText(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrap(value, width = 82) {
  const words = cleanText(value).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  words.forEach((word) => {
    if (!line || `${line} ${word}`.length <= width) {
      line = line ? `${line} ${word}` : word;
    } else {
      lines.push(line);
      line = word;
    }
  });
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function createPdf(title, entries) {
  const expanded = [];
  entries.forEach((entry) => {
    if (entry.space) return expanded.push({ text: "", size: 6 });
    wrap(entry.text, entry.width || 82).forEach((line, index) => {
      expanded.push({ ...entry, text: line, continued: index > 0 });
    });
  });
  const chunks = [];
  for (let index = 0; index < expanded.length; index += 42) {
    chunks.push(expanded.slice(index, index + 42));
  }
  if (!chunks.length) chunks.push([]);

  const objects = [];
  const addObject = (body) => {
    objects.push(body);
    return objects.length;
  };
  const catalogId = addObject("");
  const pagesId = addObject("");
  const regularFontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const boldFontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  const pageIds = [];

  chunks.forEach((lines, pageIndex) => {
    const commands = [
      "0.04 0.18 0.23 rg",
      `BT /F2 20 Tf 48 790 Td (${pdfEscape(title)}) Tj ET`,
      "0.00 0.49 0.62 RG 2 w 48 776 m 547 776 l S",
    ];
    let y = 750;
    lines.forEach((entry) => {
      const size = entry.size || 10;
      const font = entry.bold ? "F2" : "F1";
      const colour = entry.muted ? "0.35 0.44 0.47" : "0.04 0.18 0.23";
      commands.push(`${colour} rg BT /${font} ${size} Tf 48 ${y} Td (${pdfEscape(entry.text)}) Tj ET`);
      y -= entry.leading || (size + 6);
    });
    commands.push(`0.35 0.44 0.47 rg BT /F1 8 Tf 48 30 Td (Page ${pageIndex + 1} of ${chunks.length}) Tj ET`);
    const stream = commands.join("\n");
    const contentId = addObject(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    const pageId = addObject(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] ` +
      `/Resources << /Font << /F1 ${regularFontId} 0 R /F2 ${boldFontId} 0 R >> >> ` +
      `/Contents ${contentId} 0 R >>`
    );
    pageIds.push(pageId);
  });

  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

function detail(label, value) {
  return { text: `${label}: ${value || "-"}` };
}

function buildFinanceSummaryPdf({ quoteNumber, storeName, customer, finance }) {
  return createPdf(`Finance illustration - ${quoteNumber || ""}`, [
    { text: "YOUR FINANCE CALCULATION", bold: true, size: 12 },
    detail("Customer", `${customer.firstName} ${customer.lastName}`),
    detail("Store", storeName),
    detail("Quote number", quoteNumber),
    { space: true },
    detail("Sale amount", MONEY.format(finance.saleAmount || 0)),
    detail("Deposit", MONEY.format(finance.deposit || 0)),
    detail("Amount financed", MONEY.format(finance.amountFinanced || 0)),
    detail("Term", `${Number(finance.termMonths || 0)} months`),
    detail("Estimated monthly payment", MONEY.format(finance.estimatedMonthlyPayment || 0)),
    detail("Interest", finance.apr || "0% interest"),
    detail("Total payable", MONEY.format(finance.totalPayable || 0)),
    { space: true },
    {
      text: "This document is an illustration only. Final finance is subject to approval, lender terms and product availability.",
      muted: true,
    },
  ]);
}

module.exports = { buildFinanceSummaryPdf, createPdf };
