import Image from "next/image";

const DONATE_URL = "https://buymeacoffee.com/shivamjg101";

export default function DonateSection() {
  return (
    <section id="donate" aria-labelledby="donate-heading" className="pb-16">
      <div className="card-brass grid items-center gap-8 p-6 sm:p-10 md:grid-cols-[minmax(0,1fr)_260px] md:gap-12">
        <div>
          <p className="eyebrow mb-3">Community supported</p>
          <h2 id="donate-heading" className="font-display text-3xl leading-tight text-ink sm:text-4xl">
            Help keep ChessRabbit free.
          </h2>
          <p className="mt-4 max-w-lg text-sm leading-relaxed text-muted">
            If ChessRabbit helps your chess, you can support its development
            with a coffee. Your contribution helps us keep building free,
            open-source tools for analysis and training.
          </p>
          <a
            href={DONATE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary mt-6 inline-flex items-center gap-2 px-5 py-3"
          >
            Buy me a coffee
            <span aria-hidden>↗</span>
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
          <p className="mt-3 break-all text-xs text-muted">buymeacoffee.com/shivamjg101</p>
          <p className="mt-5 max-w-lg text-xs leading-relaxed text-muted">
            Donations are optional. Every feature stays free, whether you donate or not.
          </p>
        </div>

        <figure className="mx-auto w-full max-w-64">
          {/* The code stays on solid white: a scanner needs the contrast, and
              glass behind it would only cost reads. */}
          <a
            href={DONATE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-2xl bg-white p-4 shadow-card ring-1 ring-white/40"
          >
            <Image
              src="/images/buy-me-a-coffee-qr.png"
              width={3000}
              height={3000}
              alt="QR code for donating to shivamjg101 on Buy Me a Coffee (opens in a new tab)"
              className="h-auto w-full"
            />
          </a>
          <figcaption className="mt-3 text-center text-xs text-muted">
            Scan to donate with Buy Me a Coffee.
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
