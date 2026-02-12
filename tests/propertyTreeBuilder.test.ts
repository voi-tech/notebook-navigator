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
import type { CustomPropertyItem, FileData } from '../src/storage/IndexedDBStorage';
import { PROPERTIES_ROOT_VIRTUAL_FOLDER_ID } from '../src/types';
import {
    type PropertyTreeDatabaseLike,
    buildPropertyKeyNodeId,
    buildPropertyTreeFromDatabase,
    buildPropertyValueNodeId,
    collectPropertyKeyFilePaths,
    collectPropertyValueFilePaths,
    getDirectPropertyKeyNoteCount,
    getPropertyKeyNodeIdFromNodeId,
    resolvePropertySelectionNodeId,
    getTotalPropertyNoteCount,
    normalizePropertyTreeValuePath,
    parsePropertyNodeId
} from '../src/utils/propertyTree';

interface MockFile {
    path: string;
    customProperty: CustomPropertyItem[] | null;
}

function createFileData(customProperty: CustomPropertyItem[] | null): FileData {
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

        const normalizedValuePath = normalizePropertyTreeValuePath('  Work // Done / ');
        const valueNodeId = buildPropertyValueNodeId('status', normalizedValuePath);
        const valueNode = keyNode?.children.get(valueNodeId);

        expect(valueNode?.notesWithValue).toEqual(new Set(['notes/keep.md']));
        expect(valueNode?.displayPath).toBe('Work // Done /');
        expect(tree.has('priority')).toBe(false);
    });

    it('normalizes full value strings and keeps first-seen display casing', () => {
        const db = createMockDb([
            {
                path: 'notes/first.md',
                customProperty: [{ fieldKey: 'Status', value: '  Work // Done / ' }]
            },
            {
                path: 'notes/second.md',
                customProperty: [{ fieldKey: 'status', value: 'work // done /' }]
            }
        ]);

        const tree = buildPropertyTreeFromDatabase(db, {
            includedPropertyKeys: new Set(['status'])
        });
        const keyNode = tree.get('status');
        const valueNode = keyNode?.children.get(buildPropertyValueNodeId('status', normalizePropertyTreeValuePath('work // done /')));

        expect(valueNode?.name).toBe('Work // Done /');
        expect(valueNode?.displayPath).toBe('Work // Done /');
        expect(valueNode?.notesWithValue).toEqual(new Set(['notes/first.md', 'notes/second.md']));
    });

    it('normalizes included property keys before filtering', () => {
        const db = createMockDb([
            {
                path: 'notes/status.md',
                customProperty: [{ fieldKey: 'Status', value: 'Open' }]
            },
            {
                path: 'notes/priority.md',
                customProperty: [{ fieldKey: 'Priority', value: 'High' }]
            },
            {
                path: 'notes/mood.md',
                customProperty: [{ fieldKey: 'Mood', value: 'Calm' }]
            }
        ]);

        const tree = buildPropertyTreeFromDatabase(db, {
            includedPropertyKeys: new Set([' status ', 'PRIORITY'])
        });

        expect(Array.from(tree.keys())).toEqual(['priority', 'status']);
        expect(tree.has('mood')).toBe(false);
    });

    it('returns an empty tree when all included property keys normalize to empty values', () => {
        const db = createMockDb([
            {
                path: 'notes/status.md',
                customProperty: [{ fieldKey: 'Status', value: 'Open' }]
            },
            {
                path: 'notes/priority.md',
                customProperty: [{ fieldKey: 'Priority', value: 'High' }]
            }
        ]);

        const tree = buildPropertyTreeFromDatabase(db, {
            includedPropertyKeys: new Set(['   '])
        });

        expect(tree.size).toBe(0);
    });

    it('filters by normalized included property keys when some entries normalize to empty values', () => {
        const db = createMockDb([
            {
                path: 'notes/status.md',
                customProperty: [{ fieldKey: 'Status', value: 'Open' }]
            },
            {
                path: 'notes/priority.md',
                customProperty: [{ fieldKey: 'Priority', value: 'High' }]
            }
        ]);

        const tree = buildPropertyTreeFromDatabase(db, {
            includedPropertyKeys: new Set(['   ', ' Status '])
        });

        expect(Array.from(tree.keys())).toEqual(['status']);
        expect(tree.has('priority')).toBe(false);
    });

    it('orders key nodes and value nodes deterministically', () => {
        const db = createMockDb([
            {
                path: 'notes/status-zeta.md',
                customProperty: [{ fieldKey: 'Status', value: 'Work/Zeta' }]
            },
            {
                path: 'notes/zeta.md',
                customProperty: [{ fieldKey: 'Zeta', value: 'One' }]
            },
            {
                path: 'notes/alpha.md',
                customProperty: [{ fieldKey: 'Alpha', value: 'Two' }]
            },
            {
                path: 'notes/status-alpha.md',
                customProperty: [{ fieldKey: 'status', value: 'Work/Alpha' }]
            }
        ]);

        const tree = buildPropertyTreeFromDatabase(db, {
            includedPropertyKeys: new Set(['STATUS', 'zeta', 'alpha'])
        });

        expect(Array.from(tree.keys())).toEqual(['alpha', 'status', 'zeta']);

        const statusNode = tree.get('status');
        expect(statusNode).toBeDefined();
        if (!statusNode) {
            return;
        }

        expect(Array.from(statusNode.children.keys())).toEqual([
            buildPropertyValueNodeId('status', normalizePropertyTreeValuePath('Work/Alpha')),
            buildPropertyValueNodeId('status', normalizePropertyTreeValuePath('Work/Zeta'))
        ]);
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

    it('keeps key nodes for boolean values without creating value nodes', () => {
        const db = createMockDb([
            {
                path: 'notes/true.md',
                customProperty: [{ fieldKey: 'Status', value: 'true', valueKind: 'boolean' }]
            },
            {
                path: 'notes/false.md',
                customProperty: [{ fieldKey: 'Status', value: 'false', valueKind: 'boolean' }]
            }
        ]);

        const tree = buildPropertyTreeFromDatabase(db, {
            includedPropertyKeys: new Set(['status'])
        });

        const keyNode = tree.get('status');
        expect(keyNode?.notesWithValue).toEqual(new Set(['notes/true.md', 'notes/false.md']));
        expect(keyNode?.children.size).toBe(0);
    });

    it('keeps string literals "true" and "false" as value nodes', () => {
        const db = createMockDb([
            {
                path: 'notes/true-string.md',
                customProperty: [{ fieldKey: 'Status', value: 'true', valueKind: 'string' }]
            },
            {
                path: 'notes/false-string.md',
                customProperty: [{ fieldKey: 'Status', value: 'false', valueKind: 'string' }]
            }
        ]);

        const tree = buildPropertyTreeFromDatabase(db, {
            includedPropertyKeys: new Set(['status'])
        });

        const keyNode = tree.get('status');
        expect(keyNode?.notesWithValue).toEqual(new Set(['notes/true-string.md', 'notes/false-string.md']));

        const trueNode = keyNode?.children.get(buildPropertyValueNodeId('status', normalizePropertyTreeValuePath('true')));
        expect(trueNode?.notesWithValue).toEqual(new Set(['notes/true-string.md']));

        const falseNode = keyNode?.children.get(buildPropertyValueNodeId('status', normalizePropertyTreeValuePath('false')));
        expect(falseNode?.notesWithValue).toEqual(new Set(['notes/false-string.md']));
    });
});

describe('property value matching', () => {
    it('counts exact value totals and collects matching file paths', () => {
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
            },
            {
                path: 'notes/e.md',
                customProperty: [{ fieldKey: 'Status', value: '   ' }]
            },
            {
                path: 'notes/f.md',
                customProperty: [
                    { fieldKey: 'Status', value: 'true', valueKind: 'boolean' },
                    { fieldKey: 'Status', value: 'Work/Done' }
                ]
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

        expect(getTotalPropertyNoteCount(keyNode, normalizePropertyTreeValuePath('Work'))).toBe(1);
        expect(getTotalPropertyNoteCount(keyNode, normalizePropertyTreeValuePath('Work/Done'))).toBe(2);

        const directPaths = collectPropertyValueFilePaths(keyNode, normalizePropertyTreeValuePath('Work'));
        expect(directPaths).toEqual(new Set(['notes/c.md']));

        const withDescendants = collectPropertyValueFilePaths(keyNode, normalizePropertyTreeValuePath('Work'));
        expect(withDescendants).toEqual(new Set(['notes/c.md']));

        const directKeyPaths = collectPropertyKeyFilePaths(keyNode, false);
        expect(directKeyPaths).toEqual(new Set(['notes/e.md', 'notes/f.md']));
        expect(getDirectPropertyKeyNoteCount(keyNode)).toBe(2);

        const allKeyPaths = collectPropertyKeyFilePaths(keyNode, true);
        expect(allKeyPaths).toEqual(new Set(['notes/a.md', 'notes/b.md', 'notes/c.md', 'notes/d.md', 'notes/e.md', 'notes/f.md']));
    });

    it('keeps value totals exact after value-node mutations', () => {
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
        expect(getTotalPropertyNoteCount(keyNode, workPath)).toBe(0);

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

        expect(getTotalPropertyNoteCount(keyNode, workPath)).toBe(0);
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

describe('property selection resolution', () => {
    it('falls back from a missing value node to the key node', () => {
        const db = createMockDb([
            {
                path: 'notes/a.md',
                customProperty: [{ fieldKey: 'Status', value: 'true', valueKind: 'boolean' }]
            }
        ]);
        const tree = buildPropertyTreeFromDatabase(db, {
            includedPropertyKeys: new Set(['status'])
        });

        const missingValueSelection = buildPropertyValueNodeId('status', normalizePropertyTreeValuePath('true'));
        const resolved = resolvePropertySelectionNodeId(tree, missingValueSelection);
        expect(resolved).toBe(buildPropertyKeyNodeId('status'));
    });

    it('falls back to properties root when selected key does not exist', () => {
        const tree = buildPropertyTreeFromDatabase(createMockDb([]), {
            includedPropertyKeys: new Set(['status'])
        });

        const keySelection = buildPropertyKeyNodeId('status');
        const resolved = resolvePropertySelectionNodeId(tree, keySelection);
        expect(resolved).toBe(PROPERTIES_ROOT_VIRTUAL_FOLDER_ID);
    });

    it('keeps selected value node when a string literal value node exists', () => {
        const db = createMockDb([
            {
                path: 'notes/a.md',
                customProperty: [{ fieldKey: 'Status', value: 'true', valueKind: 'string' }]
            }
        ]);
        const tree = buildPropertyTreeFromDatabase(db, {
            includedPropertyKeys: new Set(['status'])
        });

        const valueSelection = buildPropertyValueNodeId('status', normalizePropertyTreeValuePath('true'));
        const resolved = resolvePropertySelectionNodeId(tree, valueSelection);
        expect(resolved).toBe(valueSelection);
    });
});
