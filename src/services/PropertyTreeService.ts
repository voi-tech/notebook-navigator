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

import type { PropertyTreeNode } from '../types/storage';

/**
 * Service that provides access to the property tree from StorageContext.
 * Acts as a bridge between React state and non-React code.
 */
export class PropertyTreeService {
    private propertyTree: Map<string, PropertyTreeNode> = new Map();
    private propertyNodeById: Map<string, PropertyTreeNode> = new Map();

    /**
     * Updates the property tree data from StorageContext.
     */
    updatePropertyTree(tree: Map<string, PropertyTreeNode>): void {
        this.propertyTree = tree;
        this.rebuildIndexes(tree);
    }

    /**
     * Gets the current property tree.
     */
    getPropertyTree(): Map<string, PropertyTreeNode> {
        return this.propertyTree;
    }

    /**
     * Finds a property tree node by canonical node id.
     */
    findNode(nodeId: string): PropertyTreeNode | null {
        return this.propertyNodeById.get(nodeId) ?? null;
    }

    /**
     * Collects descendant node ids for the provided node id.
     */
    collectDescendantNodeIds(nodeId: string): Set<string> {
        const rootNode = this.findNode(nodeId);
        if (!rootNode) {
            return new Set();
        }

        const ids = new Set<string>();
        const visited = new Set<PropertyTreeNode>();

        const visit = (node: PropertyTreeNode) => {
            if (visited.has(node)) {
                return;
            }
            visited.add(node);

            for (const child of node.children.values()) {
                ids.add(child.id);
                visit(child);
            }
        };

        visit(rootNode);
        return ids;
    }

    private rebuildIndexes(tree: Map<string, PropertyTreeNode>): void {
        const nodeById = new Map<string, PropertyTreeNode>();
        const visited = new Set<PropertyTreeNode>();

        const visitNode = (node: PropertyTreeNode) => {
            if (visited.has(node)) {
                return;
            }
            visited.add(node);

            nodeById.set(node.id, node);

            for (const child of node.children.values()) {
                visitNode(child);
            }
        };

        for (const rootNode of tree.values()) {
            visitNode(rootNode);
        }

        this.propertyNodeById = nodeById;
    }
}
