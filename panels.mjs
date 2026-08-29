import { chromium } from 'playwright-core';
const b = await chromium.launch();
const p = await b.newPage();
for (const t of ["BTC","ETH","NVDA"]) {
  await p.goto(`http://localhost:3000/c/${t}`, { waitUntil: 'networkidle', timeout: 45000 });
  await p.waitForTimeout(2000);
  const titles = await p.evaluate(() => [...document.querySelectorAll('h2')].map(h => h.textContent.trim()));
  console.log(`${t}: ${titles.join(' | ')}`);
}
await b.close();
