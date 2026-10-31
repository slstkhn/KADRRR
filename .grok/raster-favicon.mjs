import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const svg = readFileSync("/workspace/public/favicon.svg", "utf8");
const browser = await chromium.launch({ args: ["--no-sandbox"] });

async function shot(size, out) {
  const page = await browser.newPage({
    viewport: { width: size, height: size },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<!doctype html><html><head><style>
      html,body{margin:0;padding:0;width:${size}px;height:${size}px;background:#fff}
      svg{width:${size}px;height:${size}px;display:block}
    </style></head><body>${svg}</body></html>`,
    { waitUntil: "load" },
  );
  await page.screenshot({ path: out, omitBackground: false });
  await page.close();
}

await shot(16, "/workspace/.grok/favicon-16.png");
await shot(32, "/workspace/.grok/favicon-32.png");
await shot(64, "/workspace/.grok/favicon-64.png");
await browser.close();
console.log("rasterized 16/32/64");
