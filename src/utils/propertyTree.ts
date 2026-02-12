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

import type { FileData } from '../storage/IndexedDBStorage';
import type { PropertyTreeNode, PropertyTreeNodeId } from '../types/storage';
import { PROPERTIES_ROOT_VIRTUAL_FOLDER_ID } from '../types';
import type { NotebookNavigatorSettings } from '../settings';
import { isPathInExcludedFolder } from './fileFilters';
import { getCachedCommaSeparatedList } from './commaSeparatedListUtils';
import { casefold } from './recordUtils';
import { isRecord } from './typeGuards';

export interface BuildPropertyTreeOptions {
    excludedFolderPatterns?: string[];
    includedPaths?: Set<string>;
    includedPropertyKeys?: Set<string>;
}

export interface PropertySelectionValue {
    key: string;
    value: string | null;
    displayKey?: string;
    displayValuePath?: string | null;
}

export type PropertySelectionNodeId = typeof PROPERTIES_ROOT_VIRTUAL_FOLDER_ID | PropertyTreeNodeId;

export interface PropertyTreeDatabaseLike {
    forEachFile: (callback: (path: string, fileData: FileData) => void) => void;
}

type PropertyTreeFilePropertyEntry = NonNullable<FileData['customProperty']>[number];

let propertyDescendantNoteCountCache: WeakMap<PropertyTreeNode, Map<string, number>> | null = null;
let propertyKeyDirectPathCache: WeakMap<PropertyTreeNode, Set<string>> | null = null;
const configuredPropertyKeyCache = new Map<string, ReadonlySet<string>>();
const PROPERTY_BOOLEAN_VALUE_PATHS = new Set(['true', 'false']);

/**
 * Clears cached descendant note totals for property value nodes.
 */
export function clearPropertyNoteCountCache(): void {
    propertyDescendantNoteCountCache = null;
}

function getPropertyDescendantNoteCountCache(): WeakMap<PropertyTreeNode, Map<string, number>> {
    if (!propertyDescendantNoteCountCache) {
        propertyDescendantNoteCountCache = new WeakMap();
    }
    return propertyDescendantNoteCountCache;
}

function getPropertyKeyDirectPathCache(): WeakMap<PropertyTreeNode, Set<string>> {
    if (!propertyKeyDirectPathCache) {
        propertyKeyDirectPathCache = new WeakMap();
    }
    return propertyKeyDirectPathCache;
}

function buildPropertyDescendantNoteCounts(keyNode: PropertyTreeNode): Map<string, number> {
    const descendantPathsByValuePath = new Map<string, Set<string>>();

    keyNode.children.forEach(valueNode => {
        const valuePath = valueNode.valuePath;
        if (!valuePath) {
            return;
        }

        const segments = valuePath.split('/').filter(Boolean);
        if (segments.length === 0) {
            return;
        }

        let prefix = '';
        for (const segment of segments) {
            prefix = prefix ? `${prefix}/${segment}` : segment;
            let descendantPaths = descendantPathsByValuePath.get(prefix);
            if (!descendantPaths) {
                descendantPaths = new Set<string>();
                descendantPathsByValuePath.set(prefix, descendantPaths);
            }

            valueNode.notesWithValue.forEach(path => descendantPaths.add(path));
        }
    });

    const descendantCounts = new Map<string, number>();
    descendantPathsByValuePath.forEach((paths, valuePath) => {
        descendantCounts.set(valuePath, paths.size);
    });
    return descendantCounts;
}

/**
 * Returns the number of notes for a property value path including descendants.
 */
export function getTotalPropertyNoteCount(keyNode: PropertyTreeNode, valuePath: string): number {
    if (!valuePath) {
        return 0;
    }

    const cache = getPropertyDescendantNoteCountCache();
    let descendantCounts = cache.get(keyNode);
    if (!descendantCounts) {
        descendantCounts = buildPropertyDescendantNoteCounts(keyNode);
        cache.set(keyNode, descendantCounts);
    }

    const cachedCount = descendantCounts.get(valuePath);
    if (cachedCount !== undefined) {
        return cachedCount;
    }

    const nodeId = buildPropertyValueNodeId(keyNode.key, valuePath);
    const valueNode = keyNode.children.get(nodeId);
    return valueNode?.notesWithValue.size ?? 0;
}

/**
 * Collects note paths for the selected property value.
 * Includes descendant values when requested.
 */
export function collectPropertyValueFilePaths(keyNode: PropertyTreeNode, valuePath: string, includeDescendants: boolean): Set<string> {
    const nodeId = buildPropertyValueNodeId(keyNode.key, valuePath);
    const valueNode = keyNode.children.get(nodeId);
    if (!valueNode) {
        return new Set<string>();
    }

    const valuePaths = new Set<string>(valueNode.notesWithValue);
    if (!includeDescendants) {
        return valuePaths;
    }

    keyNode.children.forEach(childNode => {
        if (!childNode.valuePath || !childNode.valuePath.startsWith(`${valuePath}/`)) {
            return;
        }
        childNode.notesWithValue.forEach(path => valuePaths.add(path));
    });
    return valuePaths;
}

/**
 * Checks whether a normalized property value should be treated as a key-level value.
 * Key-level values do not create child value nodes.
 * Boolean literals are treated as key-level values when their original value kind is boolean.
 * Legacy cache entries without value-kind metadata keep previous boolean handling.
 */
export function isPropertyKeyOnlyValuePath(valuePath: string, valueKind?: PropertyTreeFilePropertyEntry['valueKind']): boolean {
    if (valuePath.length === 0) {
        return true;
    }

    if (!PROPERTY_BOOLEAN_VALUE_PATHS.has(valuePath)) {
        return false;
    }

    return valueKind === 'boolean' || valueKind === undefined;
}

/**
 * Registers direct key-level note paths for a property key node.
 */
export function registerPropertyKeyDirectPaths(keyNode: PropertyTreeNode, directPaths: Iterable<string> = []): void {
    getPropertyKeyDirectPathCache().set(keyNode, new Set(directPaths));
}

/**
 * Collects note paths for the selected property key.
 * Includes descendant values when requested.
 */
export function collectPropertyKeyFilePaths(keyNode: PropertyTreeNode, includeDescendants: boolean): Set<string> {
    if (includeDescendants) {
        return new Set(keyNode.notesWithValue);
    }

    return new Set(getOrBuildDirectPropertyKeyPaths(keyNode));
}

/**
 * Returns the number of notes that match only the property key (no child value path).
 */
export function getDirectPropertyKeyNoteCount(keyNode: PropertyTreeNode): number {
    return getOrBuildDirectPropertyKeyPaths(keyNode).size;
}

function buildDirectPropertyKeyPaths(keyNode: PropertyTreeNode): Set<string> {
    const directPaths = new Set<string>(keyNode.notesWithValue);
    keyNode.children.forEach(childNode => {
        childNode.notesWithValue.forEach(path => directPaths.delete(path));
    });
    return directPaths;
}

function getOrBuildDirectPropertyKeyPaths(keyNode: PropertyTreeNode): Set<string> {
    const cache = getPropertyKeyDirectPathCache();
    const cachedPaths = cache.get(keyNode);
    if (cachedPaths) {
        return cachedPaths;
    }

    const directPaths = buildDirectPropertyKeyPaths(keyNode);
    cache.set(keyNode, directPaths);
    return directPaths;
}

export function isPropertyFeatureEnabled(settings: NotebookNavigatorSettings): boolean {
    if (settings.customPropertyType !== 'frontmatter') {
        return false;
    }

    return getConfiguredPropertyKeySet(settings).size > 0;
}

function normalizePropertyTreeKey(value: string): string {
    return casefold(value);
}

function getConfiguredPropertyKeySet(settings: NotebookNavigatorSettings): ReadonlySet<string> {
    const cacheKey = settings.customPropertyFields;
    const cached = configuredPropertyKeyCache.get(cacheKey);
    if (cached) {
        return cached;
    }

    const keys = new Set<string>();
    for (const fieldName of getCachedCommaSeparatedList(cacheKey)) {
        const normalized = casefold(fieldName);
        if (!normalized) {
            continue;
        }
        keys.add(normalized);
    }

    configuredPropertyKeyCache.set(cacheKey, keys);
    return keys;
}

export function isPropertySelectionNodeIdConfigured(
    settings: NotebookNavigatorSettings,
    selectionNodeId: PropertySelectionNodeId
): boolean {
    if (selectionNodeId === PROPERTIES_ROOT_VIRTUAL_FOLDER_ID) {
        return true;
    }

    const parsed = parsePropertyNodeId(selectionNodeId);
    if (!parsed) {
        return false;
    }

    return getConfiguredPropertyKeySet(settings).has(parsed.key);
}

/**
 * Resolves a property selection id against the current property tree.
 * Falls back to the key node when a value node no longer exists.
 * Falls back to properties root when the key does not exist.
 */
export function resolvePropertySelectionNodeId(
    propertyTree: ReadonlyMap<string, PropertyTreeNode>,
    selectionNodeId: PropertySelectionNodeId
): PropertySelectionNodeId {
    if (selectionNodeId === PROPERTIES_ROOT_VIRTUAL_FOLDER_ID) {
        return selectionNodeId;
    }

    const parsed = parsePropertyNodeId(selectionNodeId);
    if (!parsed) {
        return PROPERTIES_ROOT_VIRTUAL_FOLDER_ID;
    }

    const keyNode = propertyTree.get(parsed.key);
    if (!keyNode) {
        return PROPERTIES_ROOT_VIRTUAL_FOLDER_ID;
    }

    if (!parsed.valuePath) {
        return keyNode.id;
    }

    const valueNodeId = buildPropertyValueNodeId(parsed.key, parsed.valuePath);
    if (keyNode.children.has(valueNodeId)) {
        return valueNodeId;
    }

    return keyNode.id;
}

const PROPERTY_NODE_ID_PREFIX = 'key:';
const PROPERTY_NODE_ID_VALUE_DELIMITER = '=';

function encodePropertyNodeSegment(value: string): string {
    return value.replace(/%/g, '%25').replace(/=/g, '%3D');
}

function decodePropertyNodeSegment(value: string): string {
    return value.replace(/%3[dD]/g, '=').replace(/%25/g, '%');
}

export function buildPropertyKeyNodeId(normalizedKey: string): PropertyTreeNodeId {
    return `${PROPERTY_NODE_ID_PREFIX}${encodePropertyNodeSegment(normalizedKey)}`;
}

export function buildPropertyValueNodeId(normalizedKey: string, normalizedValuePath: string): PropertyTreeNodeId {
    return `${PROPERTY_NODE_ID_PREFIX}${encodePropertyNodeSegment(normalizedKey)}${PROPERTY_NODE_ID_VALUE_DELIMITER}${encodePropertyNodeSegment(normalizedValuePath)}`;
}

export function getPropertyKeyNodeIdFromNodeId(nodeId: string): string | null {
    if (!nodeId.startsWith(PROPERTY_NODE_ID_PREFIX)) {
        return null;
    }

    const valueDelimiterIndex = nodeId.indexOf(PROPERTY_NODE_ID_VALUE_DELIMITER, PROPERTY_NODE_ID_PREFIX.length);
    if (valueDelimiterIndex === -1) {
        return nodeId;
    }

    return nodeId.slice(0, valueDelimiterIndex);
}

export function parsePropertyNodeId(nodeId: string): { key: string; valuePath: string | null } | null {
    if (!nodeId.startsWith(PROPERTY_NODE_ID_PREFIX)) {
        return null;
    }

    const encodedBody = nodeId.slice(PROPERTY_NODE_ID_PREFIX.length);
    if (!encodedBody) {
        return null;
    }

    const valueDelimiterIndex = encodedBody.indexOf(PROPERTY_NODE_ID_VALUE_DELIMITER);
    if (valueDelimiterIndex === -1) {
        const key = decodePropertyNodeSegment(encodedBody);
        if (!key) {
            return null;
        }
        return { key, valuePath: null };
    }

    const encodedKey = encodedBody.slice(0, valueDelimiterIndex);
    const encodedValuePath = encodedBody.slice(valueDelimiterIndex + 1);
    if (!encodedKey || !encodedValuePath) {
        return null;
    }

    const key = decodePropertyNodeSegment(encodedKey);
    const valuePath = decodePropertyNodeSegment(encodedValuePath);
    if (!key || !valuePath) {
        return null;
    }

    return { key, valuePath };
}

export function isPropertyTreeNodeId(value: string): value is PropertyTreeNodeId {
    return parsePropertyNodeId(value) !== null;
}

export function normalizePropertyTreeValuePath(rawValue: string): string {
    const normalizedSegments: string[] = [];
    const parts = rawValue.split('/');

    for (const rawPart of parts) {
        const displaySegment = rawPart.trim();
        if (!displaySegment) {
            continue;
        }

        const normalizedSegment = casefold(displaySegment);
        if (!normalizedSegment) {
            continue;
        }

        normalizedSegments.push(normalizedSegment);
    }

    return normalizedSegments.join('/');
}

function getSelectedPropertyNodeId(selection: PropertySelectionValue | null): PropertySelectionNodeId | null {
    if (!selection) {
        return null;
    }

    const normalizedKey = normalizePropertyTreeKey(selection.key);
    if (!normalizedKey) {
        return null;
    }

    if (selection.value) {
        const normalizedValuePath = normalizePropertyTreeValuePath(selection.value);
        if (!normalizedValuePath) {
            return null;
        }

        return buildPropertyValueNodeId(normalizedKey, normalizedValuePath);
    }

    return buildPropertyKeyNodeId(normalizedKey);
}

function parseLegacyStoredPropertySelection(value: unknown): PropertySelectionValue | null {
    if (!isRecord(value)) {
        return null;
    }

    const key = value.key;
    if (typeof key !== 'string' || key.length === 0) {
        return null;
    }

    const selection: PropertySelectionValue = {
        key,
        value: value.value === null ? null : typeof value.value === 'string' ? value.value : null
    };

    if (typeof value.displayKey === 'string' && value.displayKey.length > 0) {
        selection.displayKey = value.displayKey;
    }

    if (value.displayValuePath === null || typeof value.displayValuePath === 'string') {
        selection.displayValuePath = value.displayValuePath;
    }

    return selection;
}

export function parseStoredPropertySelectionNodeId(value: unknown): PropertySelectionNodeId | null {
    if (typeof value === 'string' && value.length > 0) {
        if (value === PROPERTIES_ROOT_VIRTUAL_FOLDER_ID) {
            return PROPERTIES_ROOT_VIRTUAL_FOLDER_ID;
        }
        return isPropertyTreeNodeId(value) ? value : null;
    }

    const legacySelection = parseLegacyStoredPropertySelection(value);
    if (!legacySelection) {
        return null;
    }

    return getSelectedPropertyNodeId(legacySelection);
}

/**
 * Builds a property tree from the IndexedDB cache.
 *
 * Notes:
 * - Tree roots are property keys.
 * - Value nodes are stored as direct children of keys.
 * - Node ids use normalized lowercase keys/value paths.
 */
export function buildPropertyTreeFromDatabase(
    db: PropertyTreeDatabaseLike,
    options: BuildPropertyTreeOptions = {}
): Map<string, PropertyTreeNode> {
    clearPropertyNoteCountCache();
    propertyKeyDirectPathCache = new WeakMap<PropertyTreeNode, Set<string>>();

    const tree = new Map<string, PropertyTreeNode>();
    const excludedFolderPatterns = options.excludedFolderPatterns ?? [];
    const hasExcludedFolders = excludedFolderPatterns.length > 0;
    const includedPaths = options.includedPaths;
    const includedPropertyKeys = options.includedPropertyKeys;
    const shouldFilterPropertyKeys = Boolean(includedPropertyKeys && includedPropertyKeys.size > 0);

    db.forEachFile((path, fileData) => {
        if (includedPaths && !includedPaths.has(path)) {
            return;
        }

        if (hasExcludedFolders && isPathInExcludedFolder(path, excludedFolderPatterns)) {
            return;
        }

        const customProperty = fileData.customProperty;
        if (!customProperty || customProperty.length === 0) {
            return;
        }

        for (const propertyEntry of customProperty) {
            const normalizedKey = normalizePropertyTreeKey(propertyEntry.fieldKey);
            if (!normalizedKey) {
                continue;
            }

            if (shouldFilterPropertyKeys && includedPropertyKeys && !includedPropertyKeys.has(normalizedKey)) {
                continue;
            }

            const displayKey = propertyEntry.fieldKey.trim();
            if (!displayKey) {
                continue;
            }

            let keyNode = tree.get(normalizedKey);
            if (!keyNode) {
                keyNode = {
                    id: buildPropertyKeyNodeId(normalizedKey),
                    kind: 'key',
                    key: normalizedKey,
                    valuePath: null,
                    name: displayKey,
                    displayPath: displayKey,
                    children: new Map(),
                    notesWithValue: new Set()
                };
                registerPropertyKeyDirectPaths(keyNode);
                tree.set(normalizedKey, keyNode);
            }

            keyNode.notesWithValue.add(path);

            const normalizedValuePath = normalizePropertyTreeValuePath(propertyEntry.value);
            if (isPropertyKeyOnlyValuePath(normalizedValuePath, propertyEntry.valueKind)) {
                getOrBuildDirectPropertyKeyPaths(keyNode).add(path);
                continue;
            }

            const displayValuePath = propertyEntry.value.trim();
            if (!displayValuePath) {
                continue;
            }

            const nodeId = buildPropertyValueNodeId(normalizedKey, normalizedValuePath);
            let valueNode = keyNode.children.get(nodeId);
            if (!valueNode) {
                valueNode = {
                    id: nodeId,
                    kind: 'value',
                    key: normalizedKey,
                    valuePath: normalizedValuePath,
                    name: displayValuePath,
                    displayPath: displayValuePath,
                    children: new Map(),
                    notesWithValue: new Set()
                };
                keyNode.children.set(nodeId, valueNode);
            }

            valueNode.notesWithValue.add(path);
        }
    });

    return tree;
}
