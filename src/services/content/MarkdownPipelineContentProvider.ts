/*
 * Notebook Navigator - Plugin for Obsidian
 * Copyright (c) 2025 Johan Sanneblad
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { Platform, type CachedMetadata, type FrontMatterCache, type TFile } from 'obsidian';
import { LIMITS } from '../../constants/limits';
import { type ContentProviderType } from '../../interfaces/IContentProvider';
import { NotebookNavigatorSettings } from '../../settings';
import { type CustomPropertyItem, FileData } from '../../storage/IndexedDBStorage';
import { getDBInstance } from '../../storage/fileOperations';
import { getCachedCommaSeparatedList } from '../../utils/commaSeparatedListUtils';
import { areStringArraysEqual } from '../../utils/arrayUtils';
import { areCustomPropertyItemsEqual, hasCustomPropertyFrontmatterFields } from '../../utils/customPropertyUtils';
import { PreviewTextUtils } from '../../utils/previewTextUtils';
import { createCaseInsensitiveKeyMatcher } from '../../utils/recordUtils';
import { countWordsForCustomProperty } from '../../utils/wordCountUtils';
import type { ContentProviderProcessResult } from './BaseContentProvider';
import { findFeatureImageReference, type FeatureImageReference } from './featureImageReferenceResolver';
import { FeatureImageContentProvider } from './FeatureImageContentProvider';

type MarkdownPipelineContext = {
    file: TFile;
    fileData: FileData | null;
    settings: NotebookNavigatorSettings;
    content: string;
    frontmatter: FrontMatterCache | null;
    bodyStartIndex: number;
    isExcalidraw: boolean;
    fileModified: boolean;
    customPropertyEnabled: boolean;
    customPropertyNameFields: readonly string[];
    hasContent: boolean;
    featureImageReference: FeatureImageReference | null;
    featureImageExcluded: boolean;
};

type MarkdownPipelineUpdate = {
    wordCount?: number | null;
    taskTotal?: number | null;
    taskIncomplete?: number | null;
    preview?: string;
    customProperty?: FileData['customProperty'];
    featureImageKey?: string | null;
    featureImage?: Blob | null;
};

type MarkdownPipelineProcessorId = 'preview' | 'wordCount' | 'tasks' | 'customProperty' | 'featureImage';

type MarkdownPipelineProcessor = {
    id: MarkdownPipelineProcessorId;
    needsProcessing: (context: MarkdownPipelineContext) => boolean;
    run: (context: MarkdownPipelineContext) => Promise<MarkdownPipelineUpdate | null>;
};

function resolveMarkdownBodyStartIndex(metadata: CachedMetadata, content: string): number {
    const rawOffset = metadata.frontmatterPosition?.end?.offset;
    if (typeof rawOffset !== 'number' || rawOffset <= 0) {
        return 0;
    }

    let index = Math.min(Math.max(0, rawOffset), content.length);

    while (index < content.length) {
        const char = content[index];
        if (char !== '\n' && char !== '\r') {
            break;
        }
        index += 1;
    }

    return index;
}

const REGEX_MARKDOWN_TASK_ITEM = /^(?:\s*>\s*)*\s*(?:[-*]|[1-9]\d*\.)\s+\[([ xX])\]/u;
const REGEX_FENCE_OPEN_LINE = /^(\s*)((?:>\s*)*)\s*([`~]{3,}).*$/u;
const REGEX_FENCE_CLOSE_LINE = /^(\s*)((?:>\s*)*)\s*([`~]{3,})\s*$/u;

function countBlockquoteDepth(prefix: string): number {
    if (!prefix.includes('>')) {
        return 0;
    }

    let depth = 0;
    for (let index = 0; index < prefix.length; index += 1) {
        if (prefix[index] === '>') {
            depth += 1;
        }
    }

    return depth;
}

function countMarkdownTasks(content: string, bodyStartIndex: number): { taskTotal: number; taskIncomplete: number } {
    const safeBodyStartIndex = Math.min(Math.max(0, bodyStartIndex), content.length);
    const body = safeBodyStartIndex === 0 ? content : content.slice(safeBodyStartIndex);

    if (body.length === 0) {
        return { taskTotal: 0, taskIncomplete: 0 };
    }

    let taskTotal = 0;
    let taskIncomplete = 0;
    let lineStart = 0;
    let inFence = false;
    let fenceChar = '';
    let fenceLength = 0;
    let fenceDepth = 0;

    while (lineStart < body.length) {
        const nextLineEnd = body.indexOf('\n', lineStart);
        const lineEnd = nextLineEnd === -1 ? body.length : nextLineEnd;
        let line = body.slice(lineStart, lineEnd);
        if (line.endsWith('\r')) {
            line = line.slice(0, -1);
        }

        if (inFence) {
            const closeMatch = line.match(REGEX_FENCE_CLOSE_LINE);
            if (closeMatch && closeMatch[3]) {
                const currentDepth = countBlockquoteDepth(closeMatch[2] ?? '');
                const matchChar = closeMatch[3][0] ?? '';
                if (currentDepth === fenceDepth && matchChar === fenceChar && closeMatch[3].length >= fenceLength) {
                    inFence = false;
                    fenceChar = '';
                    fenceLength = 0;
                    fenceDepth = 0;
                }
            }
        } else {
            const openMatch = line.match(REGEX_FENCE_OPEN_LINE);
            if (openMatch && openMatch[3]) {
                inFence = true;
                fenceChar = openMatch[3][0] ?? '';
                fenceLength = openMatch[3].length;
                fenceDepth = countBlockquoteDepth(openMatch[2] ?? '');
            } else {
                const match = line.match(REGEX_MARKDOWN_TASK_ITEM);
                if (match) {
                    taskTotal += 1;
                    if (match[1] === ' ') {
                        taskIncomplete += 1;
                    }
                }
            }
        }

        if (nextLineEnd === -1) {
            break;
        }

        lineStart = lineEnd + 1;
    }

    return { taskTotal, taskIncomplete };
}

// Converts frontmatter values into a list of pill strings.
// Supports scalars and nested arrays; skips empty strings and non-finite numbers.
function extractFrontmatterValues(value: unknown): string[] {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed.length > 0 ? [trimmed] : [];
    }

    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            return [];
        }
        return [value.toString()];
    }

    if (typeof value === 'boolean') {
        return [value ? 'true' : 'false'];
    }

    if (Array.isArray(value)) {
        const parts: string[] = [];
        for (const entry of value) {
            parts.push(...extractFrontmatterValues(entry));
        }
        return parts;
    }

    return [];
}

// Builds the custom property pill list from frontmatter.
// - `nameFields` produce the pill values (all matching fields are included)
function resolveCustomPropertyItemsFromFrontmatter(
    frontmatter: FrontMatterCache | null,
    nameFields: readonly string[]
): CustomPropertyItem[] {
    if (!frontmatter) {
        return [];
    }

    // Custom property items are persisted without styling metadata.
    // Rendering derives per-property colors from settings using the `fieldKey`.
    const entries: CustomPropertyItem[] = [];

    for (let fieldIndex = 0; fieldIndex < nameFields.length; fieldIndex += 1) {
        const field = nameFields[fieldIndex];
        const values = extractFrontmatterValues(frontmatter[field]);
        if (values.length === 0) {
            continue;
        }

        for (let valueIndex = 0; valueIndex < values.length; valueIndex += 1) {
            const value = values[valueIndex];
            entries.push({ fieldKey: field, value });
        }
    }

    return entries;
}

export class MarkdownPipelineContentProvider extends FeatureImageContentProvider {
    protected readonly PARALLEL_LIMIT: number = LIMITS.contentProvider.parallelLimit;
    private readonly readFailureAttemptsByPath = new Map<string, number>();

    private readonly processors: MarkdownPipelineProcessor[] = [
        {
            id: 'preview',
            needsProcessing: context => {
                return (
                    context.settings.showFilePreview &&
                    (!context.fileData || context.fileModified || context.fileData.previewStatus === 'unprocessed') &&
                    (context.hasContent || context.isExcalidraw)
                );
            },
            run: async context => await this.processPreview(context)
        },
        {
            id: 'wordCount',
            needsProcessing: context => {
                if (!context.fileData || context.fileModified || context.fileData.wordCount === null) {
                    return context.isExcalidraw || context.hasContent;
                }

                return false;
            },
            run: async context => await this.processWordCount(context)
        },
        {
            id: 'tasks',
            needsProcessing: context => {
                if (
                    !context.fileData ||
                    context.fileModified ||
                    context.fileData.taskTotal === null ||
                    context.fileData.taskIncomplete === null
                ) {
                    return context.isExcalidraw || context.hasContent;
                }

                return false;
            },
            run: async context => await this.processTasks(context)
        },
        {
            id: 'customProperty',
            needsProcessing: context => {
                if (!context.customPropertyEnabled) {
                    return false;
                }
                return !context.fileData || context.fileModified || context.fileData.customProperty === null;
            },
            run: async context => await this.processCustomProperty(context)
        },
        {
            id: 'featureImage',
            needsProcessing: context => {
                if (!context.settings.showFeatureImage) {
                    return false;
                }

                if (!context.isExcalidraw && !context.featureImageReference && !context.hasContent && !context.featureImageExcluded) {
                    return false;
                }

                return (
                    !context.fileData ||
                    context.fileModified ||
                    context.fileData.featureImageKey === null ||
                    context.fileData.featureImageStatus === 'unprocessed'
                );
            },
            run: async context => await this.processFeatureImage(context)
        }
    ];

    getContentType(): ContentProviderType {
        return 'markdownPipeline';
    }

    getRelevantSettings(): (keyof NotebookNavigatorSettings)[] {
        return [
            'showFilePreview',
            'skipHeadingsInPreview',
            'skipCodeBlocksInPreview',
            'stripHtmlInPreview',
            'previewProperties',
            'showFeatureImage',
            'featureImageProperties',
            'featureImageExcludeProperties',
            'downloadExternalFeatureImages',
            'customPropertyFields'
        ];
    }

    private recordReadFailure(path: string): { attempts: number; shouldFallback: boolean } {
        const previous = this.readFailureAttemptsByPath.get(path) ?? 0;
        const attempts = previous + 1;
        this.readFailureAttemptsByPath.set(path, attempts);
        return { attempts, shouldFallback: attempts >= LIMITS.contentProvider.retry.maxAttempts };
    }

    private clearReadFailures(path: string): void {
        this.readFailureAttemptsByPath.delete(path);
    }

    private getClearFlags(context: { oldSettings: NotebookNavigatorSettings; newSettings: NotebookNavigatorSettings } | undefined): {
        shouldClearPreview: boolean;
        shouldClearCustomProperty: boolean;
        shouldClearFeatureImage: boolean;
    } {
        if (!context) {
            return {
                shouldClearPreview: true,
                shouldClearCustomProperty: true,
                shouldClearFeatureImage: true
            };
        }

        const { oldSettings, newSettings } = context;

        const shouldClearPreview =
            oldSettings.showFilePreview !== newSettings.showFilePreview ||
            oldSettings.skipHeadingsInPreview !== newSettings.skipHeadingsInPreview ||
            oldSettings.skipCodeBlocksInPreview !== newSettings.skipCodeBlocksInPreview ||
            oldSettings.stripHtmlInPreview !== newSettings.stripHtmlInPreview ||
            !areStringArraysEqual(oldSettings.previewProperties, newSettings.previewProperties);

        const shouldClearCustomProperty = oldSettings.customPropertyFields !== newSettings.customPropertyFields;

        const featureImagePropertiesChanged = !areStringArraysEqual(oldSettings.featureImageProperties, newSettings.featureImageProperties);
        const featureImageExcludePropertiesChanged = !areStringArraysEqual(
            oldSettings.featureImageExcludeProperties,
            newSettings.featureImageExcludeProperties
        );

        const shouldClearFeatureImage =
            featureImageExcludePropertiesChanged ||
            (oldSettings.showFeatureImage && !newSettings.showFeatureImage) ||
            (newSettings.showFeatureImage &&
                (featureImagePropertiesChanged || oldSettings.downloadExternalFeatureImages !== newSettings.downloadExternalFeatureImages));

        return { shouldClearPreview, shouldClearCustomProperty, shouldClearFeatureImage };
    }

    shouldRegenerate(oldSettings: NotebookNavigatorSettings, newSettings: NotebookNavigatorSettings): boolean {
        const { shouldClearPreview, shouldClearCustomProperty, shouldClearFeatureImage } = this.getClearFlags({ oldSettings, newSettings });
        return shouldClearPreview || shouldClearCustomProperty || shouldClearFeatureImage;
    }

    async clearContent(context?: { oldSettings: NotebookNavigatorSettings; newSettings: NotebookNavigatorSettings }): Promise<void> {
        const { shouldClearPreview, shouldClearCustomProperty, shouldClearFeatureImage } = this.getClearFlags(context);

        if (!shouldClearPreview && !shouldClearCustomProperty && !shouldClearFeatureImage) {
            return;
        }

        const db = getDBInstance();

        if (shouldClearPreview) {
            await db.batchClearAllFileContent('preview');
        }

        if (shouldClearCustomProperty) {
            await db.batchClearAllFileContent('customProperty');
        }

        if (shouldClearFeatureImage) {
            await db.batchClearFeatureImageContent('markdown');
        }
    }

    protected needsProcessing(fileData: FileData | null, file: TFile, settings: NotebookNavigatorSettings): boolean {
        if (file.extension !== 'md') {
            return false;
        }

        const customPropertyEnabled = hasCustomPropertyFrontmatterFields(settings);

        const needsRefresh = fileData !== null && fileData.markdownPipelineMtime !== file.stat.mtime;
        if (!fileData || needsRefresh) {
            return true;
        }

        const needsPreview = settings.showFilePreview && fileData.previewStatus === 'unprocessed';
        const needsFeatureImage =
            settings.showFeatureImage && (fileData.featureImageKey === null || fileData.featureImageStatus === 'unprocessed');
        const needsCustomProperty = customPropertyEnabled && fileData.customProperty === null;
        const needsWordCount = fileData.wordCount === null;
        const needsTasks = fileData.taskTotal === null || fileData.taskIncomplete === null;

        return needsPreview || needsFeatureImage || needsCustomProperty || needsWordCount || needsTasks;
    }

    protected async processFile(
        job: { file: TFile; path: string },
        fileData: FileData | null,
        settings: NotebookNavigatorSettings
    ): Promise<ContentProviderProcessResult> {
        if (job.file.extension !== 'md') {
            return { update: null, processed: true };
        }

        const customPropertyNameFields = getCachedCommaSeparatedList(settings.customPropertyFields);
        const customPropertyEnabled = customPropertyNameFields.length > 0;

        const cachedMetadata = this.app.metadataCache.getFileCache(job.file);
        if (!cachedMetadata) {
            return { update: null, processed: false };
        }

        const frontmatter = cachedMetadata.frontmatter ?? null;
        const isExcalidraw = PreviewTextUtils.isExcalidrawFile(job.file.name, frontmatter ?? undefined);

        const fileModified = fileData !== null && fileData.markdownPipelineMtime !== job.file.stat.mtime;
        const featureImageExcludeMatcher = createCaseInsensitiveKeyMatcher(settings.featureImageExcludeProperties);
        const featureImageExcluded = settings.showFeatureImage && frontmatter !== null && featureImageExcludeMatcher.matches(frontmatter);

        const needsPreview =
            settings.showFilePreview && (!fileData || fileModified || fileData.previewStatus === 'unprocessed') && !isExcalidraw;
        const needsWordCount = !fileData || fileModified || fileData.wordCount === null;
        const needsWordCountContent = needsWordCount && !isExcalidraw;
        const needsTasks = !fileData || fileModified || fileData.taskTotal === null || fileData.taskIncomplete === null;
        const needsTasksContent = needsTasks && !isExcalidraw;
        const needsFeatureImage =
            settings.showFeatureImage &&
            (!fileData || fileModified || fileData.featureImageKey === null || fileData.featureImageStatus === 'unprocessed') &&
            !isExcalidraw;

        const frontmatterFeatureImageReference =
            needsFeatureImage && frontmatter && !featureImageExcluded
                ? findFeatureImageReference({
                      app: this.app,
                      file: job.file,
                      content: '',
                      settings,
                      frontmatter,
                      bodyStartIndex: 0
                  })
                : null;

        const needsContent =
            needsPreview ||
            needsWordCountContent ||
            needsTasksContent ||
            (needsFeatureImage && !featureImageExcluded && !frontmatterFeatureImageReference);

        const update: {
            path: string;
            wordCount?: number | null;
            taskTotal?: number | null;
            taskIncomplete?: number | null;
            preview?: string;
            featureImage?: Blob | null;
            featureImageKey?: string | null;
            customProperty?: FileData['customProperty'];
        } = { path: job.path };

        if (needsContent) {
            const maxMarkdownReadBytes = Platform.isMobile ? LIMITS.markdown.maxReadBytes.mobile : LIMITS.markdown.maxReadBytes.desktop;
            if (job.file.stat.size > maxMarkdownReadBytes) {
                // Avoid reading full markdown content for large files; only apply updates derived from cached metadata/frontmatter.
                let hasSafeUpdate = false;

                if (needsWordCountContent && (!fileData || fileData.wordCount !== 0)) {
                    update.wordCount = 0;
                    hasSafeUpdate = true;
                }

                if (needsTasksContent && (!fileData || fileData.taskTotal !== 0 || fileData.taskIncomplete !== 0)) {
                    update.taskTotal = 0;
                    update.taskIncomplete = 0;
                    hasSafeUpdate = true;
                }

                if (customPropertyEnabled) {
                    const nextCustomProperty = resolveCustomPropertyItemsFromFrontmatter(frontmatter, customPropertyNameFields);
                    if (
                        !fileData ||
                        fileData.customProperty === null ||
                        !areCustomPropertyItemsEqual(fileData.customProperty, nextCustomProperty)
                    ) {
                        update.customProperty = nextCustomProperty;
                        hasSafeUpdate = true;
                    }
                }

                if (needsPreview) {
                    const shouldClearPreview = !fileData || fileData.previewStatus !== 'none';
                    if (shouldClearPreview) {
                        update.preview = '';
                        hasSafeUpdate = true;
                    }
                }

                if (needsFeatureImage && (frontmatterFeatureImageReference || featureImageExcluded)) {
                    const featureImageUpdate = await this.processMarkdownFeatureImage({
                        file: job.file,
                        fileData,
                        settings,
                        content: '',
                        frontmatter,
                        bodyStartIndex: 0,
                        isExcalidraw,
                        featureImageReference: frontmatterFeatureImageReference,
                        featureImageExcluded
                    });

                    if (featureImageUpdate) {
                        update.featureImageKey = featureImageUpdate.featureImageKey;
                        update.featureImage = featureImageUpdate.featureImage;
                        hasSafeUpdate = true;
                    }
                } else if (needsFeatureImage && !frontmatterFeatureImageReference) {
                    const shouldMarkMissingFeatureImage =
                        !fileData || fileData.featureImageKey === null || fileData.featureImageStatus === 'unprocessed';
                    if (shouldMarkMissingFeatureImage) {
                        update.featureImageKey = fileData?.featureImageKey ?? '';
                        update.featureImage = this.createEmptyBlob();
                        hasSafeUpdate = true;
                    }
                }

                if (hasSafeUpdate) {
                    return { update, processed: true };
                }

                return { update: null, processed: true };
            }
        }

        let content: string;
        let hasContent = false;
        let bodyStartIndex = 0;
        try {
            if (needsContent) {
                content = await this.readFileContent(job.file);
                hasContent = true;
                bodyStartIndex = resolveMarkdownBodyStartIndex(cachedMetadata, content);
                this.clearReadFailures(job.path);
            } else {
                content = '';
            }
        } catch (error) {
            console.error(`Error reading markdown content for ${job.path}:`, error);
            const { shouldFallback } = this.recordReadFailure(job.path);
            let hasSafeUpdate = false;

            // Ensure word count can converge even if content reads fail repeatedly.
            if (needsWordCountContent) {
                const shouldSetWordCountZero = !fileData || fileData.wordCount === null || (shouldFallback && fileData.wordCount !== 0);
                if (shouldSetWordCountZero) {
                    update.wordCount = 0;
                    hasSafeUpdate = true;
                }
            }

            if (needsTasksContent) {
                const shouldSetTasksZero =
                    !fileData ||
                    fileData.taskTotal === null ||
                    fileData.taskIncomplete === null ||
                    (shouldFallback && (fileData.taskTotal !== 0 || fileData.taskIncomplete !== 0));
                if (shouldSetTasksZero) {
                    update.taskTotal = 0;
                    update.taskIncomplete = 0;
                    hasSafeUpdate = true;
                }
            }

            if (customPropertyEnabled) {
                const nextCustomProperty = resolveCustomPropertyItemsFromFrontmatter(frontmatter, customPropertyNameFields);
                if (
                    !fileData ||
                    fileData.customProperty === null ||
                    !areCustomPropertyItemsEqual(fileData.customProperty, nextCustomProperty)
                ) {
                    update.customProperty = nextCustomProperty;
                    hasSafeUpdate = true;
                }
            }

            if (needsPreview && shouldFallback) {
                const shouldClearPreview = !fileData || fileData.previewStatus !== 'none';
                if (shouldClearPreview) {
                    update.preview = '';
                    hasSafeUpdate = true;
                }
            }

            if (needsFeatureImage && frontmatterFeatureImageReference) {
                const featureImageUpdate = await this.processMarkdownFeatureImage({
                    file: job.file,
                    fileData,
                    settings,
                    content: '',
                    frontmatter,
                    bodyStartIndex: 0,
                    isExcalidraw,
                    featureImageReference: frontmatterFeatureImageReference,
                    featureImageExcluded
                });

                if (featureImageUpdate) {
                    update.featureImageKey = featureImageUpdate.featureImageKey;
                    update.featureImage = featureImageUpdate.featureImage;
                    hasSafeUpdate = true;
                }
            } else if (needsFeatureImage && featureImageExcluded) {
                const featureImageUpdate = await this.processMarkdownFeatureImage({
                    file: job.file,
                    fileData,
                    settings,
                    content: '',
                    frontmatter,
                    bodyStartIndex: 0,
                    isExcalidraw,
                    featureImageReference: null,
                    featureImageExcluded
                });

                if (featureImageUpdate) {
                    update.featureImageKey = featureImageUpdate.featureImageKey;
                    update.featureImage = featureImageUpdate.featureImage;
                    hasSafeUpdate = true;
                }
            } else if (needsFeatureImage && !frontmatterFeatureImageReference && shouldFallback) {
                const shouldMarkMissingFeatureImage =
                    !fileData || fileData.featureImageKey === null || fileData.featureImageStatus === 'unprocessed';
                if (shouldMarkMissingFeatureImage) {
                    update.featureImageKey = fileData?.featureImageKey ?? '';
                    update.featureImage = this.createEmptyBlob();
                    hasSafeUpdate = true;
                }
            }

            if (hasSafeUpdate) {
                // After repeated read failures, fall back to safe defaults and mark as processed to avoid endless retries.
                return { update, processed: shouldFallback };
            }

            return { update: null, processed: shouldFallback };
        }

        const context: MarkdownPipelineContext = {
            file: job.file,
            fileData,
            settings,
            content,
            frontmatter,
            bodyStartIndex,
            isExcalidraw,
            fileModified,
            customPropertyEnabled,
            customPropertyNameFields,
            hasContent,
            featureImageReference: frontmatterFeatureImageReference,
            featureImageExcluded
        };

        for (const processor of this.processors) {
            if (!processor.needsProcessing(context)) {
                continue;
            }

            const processorUpdate = await processor.run(context);
            if (!processorUpdate) {
                continue;
            }

            if (processorUpdate.wordCount !== undefined) {
                update.wordCount = processorUpdate.wordCount;
            }
            if (processorUpdate.taskTotal !== undefined) {
                update.taskTotal = processorUpdate.taskTotal;
            }
            if (processorUpdate.taskIncomplete !== undefined) {
                update.taskIncomplete = processorUpdate.taskIncomplete;
            }
            if (processorUpdate.preview !== undefined) {
                update.preview = processorUpdate.preview;
            }
            if (processorUpdate.customProperty !== undefined) {
                update.customProperty = processorUpdate.customProperty;
            }
            if (processorUpdate.featureImageKey !== undefined) {
                update.featureImageKey = processorUpdate.featureImageKey;
            }
            if (processorUpdate.featureImage !== undefined) {
                update.featureImage = processorUpdate.featureImage;
            }
        }

        const hasContentUpdate =
            update.wordCount !== undefined ||
            update.taskTotal !== undefined ||
            update.taskIncomplete !== undefined ||
            update.preview !== undefined ||
            update.customProperty !== undefined ||
            update.featureImageKey !== undefined;

        if (hasContentUpdate) {
            return { update, processed: true };
        }

        return { update: null, processed: true };
    }

    private async processPreview(context: MarkdownPipelineContext): Promise<MarkdownPipelineUpdate | null> {
        try {
            const previewText = context.isExcalidraw
                ? ''
                : PreviewTextUtils.extractPreviewText(context.content, context.settings, context.frontmatter ?? undefined);

            if (!context.fileData) {
                return { preview: previewText };
            }

            if (previewText.length === 0 && context.fileData.previewStatus === 'none') {
                return null;
            }

            if (context.fileData.previewStatus === 'has') {
                const db = getDBInstance();
                const cachedPreview = db.getCachedPreviewText(context.file.path);
                if (cachedPreview.length > 0 && cachedPreview === previewText) {
                    return null;
                }
            }

            return { preview: previewText };
        } catch (error) {
            console.error(`Error generating preview for ${context.file.path}:`, error);
            if (!context.fileData || context.fileData.previewStatus === 'unprocessed') {
                return { preview: '' };
            }
            return null;
        }
    }

    private async processWordCount(context: MarkdownPipelineContext): Promise<MarkdownPipelineUpdate | null> {
        try {
            const count = context.isExcalidraw ? 0 : countWordsForCustomProperty(context.content, context.bodyStartIndex);
            if (!context.fileData || context.fileData.wordCount === null || context.fileData.wordCount !== count) {
                return { wordCount: count };
            }
            return null;
        } catch (error) {
            console.error(`Error generating word count for ${context.file.path}:`, error);
            if (!context.fileData || context.fileData.wordCount === null) {
                return { wordCount: 0 };
            }
            return null;
        }
    }

    private async processTasks(context: MarkdownPipelineContext): Promise<MarkdownPipelineUpdate | null> {
        try {
            const counts = context.isExcalidraw
                ? { taskTotal: 0, taskIncomplete: 0 }
                : countMarkdownTasks(context.content, context.bodyStartIndex);

            if (
                !context.fileData ||
                context.fileData.taskTotal === null ||
                context.fileData.taskIncomplete === null ||
                context.fileData.taskTotal !== counts.taskTotal ||
                context.fileData.taskIncomplete !== counts.taskIncomplete
            ) {
                return {
                    taskTotal: counts.taskTotal,
                    taskIncomplete: counts.taskIncomplete
                };
            }

            return null;
        } catch (error) {
            console.error(`Error generating tasks for ${context.file.path}:`, error);
            if (!context.fileData || context.fileData.taskTotal === null || context.fileData.taskIncomplete === null) {
                return { taskTotal: 0, taskIncomplete: 0 };
            }
            return null;
        }
    }

    private async processCustomProperty(context: MarkdownPipelineContext): Promise<MarkdownPipelineUpdate | null> {
        try {
            const nextValue = resolveCustomPropertyItemsFromFrontmatter(context.frontmatter, context.customPropertyNameFields);

            if (
                !context.fileData ||
                context.fileData.customProperty === null ||
                !areCustomPropertyItemsEqual(context.fileData.customProperty, nextValue)
            ) {
                return { customProperty: nextValue };
            }

            return null;
        } catch (error) {
            console.error(`Error generating custom property for ${context.file.path}:`, error);
            if (!context.fileData || context.fileData.customProperty === null) {
                return { customProperty: [] };
            }
            return null;
        }
    }

    private async processFeatureImage(context: MarkdownPipelineContext): Promise<MarkdownPipelineUpdate | null> {
        const featureImageUpdate = await this.processMarkdownFeatureImage({
            file: context.file,
            fileData: context.fileData,
            settings: context.settings,
            content: context.content,
            frontmatter: context.frontmatter,
            bodyStartIndex: context.bodyStartIndex,
            isExcalidraw: context.isExcalidraw,
            featureImageReference: context.featureImageReference,
            featureImageExcluded: context.featureImageExcluded
        });

        if (!featureImageUpdate) {
            return null;
        }

        return {
            featureImageKey: featureImageUpdate.featureImageKey,
            featureImage: featureImageUpdate.featureImage
        };
    }

    private async processMarkdownFeatureImage(params: {
        file: TFile;
        fileData: FileData | null;
        settings: NotebookNavigatorSettings;
        content: string;
        frontmatter: FrontMatterCache | null;
        bodyStartIndex: number;
        isExcalidraw: boolean;
        featureImageReference: FeatureImageReference | null;
        featureImageExcluded: boolean;
    }): Promise<{ featureImageKey: string; featureImage: Blob } | null> {
        if (params.featureImageExcluded) {
            const featureImageKey = '';
            const isUpToDate = params.fileData?.featureImageKey === featureImageKey && params.fileData.featureImageStatus === 'none';
            if (isUpToDate) {
                return null;
            }

            return {
                featureImageKey,
                featureImage: this.createEmptyBlob()
            };
        }

        if (params.isExcalidraw) {
            const featureImageKey = this.getExcalidrawFeatureImageKey(params.file);
            if (params.fileData && params.fileData.featureImageKey === featureImageKey) {
                return null;
            }

            const thumbnail = await this.createExcalidrawThumbnail(params.file);
            return {
                featureImageKey,
                featureImage: thumbnail ?? this.createEmptyBlob()
            };
        }

        const reference =
            params.featureImageReference ??
            findFeatureImageReference({
                app: this.app,
                file: params.file,
                content: params.content,
                settings: params.settings,
                frontmatter: params.frontmatter,
                bodyStartIndex: params.bodyStartIndex
            });

        if (!reference) {
            const featureImageKey = '';
            if (params.fileData && params.fileData.featureImageKey === featureImageKey) {
                return null;
            }
            return {
                featureImageKey,
                featureImage: this.createEmptyBlob()
            };
        }

        const featureImageKey = this.getFeatureImageKey(reference);
        const hasStableThumbnail = params.fileData?.featureImageKey === featureImageKey && params.fileData.featureImageStatus === 'has';

        if (hasStableThumbnail) {
            return null;
        }

        try {
            const thumbnail = await this.createThumbnailBlob(reference, params.settings);
            return {
                featureImageKey,
                featureImage: thumbnail ?? this.createEmptyBlob()
            };
        } catch (error) {
            console.error(`Error generating feature image for ${params.file.path}:`, error);
            // Return an empty blob as a durable "attempted" marker so the file doesn't stay `unprocessed` forever.
            return {
                featureImageKey,
                featureImage: this.createEmptyBlob()
            };
        }
    }
}
