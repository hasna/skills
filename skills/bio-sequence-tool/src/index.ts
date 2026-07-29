#!/usr/bin/env bun
import { parseArgs } from "util";

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    mode: { type: "string", default: "reverse-complement" }, // reverse-complement, translate, gc-content
    help: { type: "boolean" },
  },
  allowPositionals: true,
});

if (values.help || positionals.length === 0) {
  console.log(`
Bio Sequence Tool
Usage: skills run bio-sequence-tool -- <sequence> [options]

Options:
  --mode <mode>    Operation mode: reverse-complement, translate, gc-content
`);
  process.exit(0);
}

const sequence = positionals[0].toUpperCase().replace(/[^ATGCU]/g, "");

if (!sequence) {
  console.error("Error: Invalid sequence provided.");
  process.exit(1);
}

function reverseComplement(seq: string): string {
  const map: Record<string, string> = { A: "T", T: "A", G: "C", C: "G", U: "A" };
  return seq.split("").reverse().map(c => map[c] || c).join("");
}

function getGCContent(seq: string): number {
  const gc = seq.split("").filter(c => c === "G" || c === "C").length;
  return (gc / seq.length) * 100;
}

function translate(seq: string): string {
  // Basic codon table (DNA)
  const codons: Record<string, string> = {
    ATA: "I", ATC: "I", ATT: "I", ATG: "M",
    ACA: "T", ACC: "T", ACG: "T", ACT: "T",
    AAC: "N", AAT: "N", AAA: "K", AAG: "K",
    AGC: "S", AGT: "S", AGA: "R", AGG: "R",
    CTA: "L", CTC: "L", CTG: "L", CTT: "L",
    CCA: "P", CCC: "P", CCG: "P", CCT: "P",
    CAC: "H", CAT: "H", CAA: "Q", CAG: "Q",
    CGA: "R", CGC: "R", CGG: "R", CGT: "R",
    GTA: "V", GTC: "V", GTG: "V", GTT: "V",
    GCA: "A", GCC: "A", GCG: "A", GCT: "A",
    GAC: "D", GAT: "D", GAA: "E", GAG: "E",
    GGA: "G", GGC: "G", GGG: "G", GGT: "G",
    TCA: "S", TCC: "S", TCG: "S", TCT: "S",
    TTC: "F", TTT: "F", TTA: "L", TTG: "L",
    TAC: "Y", TAT: "Y", TAA: "_", TAG: "_",
    TGC: "C", TGT: "C", TGA: "_", TGG: "W",
  };

  let protein = "";
  for (let i = 0; i < seq.length; i += 3) {
    const codon = seq.substr(i, 3);
    if (codon.length === 3) {
      protein += codons[codon] || "?";
    }
  }
  return protein;
}

switch (values.mode) {
  case "reverse-complement":
    console.log(reverseComplement(sequence));
    break;
  case "translate":
    console.log(translate(sequence.replace(/U/g, "T"))); // Treat as DNA for simplicity
    break;
  case "gc-content":
    console.log(`${getGCContent(sequence).toFixed(2)}%`);
    break;
  default:
    console.error(`Unknown mode: ${values.mode}`);
    process.exit(1);
}