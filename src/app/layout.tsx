import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { TopBar } from "@/components/top-bar";

export const metadata: Metadata = {
  title: "Equity Radar",
  description: "US equity watchlist, automatic scoring, buy zones and moat tracking",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <div className="mx-auto max-w-[1320px] px-5 py-6">
            <TopBar />
            {children}
            <footer className="mt-14 border-t border-[var(--line)] pt-4 text-[10px] leading-relaxed text-[var(--muted)]">
              Research tooling, not investment advice. Fundamentals come from SEC XBRL filings;
              prices come from third-party feeds. Nothing here places an order.
            </footer>
          </div>
        </Providers>
      </body>
    </html>
  );
}
