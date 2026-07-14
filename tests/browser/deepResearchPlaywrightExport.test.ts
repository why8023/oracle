import { describe, expect, it, vi } from "vitest";
import { deepResearchPlaywrightExportForTest } from "../../src/browser/actions/deepResearchPlaywrightExport.js";

const EXPORTED_MARKDOWN =
  "# Exported report\n\n## Summary\n\nThis is the official Markdown download.";

function createDownload(markdown = EXPORTED_MARKDOWN) {
  return {
    failure: vi.fn().mockResolvedValue(null),
    createReadStream: vi.fn().mockResolvedValue(
      (async function* () {
        yield Buffer.from(markdown);
      })(),
    ),
  };
}

function createExportPage(params: {
  boxes: Array<{ x: number; y: number; width: number; height: number } | null>;
  downloads: Array<ReturnType<typeof createDownload> | null>;
}) {
  const events: string[] = [];
  let boxIndex = 0;
  const fallbackBox = params.boxes.at(-1) ?? null;
  const iframe = {
    evaluate: vi.fn().mockResolvedValue(undefined),
    boundingBox: vi.fn(async () => {
      events.push("box");
      const box = params.boxes[boxIndex] ?? fallbackBox;
      boxIndex += 1;
      return box;
    }),
  };
  const locator = {
    count: vi.fn().mockResolvedValue(1),
    nth: vi.fn().mockReturnValue(iframe),
  };
  const page = {
    waitForLoadState: vi.fn().mockResolvedValue(undefined),
    locator: vi.fn().mockReturnValue(locator),
    evaluate: vi.fn().mockResolvedValue(undefined),
    waitForTimeout: vi.fn(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, 1);
        }),
    ),
    keyboard: { press: vi.fn().mockResolvedValue(undefined) },
    mouse: {
      click: vi.fn(async () => {
        events.push("click");
      }),
    },
    waitForEvent: vi.fn(async () => params.downloads.shift() ?? null),
  };
  return { events, iframe, page };
}

describe("Deep Research Playwright export helpers", () => {
  it("selects the ChatGPT page matching the conversation id", () => {
    const pages = [
      { url: () => "https://chatgpt.com/c/old-conversation" },
      {
        url: () =>
          "https://chatgpt.com/g/g-p-example-oracle/c/6a4768e4-ea14-83ee-905c-ad831f295930",
      },
    ];

    expect(
      deepResearchPlaywrightExportForTest.selectDeepResearchPage(
        pages,
        "https://chatgpt.com/g/g-p-example-oracle/c/6a4768e4-ea14-83ee-905c-ad831f295930",
      ),
    ).toBe(pages[1]);
  });

  it("falls back to any ChatGPT conversation page when no target URL is supplied", () => {
    const pages = [{ url: () => "about:blank" }, { url: () => "https://chatgpt.com/c/current" }];

    expect(deepResearchPlaywrightExportForTest.selectDeepResearchPage(pages)).toBe(pages[1]);
  });

  it("does not fall back to a different conversation when a target URL is supplied", () => {
    const pages = [
      { url: () => "about:blank" },
      { url: () => "https://chatgpt.com/g/g-p-example-oracle/c/old-conversation" },
    ];

    expect(
      deepResearchPlaywrightExportForTest.selectDeepResearchPage(
        pages,
        "https://chatgpt.com/g/g-p-example-oracle/c/new-conversation",
      ),
    ).toBeNull();
  });

  it("targets the export button before the expand button on compact embedded reports", () => {
    const attempts = deepResearchPlaywrightExportForTest.buildDeepResearchExportClickAttempts({
      x: 510,
      y: 296,
      width: 1100,
      height: 530,
    });

    expect(attempts).toContainEqual({
      menuButton: { x: 1522, y: 338 },
      markdownItem: { x: 1453, y: 432 },
    });
  });

  it("targets the export button on restored narrow report cards", () => {
    const attempts = deepResearchPlaywrightExportForTest.buildDeepResearchExportClickAttempts({
      x: 280,
      y: 52,
      width: 768,
      height: 484,
    });

    expect(attempts[0]?.menuButton).toEqual({ x: 988, y: 112 });
    expect(attempts[0]?.markdownItem).toEqual({ x: 891, y: 188 });
  });

  it("accepts exported Markdown and rejects transient status text", () => {
    expect(
      deepResearchPlaywrightExportForTest.isUsableExportedMarkdown(
        "# Deep Research report\n\n## Summary\n\n```mermaid\nflowchart LR\n```",
      ),
    ).toBe(true);
    expect(deepResearchPlaywrightExportForTest.isUsableExportedMarkdown("researching")).toBe(false);
  });

  it("waits for a stable full-size iframe before clicking export", async () => {
    const { events, iframe, page } = createExportPage({
      boxes: [
        { x: 280, y: 52, width: 768, height: 160 },
        { x: 280, y: 52, width: 768, height: 484 },
        { x: 280, y: 52, width: 768, height: 484 },
      ],
      downloads: [createDownload()],
    });

    const markdown = await deepResearchPlaywrightExportForTest.exportDeepResearchMarkdownFromPage(
      page as never,
      { downloadTimeoutMs: 20, readyTimeoutMs: 500 },
    );

    expect(markdown).toBe(EXPORTED_MARKDOWN);
    expect(iframe.boundingBox).toHaveBeenCalledTimes(3);
    expect(events.slice(0, events.indexOf("click"))).toEqual(["box", "box", "box"]);
  });

  it("rechecks a stable iframe after every failed click round", async () => {
    const { page } = createExportPage({
      boxes: [
        { x: 280, y: 52, width: 768, height: 484 },
        { x: 280, y: 52, width: 768, height: 484 },
        { x: 280, y: 52, width: 768, height: 484 },
      ],
      downloads: [null, null, null, createDownload()],
    });

    const markdown = await deepResearchPlaywrightExportForTest.exportDeepResearchMarkdownFromPage(
      page as never,
      { downloadTimeoutMs: 20, readyTimeoutMs: 500 },
    );

    expect(markdown).toBe(EXPORTED_MARKDOWN);
    expect(page.waitForEvent).toHaveBeenCalledTimes(4);
  });
});
