import Link from "next/link";

/**
 * The product mark: a knight set in a small tile of brass-tinted glass, then
 * the name. The tile runs brass to copper, the same metal as the inlay around
 * the board, so the mark reads as part of the same set.
 */
export default function Wordmark({
  href = "/app",
  className = "",
}: {
  href?: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex shrink-0 items-center gap-2 rounded-xl ${className}`}
    >
      <span
        aria-hidden
        className="grid h-7 w-7 place-items-center rounded-[9px] border border-white/25
                   bg-gradient-to-br from-brassLit/60 via-brass/45 to-copper/55
                   text-[15px] leading-none text-[#FFF6E6] shadow-edge"
      >
        ♞
      </span>
      <span className="font-display text-[17px] leading-none text-ink">ChessRabbit</span>
    </Link>
  );
}
