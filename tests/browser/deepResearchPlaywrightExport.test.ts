import { describe, expect, it } from "vitest";
import { deepResearchPlaywrightExportForTest } from "../../src/browser/actions/deepResearchPlaywrightExport.js";

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
});
