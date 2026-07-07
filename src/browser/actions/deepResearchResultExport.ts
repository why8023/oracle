import { isDeepResearchIncompleteText } from "../deepResearchResult.js";
import type { BrowserLogger } from "../types.js";
import {
  captureDeepResearchMarkdownWithPlaywright,
  type DeepResearchPlaywrightExportOptions,
} from "./deepResearchPlaywrightExport.js";

export interface DeepResearchResultExportOptions {
  playwrightExport?: DeepResearchPlaywrightExportOptions;
  captureCompletedMarkdownExport?: (
    options: DeepResearchPlaywrightExportOptions | undefined,
    logger: BrowserLogger,
  ) => Promise<string | null>;
  captureFallbackForComparison?: boolean;
}

export interface DeepResearchFallbackResult {
  text: string;
  html?: string;
  meta: { turnId?: string | null; messageId?: string | null };
}

export interface DeepResearchCompletionResult extends DeepResearchFallbackResult {
  comparison?: {
    selected: "download" | "fallback";
    fallbackText?: string;
    downloadedMarkdown?: string;
  };
}

export async function resolveDeepResearchResultFromCompletedRead(params: {
  fallback: DeepResearchFallbackResult;
  exportOptions?: DeepResearchResultExportOptions;
  logger: BrowserLogger;
}): Promise<DeepResearchCompletionResult> {
  const exportedMarkdown = await captureCompletedDeepResearchMarkdown(
    params.exportOptions,
    params.logger,
  );
  if (isUsableDeepResearchMarkdown(exportedMarkdown)) {
    params.logger("Deep Research report downloaded via Playwright Markdown export");
    return withComparison(
      {
        text: exportedMarkdown,
        html: params.fallback.html,
        meta: params.fallback.meta,
      },
      "download",
      params.fallback.text,
      exportedMarkdown,
    );
  }

  return withComparison(
    params.fallback,
    "fallback",
    params.fallback.text,
    exportedMarkdown ?? undefined,
  );
}

export async function resolveDeepResearchResultFromFinishedState(params: {
  exportOptions?: DeepResearchResultExportOptions;
  extractFallback: () => Promise<DeepResearchFallbackResult>;
  logger: BrowserLogger;
}): Promise<DeepResearchCompletionResult | null> {
  const exportedMarkdown = await captureCompletedDeepResearchMarkdown(
    params.exportOptions,
    params.logger,
  );
  const exportedMarkdownUsable = isUsableDeepResearchMarkdown(exportedMarkdown);
  let fallbackResult: DeepResearchFallbackResult | null = null;

  if (!exportedMarkdownUsable || params.exportOptions?.captureFallbackForComparison) {
    fallbackResult = await params.extractFallback().catch(() => null);
  }

  if (exportedMarkdownUsable && exportedMarkdown) {
    params.logger("Deep Research report downloaded via Playwright Markdown export");
    return withComparison(
      {
        text: exportedMarkdown,
        html: fallbackResult?.html,
        meta: fallbackResult?.meta ?? { turnId: null, messageId: null },
      },
      "download",
      fallbackResult?.text,
      exportedMarkdown,
    );
  }

  if (fallbackResult) {
    return withComparison(
      fallbackResult,
      "fallback",
      fallbackResult.text,
      exportedMarkdown ?? undefined,
    );
  }

  return null;
}

function captureCompletedDeepResearchMarkdown(
  options: DeepResearchResultExportOptions | undefined,
  logger: BrowserLogger,
): Promise<string | null> {
  const capture =
    options?.captureCompletedMarkdownExport ?? captureDeepResearchMarkdownWithPlaywright;
  return capture(options?.playwrightExport, logger);
}

function isUsableDeepResearchMarkdown(value: string | null | undefined): value is string {
  return Boolean(value) && !isDeepResearchIncompleteText(value ?? "");
}

function withComparison(
  result: DeepResearchFallbackResult,
  selected: "download" | "fallback",
  fallbackText: string | undefined,
  downloadedMarkdown: string | undefined,
): DeepResearchCompletionResult {
  return {
    ...result,
    comparison: {
      selected,
      fallbackText,
      downloadedMarkdown,
    },
  };
}
