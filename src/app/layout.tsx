import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Equity Radar",
  description: "US equity watchlist, automatic scoring, buy zones and moat discovery",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <div className="mx-auto max-w-[1400px] px-5 py-6">
            <header className="mb-6 flex items-center justify-between gap-4">
              <Link href="/" className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-xl border border-[var(--line)] bg-[var(--panel-2)] text-sm font-semibold text-[var(--accent)]">
                  ER
                </span>
                <span>
                  <span className="block text-[15px] font-semibold leading-none">Equity Radar</span>
                  <span className="text-[11px] text-[var(--muted)]">US equities · SEC-sourced</span>
                </span>
              </Link>
              <nav className="flex items-center gap-2 text-[12px] text-[var(--muted)]">
                <Link className="chip hover:text-[var(--text)]" href="/">
                  Watchlist
                </Link>
                <Link className="chip hover:text-[var(--text)]" href="/compare">
                  Compare
                </Link>
              </nav>
            </header>
            {children}
            <footer className="mt-10 border-t border-[var(--line)] pt-4 text-[11px] leading-relaxed text-[var(--muted)]">
              Research tooling, not investment advice. Fundamentals come from SEC XBRL filings;
              prices and consensus estimates come from third-party feeds and are marked as such.
              Nothing here places an order.
            </footer>
          </div>
        </Providers>
      </body>
    </html>
  );
}
