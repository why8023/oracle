import { chromium, type Browser, type Download, type Page } from "playwright-core";
import type { BrowserLogger } from "../types.js";
import { isDeepResearchIncompleteText } from "../deepResearchResult.js";

const DEFAULT_CONNECT_TIMEOUT_MS = 8_000;
const DEFAULT_EXPORT_TIMEOUT_MS = 8_000;
const DEEP_RESEARCH_IFRAME_SELECTOR = 'iframe[title="internal://deep-research"]';

export interface DeepResearchPlaywrightExportOptions {
  chromeHost?: string | null;
  chromePort?: number | null;
  conversationUrl?: string | null;
  connectTimeoutMs?: number;
  exportTimeoutMs?: number;
}

export async function captureDeepResearchMarkdownWithPlaywright(
  options: DeepResearchPlaywrightExportOptions | undefined,
  logger?: BrowserLogger,
): Promise<string | null> {
  if (!options?.chromePort) {
    return null;
  }

  let browser: Browser | undefined;
  try {
    const host = options.chromeHost || "127.0.0.1";
    browser = await chromium.connectOverCDP(`http://${host}:${options.chromePort}`, {
      timeout: options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
      isLocal: isLocalChromeHost(host),
    });
    const page = await findDeepResearchPage(browser, options.conversationUrl ?? undefined);
    if (!page) {
      if (logger?.verbose) {
        logger("Deep Research Playwright export skipped: matching ChatGPT page not found");
      }
      return null;
    }
    const markdown = await exportDeepResearchMarkdownFromPage(
      page,
      options.exportTimeoutMs ?? DEFAULT_EXPORT_TIMEOUT_MS,
      logger,
    );
    return markdown;
  } catch (error) {
    if (logger?.verbose) {
      const message = error instanceof Error ? error.message : String(error);
      logger(`Deep Research Playwright export unavailable: ${message}`);
    }
    return null;
  } finally {
    await browser?.close({ reason: "oracle deep research export bridge done" }).catch(() => {});
  }
}

async function findDeepResearchPage(
  browser: Browser,
  conversationUrl?: string,
): Promise<Page | null> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const pages = browser.contexts().flatMap((context) => context.pages());
    const page = selectDeepResearchPage(pages, conversationUrl);
    if (page) {
      return page;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

function selectDeepResearchPage<T extends { url(): string }>(
  pages: readonly T[],
  conversationUrl?: string,
): T | null {
  if (pages.length === 0) {
    return null;
  }

  const targetConversationId = extractChatGptConversationId(conversationUrl ?? "");
  if (targetConversationId) {
    const exact = pages.find((page) => page.url().includes(`/c/${targetConversationId}`));
    if (exact) {
      return exact;
    }
  }

  const normalizedTarget = normalizeUrlForComparison(conversationUrl ?? "");
  if (normalizedTarget) {
    const exact = pages.find((page) => normalizeUrlForComparison(page.url()) === normalizedTarget);
    if (exact) {
      return exact;
    }
  }

  return pages.find((page) => isChatGptConversationPage(page.url())) ?? null;
}

async function exportDeepResearchMarkdownFromPage(
  page: Page,
  timeoutMs: number,
  logger?: BrowserLogger,
): Promise<string | null> {
  await page.waitForLoadState("domcontentloaded", { timeout: 2_000 }).catch(() => undefined);
  await revealDeepResearchIframe(page).catch(() => undefined);

  const boxes = await deepResearchIframeBoxes(page, logger);
  if (boxes.length === 0) {
    if (logger?.verbose) {
      logger("Deep Research Playwright export skipped: iframe box not found");
    }
    return null;
  }

  for (const box of boxes) {
    for (const attempt of buildDeepResearchExportClickAttempts(box)) {
      await page.keyboard.press("Escape").catch(() => undefined);
      await page.waitForTimeout(150);
      const downloadPromise = page.waitForEvent("download", { timeout: timeoutMs }).catch(() => null);

      try {
        await page.mouse.click(attempt.menuButton.x, attempt.menuButton.y);
        await page.waitForTimeout(500);
        await page.mouse.click(attempt.markdownItem.x, attempt.markdownItem.y);
      } catch {
        continue;
      }

      const download = await downloadPromise;
      if (!download) {
        continue;
      }

      const markdown = await readPlaywrightDownloadText(download).catch((error: unknown) => {
        if (logger?.verbose) {
          const message = error instanceof Error ? error.message : String(error);
          logger(`Deep Research Playwright export download unreadable: ${message}`);
        }
        return "";
      });
      if (isUsableExportedMarkdown(markdown)) {
        return markdown.trim();
      }
    }
  }

  if (logger?.verbose) {
    logger("Deep Research Playwright export skipped: no Markdown download completed");
  }
  return null;
}

async function revealDeepResearchIframe(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const visible = await page
      .locator(DEEP_RESEARCH_IFRAME_SELECTOR)
      .first()
      .isVisible({ timeout: 250 })
      .catch(() => false);
    if (visible) {
      const iframe = page.locator(DEEP_RESEARCH_IFRAME_SELECTOR).last();
      await alignDeepResearchIframeForExport(iframe).catch(() => {});
      const box = await iframe.boundingBox().catch(() => null);
      if (box && box.width >= 250 && box.height >= 150) {
        return;
      }
    }

    await page.evaluate(() => {
      const scrollers = Array.from(document.querySelectorAll("div,main")).filter((element) => {
        const style = getComputedStyle(element);
        return (
          (style.overflowY === "auto" || style.overflowY === "scroll") &&
          element.scrollHeight > element.clientHeight + 10
        );
      });
      for (const scroller of scrollers) {
        scroller.scrollTop = scroller.scrollHeight;
      }
      window.scrollTo(0, document.body.scrollHeight);
    });
    await page.waitForTimeout(300);
  }
}

async function deepResearchIframeBoxes(
  page: Page,
  logger?: BrowserLogger,
): Promise<Array<{ x: number; y: number; width: number; height: number }>> {
  const locator = page.locator(DEEP_RESEARCH_IFRAME_SELECTOR);
  const count = await locator.count().catch(() => 0);
  const boxes: Array<{ x: number; y: number; width: number; height: number }> = [];
  for (let index = count - 1; index >= 0; index -= 1) {
    const iframe = locator.nth(index);
    await alignDeepResearchIframeForExport(iframe).catch(() => undefined);
    await page.waitForTimeout(150);
    const box = await iframe.boundingBox().catch(() => null);
    if (box && box.width >= 250 && box.height >= 150) {
      boxes.push(box);
    }
  }
  if (logger?.verbose) {
    logger(
      `Deep Research Playwright export iframe scan: count=${count}, boxes=${boxes
        .map((box) => `${Math.round(box.x)},${Math.round(box.y)},${Math.round(box.width)}x${Math.round(box.height)}`)
        .join(";")}`,
    );
  }
  return boxes;
}

async function alignDeepResearchIframeForExport(
  iframe: ReturnType<Page["locator"]>,
): Promise<void> {
  await iframe.evaluate((element) => {
    element.scrollIntoView({ block: "start", inline: "nearest" });
  });
}

async function readPlaywrightDownloadText(download: Download): Promise<string> {
  const failure = await download.failure();
  if (failure) {
    throw new Error(`Deep Research export download failed: ${failure}`);
  }

  const stream = await download.createReadStream();
  if (!stream) {
    throw new Error("Deep Research export download did not expose a readable stream.");
  }

  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function isUsableExportedMarkdown(text: string): boolean {
  const value = text.trim();
  return (
    value.length >= 30 &&
    !isDeepResearchIncompleteText(value) &&
    !/var e=Object\.create|Object\.defineProperty\(.*Symbol\.for/s.test(value)
  );
}

function isChatGptConversationPage(url: string): boolean {
  try {
    const parsed = new URL(url);
    return /(^|\.)chatgpt\.com$/i.test(parsed.hostname) && /\/c\/[^/?#]+/.test(parsed.pathname);
  } catch {
    return false;
  }
}

function extractChatGptConversationId(url: string): string | null {
  try {
    return new URL(url).pathname.match(/\/c\/([^/?#]+)/)?.[1] ?? null;
  } catch {
    return url.match(/\/c\/([^/?#]+)/)?.[1] ?? null;
  }
}

function normalizeUrlForComparison(url: string): string | null {
  if (!url) {
    return null;
  }
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function isLocalChromeHost(host: string): boolean {
  return /^(127\.0\.0\.1|localhost|\[::1\]|::1)$/i.test(host);
}

export function buildDeepResearchExportClickAttempts(box: {
  x: number;
  y: number;
  width: number;
  height: number;
}): Array<{
  menuButton: { x: number; y: number };
  markdownItem: { x: number; y: number };
}> {
  if (box.height >= 700) {
    return [
      {
        menuButton: { x: box.x + box.width - 68, y: box.y + 24 },
        markdownItem: { x: box.x + box.width - 164, y: box.y + 103 },
      },
      {
        menuButton: { x: box.x + box.width - 447, y: box.y + 24 },
        markdownItem: { x: box.x + box.width - 534, y: box.y + 103 },
      },
    ];
  }

  return [
    {
      menuButton: { x: box.x + box.width - 60, y: box.y + 60 },
      markdownItem: { x: box.x + box.width - 157, y: box.y + 136 },
    },
    {
      menuButton: { x: box.x + box.width - 88, y: box.y + 42 },
      markdownItem: { x: box.x + box.width - 157, y: box.y + 136 },
    },
    {
      menuButton: { x: box.x + box.width - 55, y: box.y + 42 },
      markdownItem: { x: box.x + box.width - 157, y: box.y + 136 },
    },
  ];
}

export const deepResearchPlaywrightExportForTest = {
  buildDeepResearchExportClickAttempts,
  extractChatGptConversationId,
  isChatGptConversationPage,
  isUsableExportedMarkdown,
  selectDeepResearchPage,
};
