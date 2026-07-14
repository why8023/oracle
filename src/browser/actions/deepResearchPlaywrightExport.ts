import { chromium, type Browser, type Download, type Page } from "playwright-core";
import type { BrowserLogger } from "../types.js";
import { isDeepResearchIncompleteText } from "../deepResearchResult.js";

const DEFAULT_CONNECT_TIMEOUT_MS = 8_000;
const DEFAULT_EXPORT_TIMEOUT_MS = 8_000;
const DEFAULT_EXPORT_READY_TIMEOUT_MS = 30_000;
const EXPORT_RETRY_INTERVAL_MS = 500;
const MAX_DOWNLOAD_EVENT_WAIT_MS = 3_000;
const MIN_EXPORT_IFRAME_WIDTH = 500;
const MIN_EXPORT_IFRAME_HEIGHT = 300;
const STABLE_IFRAME_BOX_DELTA_PX = 8;
const DEEP_RESEARCH_IFRAME_SELECTOR = 'iframe[title="internal://deep-research"]';

type DeepResearchIframeBox = { x: number; y: number; width: number; height: number };

export interface DeepResearchPlaywrightExportOptions {
  chromeHost?: string | null;
  chromePort?: number | null;
  conversationUrl?: string | null;
  connectTimeoutMs?: number;
  /** Maximum time to wait for each Markdown download event. */
  exportTimeoutMs?: number;
  /** Maximum time to wait for a stable, expanded Deep Research report before falling back. */
  exportReadyTimeoutMs?: number;
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
      {
        downloadTimeoutMs: options.exportTimeoutMs ?? DEFAULT_EXPORT_TIMEOUT_MS,
        readyTimeoutMs: options.exportReadyTimeoutMs ?? DEFAULT_EXPORT_READY_TIMEOUT_MS,
      },
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

  const hasTargetConversation = Boolean(conversationUrl?.trim());
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

  if (hasTargetConversation) {
    return null;
  }

  return pages.find((page) => isChatGptConversationPage(page.url())) ?? null;
}

async function exportDeepResearchMarkdownFromPage(
  page: Page,
  timing: { downloadTimeoutMs: number; readyTimeoutMs: number },
  logger?: BrowserLogger,
): Promise<string | null> {
  await page.waitForLoadState("domcontentloaded", { timeout: 2_000 }).catch(() => undefined);
  const deadline = Date.now() + Math.max(0, timing.readyTimeoutMs);
  let previousBoxes: DeepResearchIframeBox[] = [];
  let lastScanSummary = "";
  let readyExportRounds = 0;

  while (Date.now() < deadline) {
    await nudgeDeepResearchIframeIntoView(page).catch(() => undefined);
    const scan = await deepResearchIframeBoxes(page);
    const scanSummary = formatDeepResearchIframeScan(scan);
    if (logger?.verbose && scanSummary !== lastScanSummary) {
      logger(`Deep Research Playwright export readiness: ${scanSummary}`);
      lastScanSummary = scanSummary;
    }

    if (areDeepResearchIframeBoxesStable(previousBoxes, scan.boxes)) {
      readyExportRounds += 1;
      const markdown = await tryExportDeepResearchMarkdown(
        page,
        scan.boxes,
        deadline,
        timing.downloadTimeoutMs,
        logger,
      );
      if (markdown) {
        return markdown;
      }
    }

    previousBoxes = scan.boxes;
    const remainingMs = deadline - Date.now();
    if (remainingMs > 0) {
      await page.waitForTimeout(Math.min(EXPORT_RETRY_INTERVAL_MS, remainingMs));
    }
  }

  if (logger?.verbose) {
    logger(
      `Deep Research Playwright export skipped after ${readyExportRounds} stable iframe round(s): ${
        lastScanSummary || "iframe scan did not complete"
      }`,
    );
  }
  return null;
}

async function nudgeDeepResearchIframeIntoView(page: Page): Promise<void> {
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
}

async function deepResearchIframeBoxes(page: Page): Promise<{
  iframeCount: number;
  boxes: DeepResearchIframeBox[];
}> {
  const locator = page.locator(DEEP_RESEARCH_IFRAME_SELECTOR);
  const count = await locator.count().catch(() => 0);
  const boxes: DeepResearchIframeBox[] = [];
  for (let index = count - 1; index >= 0; index -= 1) {
    const iframe = locator.nth(index);
    await alignDeepResearchIframeForExport(iframe).catch(() => undefined);
    const box = await iframe.boundingBox().catch(() => null);
    if (box && isExportReadyIframeBox(box)) {
      boxes.push(box);
    }
  }
  return { iframeCount: count, boxes };
}

async function tryExportDeepResearchMarkdown(
  page: Page,
  boxes: readonly DeepResearchIframeBox[],
  deadline: number,
  downloadTimeoutMs: number,
  logger?: BrowserLogger,
): Promise<string | null> {
  for (const box of boxes) {
    for (const attempt of buildDeepResearchExportClickAttempts(box)) {
      await page.keyboard.press("Escape").catch(() => undefined);
      const preClickRemainingMs = deadline - Date.now();
      if (preClickRemainingMs <= 0) {
        return null;
      }
      await page.waitForTimeout(Math.min(150, preClickRemainingMs));

      let downloadPromise: Promise<Download | null> | undefined;
      try {
        await page.mouse.click(attempt.menuButton.x, attempt.menuButton.y);
        await page.waitForTimeout(Math.min(500, Math.max(0, deadline - Date.now())));
        const downloadWaitMs = Math.min(
          downloadTimeoutMs,
          MAX_DOWNLOAD_EVENT_WAIT_MS,
          Math.max(1, deadline - Date.now()),
        );
        downloadPromise = page
          .waitForEvent("download", { timeout: downloadWaitMs })
          .catch(() => null);
        await page.mouse.click(attempt.markdownItem.x, attempt.markdownItem.y);
      } catch {
        await downloadPromise;
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
  return null;
}

function isExportReadyIframeBox(box: DeepResearchIframeBox): boolean {
  return box.width >= MIN_EXPORT_IFRAME_WIDTH && box.height >= MIN_EXPORT_IFRAME_HEIGHT;
}

function areDeepResearchIframeBoxesStable(
  previous: readonly DeepResearchIframeBox[],
  current: readonly DeepResearchIframeBox[],
): boolean {
  return (
    current.length > 0 &&
    previous.length === current.length &&
    current.every((box, index) => {
      const prior = previous[index];
      return (
        prior &&
        Math.abs(prior.x - box.x) <= STABLE_IFRAME_BOX_DELTA_PX &&
        Math.abs(prior.y - box.y) <= STABLE_IFRAME_BOX_DELTA_PX &&
        Math.abs(prior.width - box.width) <= STABLE_IFRAME_BOX_DELTA_PX &&
        Math.abs(prior.height - box.height) <= STABLE_IFRAME_BOX_DELTA_PX
      );
    })
  );
}

function formatDeepResearchIframeScan(scan: {
  iframeCount: number;
  boxes: readonly DeepResearchIframeBox[];
}): string {
  const boxes = scan.boxes
    .map(
      (box) =>
        `${Math.round(box.x)},${Math.round(box.y)},${Math.round(box.width)}x${Math.round(box.height)}`,
    )
    .join(";");
  return `iframes=${scan.iframeCount}, readyBoxes=${boxes || "none"}`;
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
  areDeepResearchIframeBoxesStable,
  buildDeepResearchExportClickAttempts,
  exportDeepResearchMarkdownFromPage,
  extractChatGptConversationId,
  isChatGptConversationPage,
  isExportReadyIframeBox,
  isUsableExportedMarkdown,
  selectDeepResearchPage,
};
