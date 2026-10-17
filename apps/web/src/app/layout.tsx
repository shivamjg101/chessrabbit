import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import DesktopAuthGate from "@/components/DesktopAuthGate";
import "./globals.css";

// Bundled fonts remove Google Fonts requests from builds and local installs.
// `display: swap` means text is readable immediately
// and the variable handoff to Tailwind keeps `font-sans` / `font-display` /
// `font-mono` working exactly as before.
//
// Three faces, three jobs. The pairing is the point: a high-contrast serif
// against a technical mono, with the grotesque staying out of the way.

// Body and UI. Squarer and more industrial than Inter, which is what keeps a
// 13px label from looking like every other app's 13px label.
const archivo = localFont({
  src: "./fonts/archivo-latin.woff2",
  weight: "100 900",
  display: "swap",
  variable: "--font-sans",
});

// Display. One weight on purpose — there is no bold to reach for, so it can
// only be used where a real display face belongs: page titles and big figures.
const instrumentSerif = localFont({
  src: "./fonts/instrument-serif-latin.woff2",
  weight: "400",
  adjustFontFallback: "Times New Roman",
  display: "swap",
  variable: "--font-display",
});

// Algebraic notation — Nf3, Bxc6, O-O — is mostly capitals and figures, and
// this is a mono whose capitals and figures are worth looking at. Notation is
// the app's third typeface, not its caption face.
const plexMono = localFont({
  src: [
    { path: "./fonts/ibm-plex-mono-400-latin.woff2", weight: "400" },
    { path: "./fonts/ibm-plex-mono-500-latin.woff2", weight: "500" },
    { path: "./fonts/ibm-plex-mono-600-latin.woff2", weight: "600" },
  ],
  display: "swap",
  variable: "--font-mono",
});

export const metadata: Metadata = {
  icons: { icon: "/chessrabbit-mark.svg" },
  title: "ChessRabbit — Opening Repertoire Trainer",
  description:
    "Drill your openings on a spaced-repetition schedule, find the blunders in your own games, and scout what your next opponent actually plays.",
};

// Match native controls and the mobile browser chrome to the oak canvas.
export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#EBD9BC",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`h-full ${archivo.variable} ${instrumentSerif.variable} ${plexMono.variable}`}
    >
      <body className="min-h-full text-ink antialiased font-sans"><DesktopAuthGate>{children}</DesktopAuthGate></body>
    </html>
  );
}
