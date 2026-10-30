import { BRUSH_COLOR, Shape } from "@/lib/shapes";

/**
 * A position as a picture: a diagram for a worksheet, a blog post or a club
 * newsletter - what ChessBase calls copying a diagram, and Lichess a board
 * screenshot.
 *
 * Built as a standalone SVG string rather than captured from the screen, so it
 * comes out the same size and colours whatever the window looks like, carries
 * the drawn arrows and circles, and needs no canvas-capture permission. The
 * pieces are the Unicode chess figurines - the glyphs every diagram font is
 * built on - drawn solid and outlined so both colours read on both squares.
 */

const FIGURINE: Record<string, string> = {
  k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟",
};

/** U+FE0E asks for the text glyph, not an emoji, where a font offers both. */
const TEXT_STYLE = "︎";

export interface DiagramOptions {
  orientation?: "white" | "black";
  shapes?: Shape[];
  /** Highlight the move that led here. */
  lastMove?: { from: string; to: string } | null;
  light?: string;
  dark?: string;
  /** Edge length of the board itself, in px. Coordinates add a margin. */
  size?: number;
  coordinates?: boolean;
  caption?: string;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function diagramSvg(fen: string, opts: DiagramOptions = {}): string {
  const {
    orientation = "white",
    shapes = [],
    lastMove = null,
    light = "#DCD9CC",
    dark = "#4A737E",
    size = 480,
    coordinates = true,
    caption,
  } = opts;
  const sq = size / 8;
  const margin = coordinates ? Math.round(sq * 0.4) : 0;
  const captionH = caption ? Math.round(sq * 0.55) : 0;
  // Room on the right for the side-to-move marker, clear of the h-file.
  const pad = Math.round(sq * 0.32);
  const width = size + margin + pad;
  const height = size + margin + captionH;

  /** Top-left of a square in board pixels, from the viewer's side. */
  const at = (square: string) => {
    const file = square.charCodeAt(0) - 97;
    const rank = Number(square[1]) - 1;
    const col = orientation === "white" ? file : 7 - file;
    const row = orientation === "white" ? 7 - rank : rank;
    return { x: margin + col * sq, y: row * sq };
  };

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" fill="#ffffff"/>`
  );

  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const square = `${"abcdefgh"[f]}${r + 1}`;
      const { x, y } = at(square);
      const isLight = (f + r) % 2 === 1;
      parts.push(`<rect x="${x}" y="${y}" width="${sq}" height="${sq}" fill="${isLight ? light : dark}"/>`);
      if (lastMove && (square === lastMove.from || square === lastMove.to)) {
        parts.push(`<rect x="${x}" y="${y}" width="${sq}" height="${sq}" fill="#E0C14C" fill-opacity="0.45"/>`);
      }
    }
  }

  // Circles under the pieces, arrows over them - the way a board draws them.
  for (const s of shapes.filter((x) => !x.to)) {
    const { x, y } = at(s.from);
    parts.push(
      `<circle cx="${x + sq / 2}" cy="${y + sq / 2}" r="${sq * 0.44}" fill="none" stroke="${BRUSH_COLOR[s.brush]}" stroke-width="${sq * 0.08}" stroke-opacity="0.85"/>`
    );
  }

  const placement = fen.split(" ")[0] ?? "";
  placement.split("/").forEach((row, r) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) {
        f += Number(ch);
        continue;
      }
      const square = `${"abcdefgh"[f]}${8 - r}`;
      const { x, y } = at(square);
      const white = ch === ch.toUpperCase();
      parts.push(
        `<text x="${x + sq / 2}" y="${y + sq * 0.8}" text-anchor="middle" font-size="${sq * 0.82}"` +
          ` font-family="'Segoe UI Symbol','DejaVu Sans','Noto Sans Symbols 2','Arial Unicode MS',serif"` +
          ` fill="${white ? "#FFFFFF" : "#1A1A1A"}" stroke="${white ? "#1A1A1A" : "#1A1A1A"}"` +
          ` stroke-width="${white ? sq * 0.03 : sq * 0.01}">${FIGURINE[ch.toLowerCase()] ?? ""}${TEXT_STYLE}</text>`
      );
      f++;
    }
  });

  for (const s of shapes.filter((x) => x.to)) {
    const a = at(s.from);
    const b = at(s.to!);
    const x1 = a.x + sq / 2;
    const y1 = a.y + sq / 2;
    const x2 = b.x + sq / 2;
    const y2 = b.y + sq / 2;
    const len = Math.hypot(x2 - x1, y2 - y1);
    const ux = (x2 - x1) / len;
    const uy = (y2 - y1) / len;
    const head = sq * 0.38;
    const tipX = x2 - ux * sq * 0.12;
    const tipY = y2 - uy * sq * 0.12;
    const baseX = tipX - ux * head;
    const baseY = tipY - uy * head;
    const color = BRUSH_COLOR[s.brush];
    parts.push(
      `<line x1="${x1 + ux * sq * 0.25}" y1="${y1 + uy * sq * 0.25}" x2="${baseX}" y2="${baseY}" stroke="${color}" stroke-width="${sq * 0.14}" stroke-opacity="0.85" stroke-linecap="round"/>`,
      `<polygon points="${tipX},${tipY} ${baseX - uy * head * 0.62},${baseY + ux * head * 0.62} ${baseX + uy * head * 0.62},${baseY - ux * head * 0.62}" fill="${color}" fill-opacity="0.85"/>`
    );
  }

  if (coordinates) {
    const font = `font-family="Arial,Helvetica,sans-serif" font-size="${margin * 0.6}" fill="#555"`;
    for (let i = 0; i < 8; i++) {
      const file = orientation === "white" ? "abcdefgh"[i] : "hgfedcba"[i];
      const rank = orientation === "white" ? 8 - i : i + 1;
      parts.push(
        `<text x="${margin + i * sq + sq / 2}" y="${size + margin * 0.75}" text-anchor="middle" ${font}>${file}</text>`,
        `<text x="${margin / 2}" y="${i * sq + sq / 2 + margin * 0.2}" text-anchor="middle" ${font}>${rank}</text>`
      );
    }
  }

  parts.push(
    `<rect x="${margin}" y="0" width="${size}" height="${size}" fill="none" stroke="#333" stroke-width="1"/>`
  );

  // Whose move it is, the way a printed diagram marks it.
  const turn = fen.split(" ")[1] === "b" ? "b" : "w";
  const markY = orientation === (turn === "w" ? "white" : "black") ? size - sq * 0.18 : sq * 0.18;
  parts.push(
    `<circle cx="${margin + size + pad / 2}" cy="${markY}" r="${sq * 0.09}" fill="${turn === "w" ? "#FFFFFF" : "#1A1A1A"}" stroke="#1A1A1A" stroke-width="1"/>`
  );

  if (caption) {
    parts.push(
      `<text x="${margin + size / 2}" y="${size + margin + captionH * 0.75}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="${captionH * 0.6}" fill="#222">${escapeXml(caption)}</text>`
    );
  }

  parts.push("</svg>");
  return parts.join("");
}

/** Save an SVG string as .svg, or rasterise it to .png at twice its size. */
export async function saveDiagram(svg: string, filename: string, format: "svg" | "png"): Promise<void> {
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);

  const save = (href: string, name: string) => {
    const a = document.createElement("a");
    a.href = href;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  if (format === "svg") {
    save(url, `${filename}.svg`);
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return;
  }

  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("The diagram could not be drawn"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.width * 2;
    canvas.height = img.height * 2;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No canvas");
    ctx.scale(2, 2);
    ctx.drawImage(img, 0, 0);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!png) throw new Error("The diagram could not be encoded");
    const pngUrl = URL.createObjectURL(png);
    save(pngUrl, `${filename}.png`);
    setTimeout(() => URL.revokeObjectURL(pngUrl), 0);
  } finally {
    URL.revokeObjectURL(url);
  }
}
