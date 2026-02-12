/*
 * Notebook Navigator - Plugin for Obsidian
 * Copyright (c) 2025-2026 Johan Sanneblad
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

import { useCallback, useEffect, useMemo, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { App, debounce, TFile } from 'obsidian';
import type { Debouncer } from 'obsidian';
import { TIMEOUTS } from '../../types/obsidian-extended';
import type { PropertyTreeService } from '../../services/PropertyTreeService';
import { getDBInstance } from '../../storage/fileOperations';
import type { StorageFileData } from './storageFileData';
import type { NotebookNavigatorSettings } from '../../settings';
import type { FileVisibility } from '../../utils/fileTypeUtils';
import {
    buildPropertyKeyNodeId,
    buildPropertyTreeFromDatabase,
    isPropertyFeatureEnabled,
    registerPropertyKeyDirectPaths
} from '../../utils/propertyTree';
import { casefold } from '../../utils/recordUtils';
import { getCachedCommaSeparatedList } from '../../utils/commaSeparatedListUtils';
import type { PropertyTreeNode } from '../../types/storage';

type SchedulePropertyTreeRebuildOptions = {
    flush?: boolean;
};

function shouldEnablePropertyTree(settings: NotebookNavigatorSettings): boolean {
    return isPropertyFeatureEnabled(settings);
}

function buildConfiguredPropertyDisplayByKey(settings: NotebookNavigatorSettings): Map<string, string> {
    const displayByKey = new Map<string, string>();
    for (const fieldName of getCachedCommaSeparatedList(settings.customPropertyFields)) {
        const displayName = fieldName.trim();
        const normalizedField = casefold(fieldName);
        if (!displayName || !normalizedField || displayByKey.has(normalizedField)) {
            continue;
        }
        displayByKey.set(normalizedField, displayName);
    }
    return displayByKey;
}

function includeConfiguredPropertyKeys(tree: Map<string, PropertyTreeNode>, displayByKey: Map<string, string>): void {
    for (const [normalizedKey, displayName] of displayByKey.entries()) {
        if (tree.has(normalizedKey)) {
            continue;
        }

        const keyNode: PropertyTreeNode = {
            id: buildPropertyKeyNodeId(normalizedKey),
            kind: 'key',
            key: normalizedKey,
            valuePath: null,
            name: displayName,
            displayPath: displayName,
            children: new Map(),
            notesWithValue: new Set()
        };
        tree.set(normalizedKey, keyNode);
        registerPropertyKeyDirectPaths(keyNode);
    }
}

export function usePropertyTreeSync(params: {
    app: App;
    settings: NotebookNavigatorSettings;
    showHiddenItems: boolean;
    hiddenFolders: string[];
    hiddenFileProperties: string[];
    hiddenFileTags: string[];
    fileVisibility: FileVisibility;
    profileId: string;
    isStorageReady: boolean;
    isStorageReadyRef: RefObject<boolean>;
    latestSettingsRef: RefObject<NotebookNavigatorSettings>;
    stoppedRef: RefObject<boolean>;
    setFileData: Dispatch<SetStateAction<StorageFileData>>;
    getVisibleMarkdownFiles: () => TFile[];
    propertyTreeService: PropertyTreeService | null;
}): {
    rebuildPropertyTree: () => Map<string, PropertyTreeNode>;
    schedulePropertyTreeRebuild: (options?: SchedulePropertyTreeRebuildOptions) => void;
    cancelPropertyTreeRebuildDebouncer: (options?: { reset?: boolean }) => void;
} {
    const {
        app,
        settings,
        showHiddenItems,
        hiddenFolders,
        hiddenFileProperties,
        hiddenFileTags,
        fileVisibility,
        profileId,
        isStorageReady,
        isStorageReadyRef,
        latestSettingsRef,
        stoppedRef,
        setFileData,
        getVisibleMarkdownFiles,
        propertyTreeService
    } = params;

    const hiddenFoldersRef = useRef(hiddenFolders);
    const rebuildPropertyTreeFnRef = useRef<(() => Map<string, PropertyTreeNode>) | null>(null);
    const propertyTreeRebuildDebouncerRef = useRef<Debouncer<[], void> | null>(null);
    const isPropertyTreeEnabled = useMemo(() => shouldEnablePropertyTree(settings), [settings]);
    const propertyTreeRebuildReadyGateRef = useRef(false);

    useEffect(() => {
        hiddenFoldersRef.current = hiddenFolders;
    }, [hiddenFolders]);

    const clearPropertyTree = useCallback(() => {
        const emptyTree = new Map<string, PropertyTreeNode>();
        setFileData(previous => ({ ...previous, propertyTree: emptyTree }));
        propertyTreeService?.updatePropertyTree(emptyTree);
        return emptyTree;
    }, [propertyTreeService, setFileData]);

    const rebuildPropertyTree = useCallback(() => {
        const liveSettings = latestSettingsRef.current;
        const configuredDisplayByKey = buildConfiguredPropertyDisplayByKey(liveSettings);
        const includedPropertyKeys = new Set(configuredDisplayByKey.keys());
        const shouldBuildTree = liveSettings.customPropertyType === 'frontmatter' && configuredDisplayByKey.size > 0;
        if (!shouldBuildTree) {
            return clearPropertyTree();
        }

        const db = getDBInstance();
        const excludedFolderPatterns = showHiddenItems ? [] : hiddenFoldersRef.current;
        const visibleMarkdownPaths = getVisibleMarkdownFiles().map(file => file.path);
        const propertyTree = buildPropertyTreeFromDatabase(
            {
                forEachFile: callback => {
                    visibleMarkdownPaths.forEach(path => {
                        const fileData = db.getFile(path);
                        if (!fileData) {
                            return;
                        }
                        callback(path, fileData);
                    });
                }
            },
            {
                excludedFolderPatterns,
                includedPropertyKeys
            }
        );
        includeConfiguredPropertyKeys(propertyTree, configuredDisplayByKey);

        setFileData(previous => ({ ...previous, propertyTree }));
        propertyTreeService?.updatePropertyTree(propertyTree);
        return propertyTree;
    }, [clearPropertyTree, getVisibleMarkdownFiles, latestSettingsRef, propertyTreeService, setFileData, showHiddenItems]);

    rebuildPropertyTreeFnRef.current = rebuildPropertyTree;

    const cancelPropertyTreeRebuildDebouncer = useCallback((options?: { reset?: boolean }) => {
        const debouncer = propertyTreeRebuildDebouncerRef.current;
        if (!debouncer) {
            return;
        }

        try {
            debouncer.cancel();
        } catch {
            // ignore
        }

        if (options?.reset) {
            propertyTreeRebuildDebouncerRef.current = null;
        }
    }, []);

    const schedulePropertyTreeRebuild = useCallback(
        (options?: SchedulePropertyTreeRebuildOptions) => {
            if (stoppedRef.current || !isStorageReadyRef.current) {
                return;
            }

            if (!shouldEnablePropertyTree(latestSettingsRef.current)) {
                clearPropertyTree();
                return;
            }

            if (!propertyTreeRebuildDebouncerRef.current) {
                propertyTreeRebuildDebouncerRef.current = debounce(
                    () => {
                        if (stoppedRef.current || !isStorageReadyRef.current) {
                            return;
                        }

                        if (!shouldEnablePropertyTree(latestSettingsRef.current)) {
                            clearPropertyTree();
                            return;
                        }

                        rebuildPropertyTreeFnRef.current?.();
                    },
                    TIMEOUTS.DEBOUNCE_TAG_TREE,
                    true
                );
            }

            propertyTreeRebuildDebouncerRef.current();

            if (options?.flush) {
                try {
                    propertyTreeRebuildDebouncerRef.current.run();
                } catch {
                    // ignore
                }
            }
        },
        [clearPropertyTree, isStorageReadyRef, latestSettingsRef, stoppedRef]
    );

    useEffect(() => {
        if (!isStorageReady) {
            // Resets the ready gate so the next ready transition is ignored.
            propertyTreeRebuildReadyGateRef.current = false;
            return;
        }

        if (!propertyTreeRebuildReadyGateRef.current) {
            // Initial cache build creates the property tree before storage is marked ready.
            propertyTreeRebuildReadyGateRef.current = true;
            return;
        }

        if (!isPropertyTreeEnabled) {
            clearPropertyTree();
            return;
        }

        schedulePropertyTreeRebuild();
    }, [
        showHiddenItems,
        isStorageReady,
        isPropertyTreeEnabled,
        schedulePropertyTreeRebuild,
        clearPropertyTree,
        hiddenFolders,
        hiddenFileProperties,
        hiddenFileTags,
        fileVisibility,
        profileId,
        settings.customPropertyFields,
        settings.customPropertyType
    ]);

    useEffect(() => {
        if (!isStorageReady || !isPropertyTreeEnabled) {
            return;
        }

        const shouldRebuildOnTagVisibilityChanges = !showHiddenItems && hiddenFileTags.length > 0;
        const db = getDBInstance();
        const unsubscribe = db.onContentChange(changes => {
            if (stoppedRef.current) {
                return;
            }

            let hasRelevantChanges = false;
            let shouldFlush = false;
            let activeFilePath: string | null = null;
            let activeFileResolved = false;

            for (const change of changes) {
                const hasPropertyChange = change.changes.customProperty !== undefined;
                const hasTagVisibilityChange = shouldRebuildOnTagVisibilityChanges && change.changes.tags !== undefined;
                if (!hasPropertyChange && !hasTagVisibilityChange) {
                    continue;
                }

                hasRelevantChanges = true;

                if (!activeFileResolved) {
                    activeFilePath = app.workspace.getActiveFile()?.path ?? null;
                    activeFileResolved = true;
                }

                if (activeFilePath && change.path === activeFilePath) {
                    shouldFlush = true;
                    break;
                }
            }

            if (hasRelevantChanges) {
                schedulePropertyTreeRebuild({ flush: shouldFlush });
            }
        });

        return unsubscribe;
    }, [app.workspace, hiddenFileTags, isStorageReady, isPropertyTreeEnabled, schedulePropertyTreeRebuild, showHiddenItems, stoppedRef]);

    return { rebuildPropertyTree, schedulePropertyTreeRebuild, cancelPropertyTreeRebuildDebouncer };
}
