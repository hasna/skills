import type { SchemaObject } from "./types";

export function openApiTypeToTS(schema: SchemaObject | undefined, refs: Record<string, SchemaObject> = {}): string {
  if (!schema) return "any";

  if (schema.$ref) {
    const refName = schema.$ref.split("/").pop() || "any";
    return refName;
  }

  if (schema.enum) {
    return schema.enum.map((value) => typeof value === "string" ? `"${value}"` : value).join(" | ");
  }

  const baseType = (() => {
    switch (schema.type) {
      case "string":
        if (schema.format === "date-time") return "Date | string";
        if (schema.format === "date") return "Date | string";
        return "string";
      case "number":
      case "integer":
        return "number";
      case "boolean":
        return "boolean";
      case "array":
        return `Array<${openApiTypeToTS(schema.items, refs)}>`;
      case "object":
        if (!schema.properties) return "Record<string, any>";
        return `{\n${Object.entries(schema.properties)
          .map(([key, prop]) => {
            const optional = !schema.required?.includes(key) ? "?" : "";
            return `  ${key}${optional}: ${openApiTypeToTS(prop, refs)};`;
          })
          .join("\n")}\n}`;
      default:
        return "any";
    }
  })();

  return schema.nullable ? `${baseType} | null` : baseType;
}

export function openApiTypeToPython(schema: SchemaObject | undefined): string {
  if (!schema) return "Any";

  if (schema.$ref) {
    const refName = schema.$ref.split("/").pop() || "Any";
    return refName;
  }

  if (schema.enum) {
    return "Literal[" + schema.enum.map((value) => typeof value === "string" ? `"${value}"` : value).join(", ") + "]";
  }

  const baseType = (() => {
    switch (schema.type) {
      case "string":
        if (schema.format === "date-time") return "datetime";
        if (schema.format === "date") return "date";
        return "str";
      case "number":
        return "float";
      case "integer":
        return "int";
      case "boolean":
        return "bool";
      case "array":
        return `List[${openApiTypeToPython(schema.items)}]`;
      case "object":
        if (!schema.properties) return "Dict[str, Any]";
        return "dict";
      default:
        return "Any";
    }
  })();

  return schema.nullable ? `Optional[${baseType}]` : baseType;
}
