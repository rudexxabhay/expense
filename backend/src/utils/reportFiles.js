import { deflateRawSync } from "zlib";

function crc32(buffer) {
  let crc = ~0;
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function dosDateTime(date = new Date()) {
  const time = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() / 2) & 0x1f);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function u16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0);
  return buffer;
}

export function zipFiles(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const now = dosDateTime();

  for (const file of files) {
    const name = Buffer.from(file.name);
    const content = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content);
    const compressed = deflateRawSync(content);
    const crc = crc32(content);
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0), u16(8), u16(now.time), u16(now.day),
      u32(crc), u32(compressed.length), u32(content.length), u16(name.length), u16(0), name, compressed
    ]);
    locals.push(local);
    centrals.push(Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(8), u16(now.time), u16(now.day),
      u32(crc), u32(compressed.length), u32(content.length), u16(name.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(offset), name
    ]));
    offset += local.length;
  }

  const central = Buffer.concat(centrals);
  return Buffer.concat([
    ...locals,
    central,
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(central.length), u32(offset), u16(0)
  ]);
}

export function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function colName(index) {
  let name = "";
  let n = index + 1;
  while (n > 0) {
    const mod = (n - 1) % 26;
    name = String.fromCharCode(65 + mod) + name;
    n = Math.floor((n - mod) / 26);
  }
  return name;
}

function sheetXml(rows) {
  const sheetRows = rows.map((row, rIndex) => {
    const cells = row.map((cell, cIndex) => {
      const ref = `${colName(cIndex)}${rIndex + 1}`;
      if (typeof cell === "number") return `<c r="${ref}"><v>${cell}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(cell)}</t></is></c>`;
    }).join("");
    return `<row r="${rIndex + 1}">${cells}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetData>${sheetRows}</sheetData><autoFilter ref="A1:${colName(Math.max(...rows.map((row) => row.length), 1) - 1)}${Math.max(rows.length, 1)}"/></worksheet>`;
}

export function createXlsx(sheets) {
  const sheetEntries = sheets.map((sheet, index) => ({
    ...sheet,
    id: index + 1,
    file: `xl/worksheets/sheet${index + 1}.xml`
  }));
  return zipFiles([
    {
      name: "[Content_Types].xml",
      content: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheetEntries.map((sheet) => `<Override PartName="/${sheet.file}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`
    },
    {
      name: "_rels/.rels",
      content: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetEntries.map((sheet) => `<Relationship Id="rId${sheet.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${sheet.id}.xml"/>`).join("")}</Relationships>`
    },
    {
      name: "xl/workbook.xml",
      content: `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetEntries.map((sheet) => `<sheet name="${xmlEscape(sheet.name).slice(0, 31)}" sheetId="${sheet.id}" r:id="rId${sheet.id}"/>`).join("")}</sheets></workbook>`
    },
    ...sheetEntries.map((sheet) => ({ name: sheet.file, content: sheetXml(sheet.rows) }))
  ]);
}

function pdfEscape(value) {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function truncate(value, max = 28) {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function createPdf({ title, metaLines, summaryRows, tableHeaders, tableRows, additionalTables = [] }) {
  const pageWidth = 842;
  const pageHeight = 595;
  const margin = 34;
  const rowHeight = 16;
  const widths = [52, 34, 66, 58, 58, 58, 55, 53, 53, 51, 50, 80];
  const pages = [];
  let lines = [];
  let y = pageHeight - margin;

  const addText = (text, x, size = 8, bold = false) => {
    lines.push(`/${bold ? "F2" : "F1"} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${pdfEscape(text)}) Tj`);
  };
  const newPage = () => {
    pages.push(lines);
    lines = [];
    y = pageHeight - margin;
  };
  const header = () => {
    addText(title, margin, 16, true);
    y -= 20;
    metaLines.forEach((line) => {
      addText(line, margin, 8);
      y -= 11;
    });
    y -= 8;
  };
  const tableHeader = (headers = tableHeaders, columnWidths = widths) => {
    let x = margin;
    headers.forEach((head, index) => {
      addText(head, x, 7, true);
      x += columnWidths[index] || 60;
    });
    y -= rowHeight;
  };

  header();
  summaryRows.forEach(([label, value]) => {
    addText(`${label}: ${value}`, margin, 9, true);
    y -= 12;
  });
  y -= 8;
  tableHeader();

  tableRows.forEach((row) => {
    if (y < margin + 28) {
      newPage();
      header();
      tableHeader();
    }
    let x = margin;
    row.forEach((cell, index) => {
      addText(truncate(cell, index === row.length - 1 ? 34 : 18), x, 7);
      x += widths[index] || 60;
    });
    y -= rowHeight;
  });
  additionalTables.forEach((section) => {
    const sectionStart = () => {
      newPage();
      header();
      addText(section.title, margin, 11, true);
      y -= 16;
      tableHeader(section.headers, section.widths || widths);
    };
    sectionStart();
    section.rows.forEach((row) => {
      if (y < margin + 28) sectionStart();
      let x = margin;
      row.forEach((cell, index) => {
        addText(truncate(cell, section.maxChars || (index === row.length - 1 ? 34 : 18)), x, 7);
        x += section.widths?.[index] || widths[index] || 60;
      });
      y -= rowHeight;
    });
  });
  newPage();

  const objects = [];
  const addObject = (body) => {
    objects.push(body);
    return objects.length;
  };
  const font1 = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const font2 = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  const pageRefs = [];
  pages.forEach((page, index) => {
    const stream = `BT\n${page.join("\n")}\n/F1 8 Tf 1 0 0 1 ${pageWidth - 78} 20 Tm (Page ${index + 1} of ${pages.length}) Tj\nET`;
    const content = addObject(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
    pageRefs.push(addObject(`<< /Type /Page /Parent 0 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${font1} 0 R /F2 ${font2} 0 R >> >> /Contents ${content} 0 R >>`));
  });
  const pagesRef = addObject(`<< /Type /Pages /Kids [${pageRefs.map((ref) => `${ref} 0 R`).join(" ")}] /Count ${pageRefs.length} >>`);
  const catalogRef = addObject(`<< /Type /Catalog /Pages ${pagesRef} 0 R >>`);
  pageRefs.forEach((ref) => {
    objects[ref - 1] = objects[ref - 1].replace("/Parent 0 0 R", `/Parent ${pagesRef} 0 R`);
  });
  const parts = ["%PDF-1.4\n"];
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(parts.join("")));
    parts.push(`${index + 1} 0 obj\n${body}\nendobj\n`);
  });
  const xref = Buffer.byteLength(parts.join(""));
  parts.push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  offsets.slice(1).forEach((offset) => parts.push(`${String(offset).padStart(10, "0")} 00000 n \n`));
  parts.push(`trailer\n<< /Size ${objects.length + 1} /Root ${catalogRef} 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return Buffer.from(parts.join(""));
}
