import type { Payslip } from "./types";

/**
 * A one-page payslip PDF, written by hand: a payslip is a few lines of text,
 * so a PDF library would add far more weight than it saves. Uses the built-in
 * Helvetica fonts, which only cover Latin-1, so amounts read "INR 92,000.00"
 * rather than using the rupee sign.
 */

type Op = string;

const A4 = { w: 595.28, h: 841.89 };
const MARGIN = 48;
// Brand green (#0C4F37) and the action green (#15803D), as PDF RGB fractions.
const DEEP = "0.047 0.31 0.216";
const GREEN = "0.082 0.502 0.239";
const INK = "0.063 0.094 0.157";
const MUTED = "0.365 0.42 0.478";
const LINE = "0.89 0.914 0.898";
const SOFT = "0.863 0.988 0.906";

function esc(text: string): string {
  // Latin-1 only; anything else becomes "?" so the file stays valid.
  return text.replace(/[^\x20-\x7e]/g, "?").replace(/([\\()])/g, "\\$1");
}

function text(x: number, y: number, s: string, size = 10, bold = false, color = INK): Op {
  return `BT ${color} rg /${bold ? "F2" : "F1"} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${esc(s)}) Tj ET`;
}

/** Approximate Helvetica width, for right-aligning amounts. */
function width(s: string, size: number, bold = false): number {
  return s.length * size * (bold ? 0.56 : 0.52);
}

function textRight(xRight: number, y: number, s: string, size = 10, bold = false, color = INK): Op {
  return text(xRight - width(s, size, bold), y, s, size, bold, color);
}

function rect(x: number, y: number, w: number, h: number, color: string): Op {
  return `${color} rg ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`;
}

function rule(y: number, color = LINE): Op {
  return `${color} RG 0.8 w ${MARGIN} ${y.toFixed(2)} m ${(A4.w - MARGIN).toFixed(2)} ${y.toFixed(2)} l S`;
}

function money(value: number, currency: string): string {
  const n = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  return `${currency} ${n}`;
}

function assemble(content: string): Blob {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.w} ${A4.h}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  // Every character is ASCII, so string length equals byte length for the offsets above.
  return new Blob([pdf], { type: "application/pdf" });
}

export function payslipPdf({
  payslip,
  period,
  employeeName,
  employeeCode,
  organizationName,
}: {
  payslip: Payslip;
  period: string;
  employeeName: string;
  employeeCode?: string | null;
  organizationName?: string | null;
}): Blob {
  const inputs = (payslip.calculationInputs ?? {}) as Record<string, unknown>;
  const currency = typeof inputs.currency === "string" ? inputs.currency : "INR";
  const segments = Array.isArray(inputs.salarySegments) ? (inputs.salarySegments as { monthlyGross?: number }[]) : [];
  const monthlyGross = segments.length ? Number(segments[segments.length - 1].monthlyGross ?? 0) : null;
  const right = A4.w - MARGIN;
  const ops: Op[] = [];

  // Header band.
  ops.push(rect(0, A4.h - 110, A4.w, 110, DEEP));
  ops.push(text(MARGIN, A4.h - 52, "WorkEasy", 22, true, "1 1 1"));
  ops.push(text(MARGIN + width("WorkEasy", 22, true) + 1, A4.h - 52, "360", 22, true, "0.29 0.871 0.502"));
  ops.push(text(MARGIN, A4.h - 76, "HRMS  |  Payslip", 11, false, "0.906 0.961 0.933"));
  ops.push(textRight(right, A4.h - 52, period, 16, true, "1 1 1"));
  if (organizationName) ops.push(textRight(right, A4.h - 76, organizationName, 11, false, "0.906 0.961 0.933"));

  // Employee block.
  let y = A4.h - 150;
  ops.push(text(MARGIN, y, "Employee", 9, false, MUTED));
  ops.push(text(MARGIN + 200, y, "Employee code", 9, false, MUTED));
  ops.push(text(MARGIN + 340, y, "Published", 9, false, MUTED));
  y -= 16;
  ops.push(text(MARGIN, y, employeeName, 12, true));
  ops.push(text(MARGIN + 200, y, employeeCode ?? "-", 12, true));
  ops.push(
    text(
      MARGIN + 340,
      y,
      payslip.publishedAt ? new Date(payslip.publishedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "-",
      12,
      true,
    ),
  );
  y -= 30;
  ops.push(rule(y));

  // Salary summary.
  y -= 28;
  ops.push(text(MARGIN, y, "Salary summary", 13, true));
  const rows: [string, string, boolean?][] = [];
  if (monthlyGross !== null) rows.push(["Monthly gross salary", money(monthlyGross, currency)]);
  rows.push(["Paid days", `${payslip.paidDays} of ${payslip.payableDays}`]);
  if (Number(inputs.unpaidLeaveDays ?? 0) > 0) rows.push(["Unpaid leave days", String(inputs.unpaidLeaveDays)]);
  rows.push(["Gross pay for the period", money(payslip.grossPay, currency), true]);
  rows.push(["Deductions", money(payslip.deductions, currency)]);
  for (const [label, value, strong] of rows) {
    y -= 26;
    ops.push(text(MARGIN, y, label, 11, !!strong, strong ? INK : "0.204 0.251 0.329"));
    ops.push(textRight(right, y, value, 11, !!strong));
    ops.push(rule(y - 10));
  }

  // Net pay band.
  y -= 52;
  ops.push(rect(MARGIN, y - 10, right - MARGIN, 36, SOFT));
  ops.push(text(MARGIN + 14, y + 3, "Net pay", 14, true, DEEP));
  ops.push(textRight(right - 14, y + 3, money(payslip.netPay, currency), 14, true, DEEP));

  if (payslip.revisionNumber > 1) {
    y -= 36;
    ops.push(text(MARGIN, y, `Revision ${payslip.revisionNumber}${payslip.revisionNote ? `: ${payslip.revisionNote}` : ""}`.slice(0, 95), 10, false, GREEN));
  }

  // Footer.
  ops.push(rule(MARGIN + 34));
  ops.push(text(MARGIN, MARGIN + 18, "A published payslip records what was calculated for the period. It is not confirmation that the salary has been paid.", 8, false, MUTED));
  ops.push(text(MARGIN, MARGIN + 6, "Generated by WorkEasy360 HRMS.", 8, false, MUTED));

  return assemble(ops.join("\n"));
}
