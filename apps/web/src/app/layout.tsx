import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Bundled fonts remove Google Fonts requests from builds and local installs.
// `display: swap` means text is readable immediately
// and the variable handoff to Tailwind keeps `font-sans` / `font-display` /
// `font-mono` working (display maps onto the sans variable).
//
// Two faces, two jobs: a grotesque for everything you read, set heavier for
// display, and a technical mono for notation. Glass wants one clean voice;
// a second display face would compete with the surfaces for attention.

// Body and UI. Squarer and more industrial than Inter, which is what keeps a
// 13px label from looking like every other app's 13px label.
const archivo = localFont({
  src: "./fonts/archivo-latin.woff2",
  weight: "100 900",
  display: "swap",
  variable: "--font-sans",
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
  title: "ChessRabbit — Opening Repertoire Trainer",
  description:
    "Drill your openings on a spaced-repetition schedule, find the blunders in your own games, and scout what your next opponent actually plays.",
};

// One dark field, end to end: tell the browser so form controls and the
// mobile address bar match the page instead of flashing white.
export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#160E09",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`h-full ${archivo.variable} ${plexMono.variable}`}
    >
      <body className="min-h-full text-ink antialiased font-sans">{children}</body>
    </html>
  );
}
