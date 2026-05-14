import type { FinanceType, MathOptions } from "./types";

// ============================================================================
// Finance Mode
// ============================================================================
export function calculateFinance(type: FinanceType, options: MathOptions): number {
  const { principal = 0, rate = 0, years = 0, periods, payment = 0, cashflows } = options;
  const r = rate / 100; // Convert percentage to decimal

  switch (type) {
    case "compound":
      // FV = PV * (1 + r)^n
      const n = periods || years;
      return principal * Math.pow(1 + r, n);

    case "simple":
      // FV = PV * (1 + r*n)
      return principal * (1 + r * years);

    case "npv":
      // NPV = sum(CF_t / (1+r)^t)
      if (!cashflows) throw new Error("Cash flows required for NPV");
      const flows = cashflows.split(",").map(Number);
      return flows.reduce((npv, cf, t) => npv + cf / Math.pow(1 + r, t), 0);

    case "irr":
      // IRR calculation using Newton-Raphson method
      if (!cashflows) throw new Error("Cash flows required for IRR");
      return calculateIRR(cashflows.split(",").map(Number));

    case "pmt":
      // PMT = PV * (r * (1+r)^n) / ((1+r)^n - 1)
      const monthlyRate = r / 12;
      const numPayments = years * 12;
      return principal * (monthlyRate * Math.pow(1 + monthlyRate, numPayments)) /
             (Math.pow(1 + monthlyRate, numPayments) - 1);

    case "fv":
      // Future Value = PV * (1 + r)^n
      return principal * Math.pow(1 + r, years);

    case "pv":
      // Present Value = FV / (1 + r)^n
      return payment / Math.pow(1 + r, years);

    default:
      throw new Error(`Unknown finance type: ${type}`);
  }
}

function calculateIRR(cashflows: number[], guess: number = 0.1): number {
  const maxIterations = 100;
  const tolerance = 0.0001;
  let rate = guess;

  for (let i = 0; i < maxIterations; i++) {
    let npv = 0;
    let dnpv = 0;

    for (let t = 0; t < cashflows.length; t++) {
      npv += cashflows[t] / Math.pow(1 + rate, t);
      dnpv -= t * cashflows[t] / Math.pow(1 + rate, t + 1);
    }

    const newRate = rate - npv / dnpv;

    if (Math.abs(newRate - rate) < tolerance) {
      return newRate * 100; // Return as percentage
    }

    rate = newRate;
  }

  throw new Error("IRR did not converge");
}
