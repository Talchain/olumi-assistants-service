import { Buffer } from "node:buffer";
import pdf from "pdf-parse";
import Papa from "papaparse";

export type DocPreview = {
  source: string;
  type: "pdf" | "csv" | "txt" | "md";
  preview: string;
  locationHint?: string;
};

const CAP = 5000;

const cap = (text: string) => text.slice(0, CAP);

export async function toPreview(kind: string, name: string, buf: Buffer): Promise<DocPreview> {
  if (kind === "pdf") {
    const data = await pdf(buf);
    return {
      source: name,
      type: "pdf",
      preview: cap(data.text),
      locationHint: "page refs required by model"
    };
  }
  if (kind === "csv") {
    const text = buf.toString("utf8");
    const parsed = Papa.parse(text, { header: true });
    const rows = (parsed.data as Record<string, string>[]).filter(Boolean);
    const cols = parsed.meta.fields || [];
    const numericCols = cols
      .filter((c: string) =>
        rows.some((r) => {
          const value = Number(r[c as keyof typeof r]);
          return !Number.isNaN(value) && r[c as keyof typeof r] !== "";
        })
      )
      .slice(0, 6);
    const headline = `CSV ${name}: rows=${rows.length}, cols=${cols.length}, numeric=${numericCols.join(", ")}`;
    return {
      source: name,
      type: "csv",
      preview: cap(`${headline}\n${text.slice(0, 3000)}`)
    };
  }
  const text = buf.toString("utf8");
  return {
    source: name,
    type: kind as DocPreview["type"],
    preview: cap(text)
  };
}
