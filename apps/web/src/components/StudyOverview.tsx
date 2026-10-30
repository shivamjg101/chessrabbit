"use client";

import { useMemo } from "react";
import { MODE_META } from "@/components/ChapterOptions";
import type { StudyChapter, StudyDetail } from "@/lib/api";
import { useBoardTheme } from "@/lib/boardTheme";
import { diagramSvg } from "@/lib/diagram";
import { mainlinePath, nodeAt } from "@/lib/moveTree";
import { parsePgn } from "@/lib/pgn";

/**
 * Every chapter at once, as a wall of small boards - Lichess's multiboard.
 *
 * A chapter is shown where its main line ends, which is the position it is
 * about. Lessons and hidden-move chapters are shown at their start instead:
 * the end of a lesson is its answer.
 */

function shownFen(c: StudyChapter): string {
  if (c.mode !== "normal") return c.starting_fen;
  const { tree } = parsePgn(c.pgn, c.starting_fen);
  const main = mainlinePath(tree);
  return (main[main.length - 1] ?? nodeAt(tree, tree.root)!).fen;
}

function Tile({ chapter, index, onOpen }: { chapter: StudyChapter; index: number; onOpen: () => void }) {
  const skin = useBoardTheme();
  const svg = useMemo(
    () =>
      diagramSvg(shownFen(chapter), {
        orientation: chapter.orientation,
        coordinates: false,
        size: 240,
        light: skin.theme.light,
        dark: skin.theme.dark,
      }).replace("<svg ", '<svg style="width:100%;height:auto;display:block" '),
    [chapter, skin.theme.light, skin.theme.dark]
  );
  const players =
    chapter.tags?.White && chapter.tags?.Black ? `${chapter.tags.White} – ${chapter.tags.Black}` : null;

  return (
    <button
      onClick={onOpen}
      className="card group overflow-hidden text-left transition-colors hover:border-brass/50"
    >
      {/* Generated from the chapter's own FEN, not from markup anybody wrote. */}
      <div className="bg-white" dangerouslySetInnerHTML={{ __html: svg }} />
      <div className="p-2">
        <p className="truncate text-xs font-medium">
          <span className="mr-1 font-mono text-[10px] text-muted">{index + 1}</span>
          {chapter.name}
        </p>
        <p className="truncate text-[10px] text-muted">
          {chapter.mode !== "normal" && (
            <span className="mr-1">
              {MODE_META[chapter.mode].icon} {MODE_META[chapter.mode].label} ·
            </span>
          )}
          {players ?? chapter.tags?.Event ?? ""}
        </p>
      </div>
    </button>
  );
}

export default function StudyOverview({
  study,
  onOpen,
}: {
  study: StudyDetail;
  onOpen: (chapter: StudyChapter) => void;
}) {
  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mx-auto max-w-6xl">
        <h2 className="font-display text-2xl">{study.name}</h2>
        <p className="mt-1 text-xs text-muted">
          by {study.owner_name} · {study.chapters.length} chapter{study.chapters.length === 1 ? "" : "s"}
          {study.likes > 0 && ` · ♥ ${study.likes}`}
        </p>
        {study.topics.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {study.topics.map((t) => (
              <span key={t} className="chip bg-ivory/10 text-muted">
                {t}
              </span>
            ))}
          </div>
        )}
        {study.description && (
          <p className="mt-3 max-w-3xl whitespace-pre-wrap text-sm leading-relaxed text-ink/85">
            {study.description}
          </p>
        )}
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {study.chapters.map((c, i) => (
            <Tile key={c.id} chapter={c} index={i} onOpen={() => onOpen(c)} />
          ))}
        </div>
      </div>
    </div>
  );
}
