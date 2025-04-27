export type JSONSchemaType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "array"
  | "object";

export type JSONSchemaObject = {
  type: "object";
  properties: Record<string, JSONSchemaProperty>;
  required?: string[];
};

export type JSONSchemaArray = {
  type: "array";
  items: JSONSchemaProperty;
};

export type JSONSchemaPrimitive = {
  type: Exclude<JSONSchemaType, "object" | "array">;
  description?: string;
  enum?: string[]; // assuming enums are only used on strings
  default?: unknown;
  minimum?: number;
  maximum?: number;
};

export type JSONSchemaProperty =
  | JSONSchemaPrimitive
  | JSONSchemaObject
  | JSONSchemaArray;

/**
 * For a top-level schema describing type T.
 */
export type TypedSchema<T extends Record<string, unknown>> =
  JSONSchemaObject & {
    properties: Record<keyof T & string, JSONSchemaProperty>;
    __type?: T;
  };

export const typedSchema = <T extends Record<string, unknown>>(
  schema: JSONSchemaObject & {
    properties: Record<keyof T & string, JSONSchemaProperty>;
  }
): TypedSchema<T> => schema as TypedSchema<T>;

const isPlainObject = (val: unknown): val is Record<string, unknown> =>
  typeof val === "object" && val !== null && !Array.isArray(val);

const coerceType = (value: unknown, type: JSONSchemaType): unknown => {
  if (value === undefined || value === null) {
    return value;
  }
  switch (type) {
    case "string":
      return String(value);
    case "number":
      return typeof value === "string" ? Number(value) : value;
    case "integer":
      return typeof value === "string" ? Number.parseInt(value, 10) : value;
    case "boolean":
      if (value === "true") return true;
      if (value === "false") return false;
      return value;
    case "array":
    case "object":
      // We don't coerce these directly here, handled recursively below
      return value;
  }
};

const validateType = (value: unknown, schema: JSONSchemaProperty): boolean => {
  if (value === undefined || value === null) {
    return true; // allow undefined/null by default
  }
  switch (schema.type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && !Number.isNaN(value);
    case "integer":
      return Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "array": {
      if (!Array.isArray(value)) return false;
      const arrSchema = schema as JSONSchemaArray;
      return value.every((v) => validateType(v, arrSchema.items));
    }
    case "object": {
      if (!isPlainObject(value)) return false;
      const objSchema = schema as JSONSchemaObject;
      return Object.entries(objSchema.properties).every(([k, prop]) =>
        validateType(value[k], prop)
      );
    }
  }
};

const validateEnum = (value: unknown, schema: JSONSchemaProperty): boolean => {
  // Only primitives might have an enum (assuming string-based enum).
  if ("enum" in schema && schema.enum) {
    return schema.enum.includes(value as string);
  }
  return true;
};

const applyDefault = (value: unknown, schema: JSONSchemaProperty): unknown =>
  value === undefined && "default" in schema ? schema.default : value;

/**
 * applySchema recursively applies the schema to the provided arguments:
 * - Enforce required properties
 * - Apply defaults
 * - Coerce types
 * - Validate types and enum membership
 */
export const applySchema = <T extends Record<string, unknown>>(
  schema: TypedSchema<T>,
  args: Partial<T>
): T => {
  const result: Record<string, unknown> = {};

  for (const [key, propSchema] of Object.entries(schema.properties)) {
    const input = args[key];
    let value = applyDefault(input, propSchema);

    if (value === undefined && schema.required?.includes(key)) {
      throw new Error(`Missing required property '${key}'`);
    }

    // Recurse if the property schema is an object
    if (value !== undefined && propSchema.type === "object") {
      value = applySchema(
        propSchema as TypedSchema<Record<string, unknown>>,
        value as Record<string, unknown>
      );
    }

    // Recurse if the property schema is an array
    if (value !== undefined && propSchema.type === "array") {
      const arrSchema = propSchema as JSONSchemaArray;
      value = (value as unknown[]).map((item) => {
        if (arrSchema.items.type === "object") {
          return applySchema(
            arrSchema.items as TypedSchema<Record<string, unknown>>,
            item as Record<string, unknown>
          );
        }
        // If it's not an object, just return the item as is for now
        return item;
      });
    }

    // Coerce the value to the expected type
    value = coerceType(value, propSchema.type);

    // Validate the resulting value
    if (!validateType(value, propSchema)) {
      throw new Error(`Invalid type for property '${key}'`);
    }
    if (!validateEnum(value, propSchema)) {
      const enumValues = (propSchema as JSONSchemaPrimitive).enum;
      throw new Error(
        `Invalid value for property '${key}': must be one of ${JSON.stringify(enumValues)}`
      );
    }

    result[key] = value;
  }

  return result as T;
};
