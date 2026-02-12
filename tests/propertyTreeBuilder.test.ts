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

import { describe, expect, it } from 'vitest';
import type { FileData } from '../src/storage/IndexedDBStorage';
import {
    type PropertyTreeDatabaseLike,
    buildPropertyKeyNodeId,
    buildPropertyTreeFromDatabase,
    buildPropertyValueNodeId,
    clearPropertyNoteCountCache,
    collectPropertyValueFilePaths,
    getPropertyKeyNodeIdFromNodeId,
    getTotalPropertyNoteCount,
    normalizePropertyTreeValuePath,
    parsePropertyNodeId
} from '../src/utils/propertyTree';

interface MockFile {
    path: string;
    customProperty: { fieldKey: string; value: string }[] | null;
}

function createFileData(customProperty: { fieldKey: string; value: string }[] | null): FileData {
    return {
        mtime: 0,
        markdownPipelineMtime: 0,
        tagsMtime: 0,
        metadataMtime: 0,
        fileThumbnailsMtime: 0,
        tags: null,
        wordCount: null,
        taskTotal: 0,
        taskUnfinished: 0,
        customProperty,
        previewStatus: 'unprocessed',
        featureImage: null,
        featureImageStatus: 'unprocessed',
        featureImageKey: null,
        metadata: null
    };
}

function createMockDb(files: MockFile[]): PropertyTreeDatabaseLike {
    const payload = files.map(file => ({
        path: file.path,
        data: createFileData(file.customProperty)
    }));

    return {
        forEachFile: (callback: (path: string, data: FileData) => void) => {
            payload.forEach(entry => callback(entry.path, entry.data));
        }
    };
}

describe('buildPropertyTreeFromDatabase', () => {
    it('builds flat key/value nodes and preserves first-seen display casing', () => {
        const db = createMockDb([
            {
                path: 'notes/a.md',
                customProperty: [{ fieldKey: 'Status', value: 'Work/Finished' }]
            },
            {
                path: 'notes/b.md',
                customProperty: [{ fieldKey: 'status', value: 'work/Started' }]
            }
        ]);

        const tree = buildPropertyTreeFromDatabase(db, {
            includedPropertyKeys: new Set(['status'])
        });

        expect(Array.from(tree.keys())).toEqual(['status']);
        const keyNode = tree.get('status');
        expect(keyNode?.name).toBe('Status');
        expect(keyNode?.notesWithValue).toEqual(new Set(['notes/a.md', 'notes/b.md']));

        const finishedNodeId = buildPropertyValueNodeId('status', 'work/finished');
        const finishedNode = keyNode?.children.get(finishedNodeId);
        expect(finishedNode?.name).toBe('Work/Finished');
        expect(finishedNode?.notesWithValue).toEqual(new Set(['notes/a.md']));

        const startedNodeId = buildPropertyValueNodeId('status', 'work/started');
        const startedNode = keyNode?.children.get(startedNodeId);
        expect(startedNode?.name).toBe('work/Started');
        expect(startedNode?.notesWithValue).toEqual(new Set(['notes/b.md']));
    });

    it('respects included paths, excluded folders, and included property keys', () => {
        const db = createMockDb([
            {
                path: 'notes/keep.md',
                customProperty: [{ fieldKey: 'Status', value: '  Work // Done / ' }]
            },
            {
                path: 'notes/skip-key.md',
                customProperty: [{ fieldKey: 'Priority', value: 'High' }]
            },
            {
                path: 'archive/hidden.md',
                customProperty: [{ fieldKey: 'Status', value: 'Hidden/Value' }]
            }
        ]);

        const tree = buildPropertyTreeFromDatabase(db, {
            includedPaths: new Set(['notes/keep.md', 'archive/hidden.md', 'notes/skip-key.md']),
            excludedFolderPatterns: ['archive'],
            includedPropertyKeys: new Set(['status'])
        });

        expect(Array.from(tree.keys())).toEqual(['status']);

        const keyNode = tree.get('status');
        expect(keyNode?.notesWithValue).toEqual(new Set(['notes/keep.md']));

        const normalizedValuePath = normalizePropertyTreeValuePath('Work/Done');
        const valueNodeId = buildPropertyValueNodeId('status', normalizedValuePath);
        const valueNode = keyNode?.children.get(valueNodeId);

        expect(valueNode?.notesWithValue).toEqual(new Set(['notes/keep.md']));
        expect(tree.has('priority')).toBe(false);
    });

    it('keeps key nodes for empty values without creating value nodes', () => {
        const db = createMockDb([
            {
                path: 'notes/empty.md',
                customProperty: [{ fieldKey: 'Status', value: '   ' }]
            }
        ]);

        const tree = buildPropertyTreeFromDatabase(db, {
            includedPropertyKeys: new Set(['status'])
        });

        const keyNodeId = buildPropertyKeyNodeId('status');
        const keyNode = tree.get('status');

        expect(keyNode?.id).toBe(keyNodeId);
        expect(keyNode?.notesWithValue).toEqual(new Set(['notes/empty.md']));
        expect(keyNode?.children.size).toBe(0);
    });
});

describe('property value descendants', () => {
    it('counts descendant values with cached totals and collects matching file paths', () => {
        const db = createMockDb([
            {
                path: 'notes/a.md',
                customProperty: [{ fieldKey: 'Status', value: 'Work/Done' }]
            },
            {
                path: 'notes/b.md',
                customProperty: [{ fieldKey: 'Status', value: 'Work/Blocked' }]
            },
            {
                path: 'notes/c.md',
                customProperty: [{ fieldKey: 'Status', value: 'Work' }]
            },
            {
                path: 'notes/d.md',
                customProperty: [{ fieldKey: 'Status', value: 'Personal/Home' }]
            }
        ]);

        const tree = buildPropertyTreeFromDatabase(db, {
            includedPropertyKeys: new Set(['status'])
        });
        const keyNode = tree.get('status');
        expect(keyNode).toBeDefined();
        if (!keyNode) {
            return;
        }

        expect(getTotalPropertyNoteCount(keyNode, normalizePropertyTreeValuePath('Work'))).toBe(3);
        expect(getTotalPropertyNoteCount(keyNode, normalizePropertyTreeValuePath('Work/Done'))).toBe(1);

        const directPaths = collectPropertyValueFilePaths(keyNode, normalizePropertyTreeValuePath('Work'), false);
        expect(directPaths).toEqual(new Set(['notes/c.md']));

        const descendantPaths = collectPropertyValueFilePaths(keyNode, normalizePropertyTreeValuePath('Work'), true);
        expect(descendantPaths).toEqual(new Set(['notes/a.md', 'notes/b.md', 'notes/c.md']));
    });

    it('clears cached descendant totals when requested', () => {
        const db = createMockDb([
            {
                path: 'notes/a.md',
                customProperty: [{ fieldKey: 'Status', value: 'Work/Done' }]
            },
            {
                path: 'notes/b.md',
                customProperty: [{ fieldKey: 'Status', value: 'Work/Blocked' }]
            }
        ]);

        const tree = buildPropertyTreeFromDatabase(db, {
            includedPropertyKeys: new Set(['status'])
        });
        const keyNode = tree.get('status');
        expect(keyNode).toBeDefined();
        if (!keyNode) {
            return;
        }

        const workPath = normalizePropertyTreeValuePath('Work');
        expect(getTotalPropertyNoteCount(keyNode, workPath)).toBe(2);

        const startedNodeId = buildPropertyValueNodeId('status', normalizePropertyTreeValuePath('Work/Started'));
        keyNode.children.set(startedNodeId, {
            id: startedNodeId,
            kind: 'value',
            key: 'status',
            valuePath: normalizePropertyTreeValuePath('Work/Started'),
            name: 'Work/Started',
            displayPath: 'Work/Started',
            children: new Map(),
            notesWithValue: new Set(['notes/c.md'])
        });

        expect(getTotalPropertyNoteCount(keyNode, workPath)).toBe(2);

        clearPropertyNoteCountCache();
        expect(getTotalPropertyNoteCount(keyNode, workPath)).toBe(3);
    });
});

describe('property node id encoding', () => {
    it('preserves keys and values that contain "=" when building and parsing ids', () => {
        const keyId = buildPropertyKeyNodeId('status=phase');
        const valuePath = normalizePropertyTreeValuePath('work=done/blocked');
        const valueId = buildPropertyValueNodeId('status=phase', valuePath);

        expect(parsePropertyNodeId(keyId)).toEqual({ key: 'status=phase', valuePath: null });
        expect(parsePropertyNodeId(valueId)).toEqual({ key: 'status=phase', valuePath });
        expect(getPropertyKeyNodeIdFromNodeId(valueId)).toBe(keyId);
    });
});
