/* -------------------------------------------------------------------------- */
/* NanoAgent – Book‑writing agent (chapter‑wise output, writes Markdown file) */
/* -------------------------------------------------------------------------- */

/** Quick usage – Bun / Node --------------------------------------------------

bun run bookAgent.ts "A gentle introduction to quantum computing for developers"

Creates `a-gentle-introduction-to-quantum-computing-for-developers.md` in the
current directory and prints each chapter to stdout as it is generated.
---------------------------------------------------------------------------- */

import {
  type AgentContext,
  type AgentState,
  ChatModel,
  Gemma3Small,
  MistralSmall,
  SystemMessage,
  ToolRegistry,
  UserMessage,
  content,
  loopAgent,
  toText,
  tool,
  typedSchema
} from "../src";

import { appendFile, writeFile } from "node:fs/promises";

/* -------------------------------------------------------------------------- */
/* Helper types                                                                */
/* -------------------------------------------------------------------------- */

interface ChapterOutline {
  title: string;
  summary: string;
}

interface Chapter {
  index: number;
  title: string;
  content: string;
}

export interface BookMemory {
  prompt: string;
  /** where to write incremental output */
  path?: string;
  title?: string;
  outline?: ChapterOutline[];
  chapters?: Chapter[];
}

/* -------------------------------------------------------------------------- */
/* create_outline tool                                                         */
/* -------------------------------------------------------------------------- */

const createOutline = tool(
  "create_outline",
  "Generate a chapter outline for a non‑fiction book.",
  typedSchema<{ topic: string; audience: string; chapters: number }>({
    type: "object",
    properties: {
      topic: { type: "string" },
      audience: { type: "string" },
      chapters: { type: "integer", minimum: 3, maximum: 30 }
    },
    required: ["topic", "audience", "chapters"]
  }),
  async ({ topic, audience, chapters }, memory) => {
    const model = new ChatModel(MistralSmall);
    const sys = SystemMessage(
      "You are an expert book architect. Output ONLY raw JSON array of {title,summary}. Never ask any question or request input."
    );
    const user = UserMessage(
      `Draft a ${chapters}-chapter outline for a book about "${topic}" aimed at ${audience}.`
    );
    const { messages } = await model.complete([sys, user]);
    const last = messages[messages.length - 1];
    let outline: ChapterOutline[] = [];
    try {
      outline = JSON.parse(toText(last.content) ?? "[]");
    } catch {
      /* keep outline empty – agent loop will retry or halt */
    }
    return content(outline, { memory: { ...memory, outline } });
  }
);

/* -------------------------------------------------------------------------- */
/* write_chapter tool                                                          */
/* -------------------------------------------------------------------------- */

const writeChapter = tool(
  "write_chapter",
  "Write the prose of a given chapter number (1-based).",
  // now accepts { chapter_number: number } (and will ignore any extra 'title' field)
  typedSchema<{ chapter_number: number; title?: string }>({
    type: "object",
    properties: {
      chapter_number: { type: "integer", minimum: 1 },
      title: { type: "string" }
    },
    required: ["chapter_number"]
  }),
  async ({ chapter_number }, memory) => {
    // convert to zero-based index
    const index = chapter_number - 1;
    if (!memory.outline?.[index]) return content([]);

    const { title, summary } = memory.outline[index];
    const model = new ChatModel(MistralSmall);
    const sys = SystemMessage(
      "You are a meticulous technical writer. Compose well-structured prose (~2500 words). Do NOT ask the reader any question and do NOT request feedback."
    );
    const user = UserMessage(
      `Write chapter ${chapter_number}: "${title}" – ${summary}.`
    );
    const { messages } = await model.complete([sys, user]);
    const prose = toText(messages[messages.length - 1].content) ?? "";

    const chapter: Chapter = { index, title, content: prose };
    // replace any existing chapter at this index
    const chapters = (memory.chapters ?? []).filter((c) => c.index !== index);
    chapters.push(chapter);

    // as soon as this chapter is done, append it to disk
    const snippet = `## Chapter ${chapter_number}. ${title}\n\n${prose.trim()}\n\n`;
    if (memory.path) {
      await appendFile(memory.path, snippet, "utf8");
    }
    return content(chapter, { memory: { ...memory, chapters } });
  }
);

/* -------------------------------------------------------------------------- */
/* Agent context & utilities                                                   */
/* -------------------------------------------------------------------------- */

const makeContext = (): AgentContext<BookMemory> => ({
  registry: new ToolRegistry({
    create_outline: createOutline,
    write_chapter: writeChapter
  }),
  isFinal: async ({ memory }) =>
    !!memory.outline &&
    !!memory.chapters &&
    memory.chapters.length === memory.outline.length,
  guidelines: async ({ chapters, outline }) =>
    `You are BookWriterGPT. Never ask the user for anything. Current progress: ${chapters?.length ?? 0}/${outline?.length ?? "?"} chapters.`
});

/* slugify helper */
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/* -------------------------------------------------------------------------- */
/* Public runner                                                               */
/* -------------------------------------------------------------------------- */

export async function runBookAgent(prompt: string, outPath?: string) {
  // decide output filename and clear it up front
  const tmpPath = outPath ?? `${slug(prompt)}.md`;
  await writeFile(tmpPath, "", "utf8");
  const memory: BookMemory = { prompt, path: tmpPath };
  const init: AgentState<BookMemory> = {
    model: new ChatModel(MistralSmall),
    messages: [
      SystemMessage(
        `You are BookWriterGPT. Never ask the user any question. First call "create_outline", then for each chapter call "write_chapter" with JSON {"chapter_number":<1-based>} – when you’ve written them all, reply DONE.`
      ),
      UserMessage(prompt)
    ],
    memory
  };

  const yesModel = new ChatModel(Gemma3Small);
  const final = await loopAgent(makeContext(), init, {
    yesModel,
    maxSteps: 200,
    debug: true
  });

  const { outline, chapters } = final.memory;
  if (!outline || !chapters)
    throw new Error("Book incomplete – agent halted early.");

  /* Assemble Markdown ------------------------------------------------------- */
  const header = `# ${(final.memory.title ?? prompt).trim()}\n\n## Table of contents\n${outline.map((o, i) => `${i + 1}. ${o.title}`).join("\n")}\n\n`;

  let body = "";
  const ordered: Chapter[] = [...chapters].sort((a, b) => a.index - b.index);
  for (const [i, ch] of ordered.entries()) {
    const section = `## Chapter ${i + 1}. ${ch.title}\n\n${ch.content.trim()}\n`;
    console.log(section); // stdout chapter‑by‑chapter
    body += `${section}\n`;
  }

  const md = header + body;
  const path = outPath ?? `${slug(final.memory.title ?? prompt)}.md`;
  await writeFile(path, md, "utf8");
  console.log(`Successfully wrote book to ${path}`);
}

/* -------------------------------------------------------------------------- */
/* CLI entry                                                                   */
/* -------------------------------------------------------------------------- */

if (import.meta.main) {
  const [prompt = "The history of cryptography for beginners", customPath] =
    process.argv.slice(2);
  await runBookAgent(prompt, customPath);
}
