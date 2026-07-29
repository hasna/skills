#!/usr/bin/env bun
import { parseArgs } from "util";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    independent: { type: "string" }, // categorical, continuous
    dependent: { type: "string" },   // categorical, continuous
    groups: { type: "string" },      // 1, 2, >2
    paired: { type: "boolean" },     // true/false
    parametric: { type: "boolean", default: true }, // true/false
    help: { type: "boolean" },
  },
  allowPositionals: true,
});

if (values.help || !values.independent || !values.dependent) {
  console.log(`
Statistical Test Selector
Usage: skills run statistical-test-selector --independent <type> --dependent <type> [options]

Options:
  --independent <type>   Type of independent variable (categorical, continuous)
  --dependent <type>     Type of dependent variable (categorical, continuous)
  --groups <n>           Number of groups/levels in independent variable (1, 2, >2)
  --paired               Whether data is paired/matched (e.g., pre/post)
  --parametric           Assume normal distribution (default: true)
`);
  process.exit(0);
}

const ind = values.independent;
const dep = values.dependent;
const groups = values.groups || "2";
const paired = values.paired || false;
const parametric = values.parametric;

let recommendation = "Consult a statistician.";

if (ind === "categorical" && dep === "continuous") {
  if (groups === "2") {
    if (paired) {
      recommendation = parametric ? "Paired t-test" : "Wilcoxon signed-rank test";
    } else {
      recommendation = parametric ? "Independent samples t-test" : "Mann-Whitney U test";
    }
  } else if (groups === ">2") {
    if (paired) {
      recommendation = parametric ? "Repeated measures ANOVA" : "Friedman test";
    } else {
      recommendation = parametric ? "One-way ANOVA" : "Kruskal-Wallis H test";
    }
  }
} else if (ind === "categorical" && dep === "categorical") {
  if (paired) {
    recommendation = "McNemar's test";
  } else {
    recommendation = "Chi-square test of independence (or Fisher's exact test for small samples)";
  }
} else if (ind === "continuous" && dep === "continuous") {
  recommendation = parametric ? "Pearson correlation or Linear Regression" : "Spearman rank correlation";
} else if (ind === "continuous" && dep === "categorical") {
  recommendation = "Logistic Regression";
}

console.log(`
Recommended Test: ${recommendation}

Context:
- Independent Variable: ${ind}
- Dependent Variable: ${dep}
- Groups: ${groups}
- Paired: ${paired}
- Parametric Assumption: ${parametric}
`);