import { stringify } from "./json";

export type TextContent = { type: "text"; text: string };
export type JsonContent = { type: "json"; data: unknown };
export type ImageContent = {
  type: "image";
  data: string; // base64
  mimeType?: string;
};
// cf. https://platform.openai.com/docs/guides/images-vision?api-mode=chat
export type ImageURLContent = {
  type: "image_url";
  image_url: { url: string };
};

export const contentTypes = ["text", "json", "image", "image_url"];

/**
 * Structured content representation.
 */
export type Content =
  | TextContent
  | JsonContent
  | ImageContent
  | ImageURLContent;

/* -------------------------------------------------------------------------- */
/* Content helpers                                                             */
/* -------------------------------------------------------------------------- */

/** Type‑guard that checks whether a Content is plain text. */
export const isTextContent = (c: Content | null): c is TextContent =>
  !!c && c.type === "text";

/** Convenience helper: does the text content include a substring? */
export const textIncludes = (
  c: Content | null,
  substr: string,
  options?: { caseInsensitive?: boolean }
): boolean =>
  isTextContent(c) &&
  (options?.caseInsensitive ? c.text.toLowerCase() : c.text).includes(
    options?.caseInsensitive ? substr.toLowerCase() : substr
  );

/** Convenience helper to create a text content object. */
export const text = (s: string): TextContent => ({ type: "text", text: s });

/** Checks if any value is a Content. */
export const isContent = (v: unknown): v is Content =>
  typeof v === "object" &&
  v !== null &&
  "type" in v &&
  // typeof v.type === "string" &&
  // contentTypes.includes(v.type) &&
  ((v.type === "text" && "text" in v && typeof v.text === "string") ||
    (v.type === "json" && "data" in v) ||
    (v.type === "image" && "data" in v && typeof v.data === "string") ||
    (v.type === "image_url" &&
      "image_url" in v &&
      typeof v.image_url === "object" &&
      v.image_url !== null &&
      "url" in v.image_url &&
      typeof v.image_url.url === "string"));

/**
 * Exports any value to a Content.
 * If the value is already a Content, returns the original value (without even shallow copying).
 */
export const toContent = <Out>(v: Out): Content =>
  typeof v === "string"
    ? text(v)
    : isContent(v)
      ? v
      : { type: "json", data: v };

// @todo extend
export const toText = (
  content: Content | null | undefined
): string | undefined =>
  content === null || content === undefined
    ? undefined
    : content.type === "text"
      ? content.text
      : content.type === "json"
        ? stringify(content.data)
        : undefined;
