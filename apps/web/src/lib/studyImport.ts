import { StudyChapter } from "@/lib/api";
import { START_FEN } from "@/lib/moveTree";

export type ImportedChapter = Pick<
  StudyChapter,
  "name" | "pgn" | "starting_fen" | "orientation"
>;

const TAG = /^\s*\[([A-Za-z][A-Za-z0-9_]*)\s+"((?:\\.|[^"\\])*)"\]\s*$/;
const MAX_CHAPTER_PGN = 400_000;

/** Split a multi-game PGN export into study chapters without rewriting its moves. */
export function parseStudyImport(source: string): ImportedChapter[] {
  const chapters: ImportedChapter[] = [];
  let headers: Record<string, string> = {};
  let lines: string[] = [];
  let hasBody = false;
  let inComment = false;

  function finish() {
    const pgn = lines.join("\n").trim();
    if (!pgn && Object.keys(headers).length === 0) return;
    if (pgn.length > MAX_CHAPTER_PGN) {
      throw new Error("A chapter exceeds the 400,000 character PGN limit.");
    }
    const variant = headers.Variant?.toLowerCase();
    if (variant && !["standard", "from position"].includes(variant)) {
      throw new Error(`The ${headers.Variant} variant cannot be opened in a study.`);
    }
    const event = headers.Event?.trim() ?? "";
    const separator = event.lastIndexOf(": ");
    const title = headers.ChapterName?.trim() ||
      (separator >= 0 ? event.slice(separator + 2) : event);
    const players = [headers.White, headers.Black].filter(
      (name) => name && name !== "?"
    );
    chapters.push({
      name: (title || players.join(" vs ") || `Chapter ${chapters.length + 1}`).slice(0, 120),
      pgn,
      starting_fen: headers.FEN || START_FEN,
      orientation: headers.Orientation?.toLowerCase() === "black" ? "black" : "white",
    });
    headers = {};
    lines = [];
    hasBody = false;
  }

  for (const line of source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n")) {
    const tag = !inComment ? TAG.exec(line) : null;
    if (tag) {
      if (hasBody) finish();
      headers[tag[1]] = tag[2].replace(/\\(["\\])/g, "$1");
      continue;
    }
    lines.push(line);
    if (line.trim()) hasBody = true;
    // A tag-shaped line inside a multi-line PGN comment is movetext.
    for (const char of line) {
      if (char === ";" && !inComment) break;
      if (char === "{") inComment = true;
      if (char === "}") inComment = false;
    }
  }
  finish();
  if (chapters.length === 0) throw new Error("Paste a PGN or choose a .pgn file.");
  if (chapters.length > 64) throw new Error("Import at most 64 chapters at once.");
  return chapters;
}
