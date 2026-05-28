import { mathConfig } from "./runtime";

// ============================================================================
// Unit Conversion Mode
// ============================================================================
const unitMappings: Record<string, string> = {
  // Length
  "meter": "m", "meters": "m", "m": "m",
  "kilometer": "km", "kilometers": "km", "km": "km",
  "centimeter": "cm", "centimeters": "cm", "cm": "cm",
  "millimeter": "mm", "millimeters": "mm", "mm": "mm",
  "mile": "mile", "miles": "mile",
  "yard": "yard", "yards": "yard",
  "foot": "ft", "feet": "ft", "ft": "ft",
  "inch": "inch", "inches": "inch", "in": "inch",

  // Mass
  "kilogram": "kg", "kilograms": "kg", "kg": "kg",
  "gram": "g", "grams": "g", "g": "g",
  "milligram": "mg", "milligrams": "mg", "mg": "mg",
  "pound": "lb", "pounds": "lb", "lb": "lb", "lbs": "lb",
  "ounce": "oz", "ounces": "oz", "oz": "oz",
  "ton": "ton", "tons": "ton",

  // Time
  "second": "s", "seconds": "s", "s": "s", "sec": "s",
  "minute": "min", "minutes": "min", "min": "min",
  "hour": "hour", "hours": "hour", "hr": "hour", "h": "hour",
  "day": "day", "days": "day",
  "week": "week", "weeks": "week",
  "month": "month", "months": "month",
  "year": "year", "years": "year", "yr": "year",
};

export function convertUnit(value: number, from: string, to: string): number {
  const fromUnit = unitMappings[from.toLowerCase()] || from;
  const toUnit = unitMappings[to.toLowerCase()] || to;

  // Handle temperature separately (not supported by mathjs unit system)
  if (["celsius", "fahrenheit", "kelvin"].includes(from.toLowerCase())) {
    return convertTemperature(value, from.toLowerCase(), to.toLowerCase());
  }

  // Handle data sizes separately
  if (["bit", "byte", "kilobyte", "megabyte", "gigabyte", "terabyte", "petabyte"].includes(from.toLowerCase())) {
    return convertDataSize(value, from.toLowerCase(), to.toLowerCase());
  }

  try {
    const result = mathConfig.evaluate(`${value} ${fromUnit} to ${toUnit}`);
    return Number(result.toNumeric(toUnit));
  } catch (error) {
    throw new Error(`Failed to convert ${from} to ${to}: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

function convertTemperature(value: number, from: string, to: string): number {
  let celsius: number;

  // Convert to Celsius first
  switch (from) {
    case "celsius": celsius = value; break;
    case "fahrenheit": celsius = (value - 32) * 5 / 9; break;
    case "kelvin": celsius = value - 273.15; break;
    default: throw new Error(`Unknown temperature unit: ${from}`);
  }

  // Convert from Celsius to target
  switch (to) {
    case "celsius": return celsius;
    case "fahrenheit": return celsius * 9 / 5 + 32;
    case "kelvin": return celsius + 273.15;
    default: throw new Error(`Unknown temperature unit: ${to}`);
  }
}

function convertDataSize(value: number, from: string, to: string): number {
  const bytes: Record<string, number> = {
    "bit": 0.125,
    "byte": 1,
    "kilobyte": 1024,
    "megabyte": 1024 ** 2,
    "gigabyte": 1024 ** 3,
    "terabyte": 1024 ** 4,
    "petabyte": 1024 ** 5,
  };

  const valueInBytes = value * bytes[from];
  return valueInBytes / bytes[to];
}
