import type { SessionArtifact } from "../sessionStore.js";
import type { DeepResearchCompletionResult } from "./actions/deepResearchResultExport.js";
import {
  appendArtifacts,
  saveBrowserTranscriptArtifact,
  saveDeepResearchReportArtifact,
  writeTextBrowserArtifact,
} from "./artifacts.js";
import type { BrowserLogger } from "./types.js";

export function shouldSaveDeepResearchAbArtifacts(): boolean {
  const value = process.env.ORACLE_DEEP_RESEARCH_AB_EXPORT?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

export async function saveDeepResearchRunArtifacts(params: {
  sessionId?: string;
  prompt: string;
  result: DeepResearchCompletionResult;
  conversationUrl?: string;
  logger: BrowserLogger;
}): Promise<SessionArtifact[] | undefined> {
  const reportArtifact = await saveOptionalDeepResearchArtifact(
    () =>
      saveDeepResearchReportArtifact({
        sessionId: params.sessionId,
        reportMarkdown: params.result.text,
        conversationUrl: params.conversationUrl,
        logger: params.logger,
      }),
    params.logger,
  );
  const comparisonArtifacts = await saveDeepResearchAbComparisonArtifacts({
    sessionId: params.sessionId,
    result: params.result,
    conversationUrl: params.conversationUrl,
    logger: params.logger,
  });
  const researchArtifacts = appendArtifacts(
    appendArtifacts(undefined, [reportArtifact]),
    comparisonArtifacts ?? [],
  );
  const transcriptArtifact = await saveOptionalDeepResearchArtifact(
    () =>
      saveBrowserTranscriptArtifact({
        sessionId: params.sessionId,
        prompt: params.prompt,
        answerMarkdown: params.result.text,
        conversationUrl: params.conversationUrl,
        artifacts: researchArtifacts,
        logger: params.logger,
      }),
    params.logger,
  );
  return appendArtifacts(researchArtifacts, [transcriptArtifact]);
}

export function hasSavedDeepResearchRunArtifacts(artifacts: SessionArtifact[] | undefined): boolean {
  return Boolean(
    artifacts?.some((artifact) => artifact.kind === "deep-research-report") &&
      artifacts?.some((artifact) => artifact.kind === "transcript"),
  );
}

async function saveDeepResearchAbComparisonArtifacts(params: {
  sessionId?: string;
  result: DeepResearchCompletionResult;
  conversationUrl?: string;
  logger: BrowserLogger;
}): Promise<SessionArtifact[] | undefined> {
  const comparison = params.result.comparison;
  if (!shouldSaveDeepResearchAbArtifacts() || !params.sessionId || !comparison) {
    return undefined;
  }

  const fallbackArtifact = comparison.fallbackText?.trim()
    ? await saveOptionalDeepResearchArtifact(
        () =>
          writeTextBrowserArtifact({
            sessionId: params.sessionId,
            kind: "file",
            filename: "deep-research-report.fallback-extracted.md",
            contents: comparison.fallbackText ?? "",
            label: "Deep Research fallback extraction",
            mimeType: "text/markdown",
            sourceUrl: params.conversationUrl,
            logger: params.logger,
          }),
        params.logger,
      )
    : null;
  const downloadArtifact = comparison.downloadedMarkdown?.trim()
    ? await saveOptionalDeepResearchArtifact(
        () =>
          writeTextBrowserArtifact({
            sessionId: params.sessionId,
            kind: "file",
            filename: "deep-research-report.download.md",
            contents: comparison.downloadedMarkdown ?? "",
            label: "Deep Research Markdown download",
            mimeType: "text/markdown",
            sourceUrl: params.conversationUrl,
            logger: params.logger,
          }),
        params.logger,
      )
    : null;
  const artifacts = appendArtifacts(undefined, [fallbackArtifact, downloadArtifact]);
  if (artifacts?.length) {
    params.logger(`[browser] Saved Deep Research A/B comparison artifacts`);
  }
  return artifacts;
}

async function saveOptionalDeepResearchArtifact<T>(
  operation: () => Promise<T | null>,
  logger: BrowserLogger,
): Promise<T | null> {
  try {
    return await operation();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger(`[browser] Failed to save session artifact: ${message}`);
    return null;
  }
}
