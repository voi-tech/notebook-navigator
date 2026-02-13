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

import { MenuItem } from 'obsidian';
import type { PropertyMenuBuilderParams } from './menuTypes';
import { strings } from '../../i18n';
import { ItemType } from '../../types';
import { setAsyncOnClick, tryCreateSubmenu } from './menuAsyncHelpers';
import { addShortcutRenameMenuItem } from './shortcutRenameMenuItem';
import { addStyleMenu } from './styleMenuBuilder';
import { resolveUXIconForMenu } from '../uxIcons';
import { normalizePropertyNodeId, parsePropertyNodeId } from '../propertyTree';

function resolvePropertyMenuLabel(params: { propertyNodeId: string; propertyNodeName?: string; keyNodeName?: string }): string {
    const { propertyNodeId, propertyNodeName, keyNodeName } = params;
    const parsed = parsePropertyNodeId(propertyNodeId);
    if (!parsed) {
        return propertyNodeName ?? propertyNodeId;
    }

    if (!parsed.valuePath) {
        return propertyNodeName ?? parsed.key;
    }

    const keyLabel = keyNodeName ?? parsed.key;
    const valueLabel = propertyNodeName ?? parsed.valuePath;
    return `${keyLabel} = ${valueLabel}`;
}

/**
 * Builds the context menu for a property key/value node.
 */
export function buildPropertyMenu(params: PropertyMenuBuilderParams): void {
    const { propertyNodeId, menu, services, settings, options } = params;
    const { app, metadataService, propertyTreeService, isMobile } = services;

    const normalizedNodeId = normalizePropertyNodeId(propertyNodeId);
    if (!normalizedNodeId) {
        return;
    }

    const propertyNode = propertyTreeService?.findNode(normalizedNodeId);
    const keyNode = propertyNode?.kind === 'key' ? propertyNode : propertyNode ? propertyTreeService?.getKeyNode(propertyNode.key) : null;
    const label = resolvePropertyMenuLabel({
        propertyNodeId: normalizedNodeId,
        propertyNodeName: propertyNode?.name,
        keyNodeName: keyNode?.name
    });

    if (isMobile) {
        menu.addItem((item: MenuItem) => {
            item.setTitle(label).setIsLabel(true);
        });
        menu.addSeparator();
    }

    if (settings.showPropertyIcons) {
        menu.addItem((item: MenuItem) => {
            setAsyncOnClick(item.setTitle(strings.contextMenu.tag.changeIcon).setIcon('lucide-image'), async () => {
                const { IconPickerModal } = await import('../../modals/IconPickerModal');
                const modal = new IconPickerModal(app, metadataService, normalizedNodeId, ItemType.PROPERTY, { titleOverride: label });
                modal.open();
            });
        });
    }

    menu.addItem((item: MenuItem) => {
        setAsyncOnClick(item.setTitle(strings.contextMenu.tag.changeColor).setIcon('lucide-palette'), async () => {
            const { ColorPickerModal } = await import('../../modals/ColorPickerModal');
            const modal = new ColorPickerModal(app, metadataService, normalizedNodeId, ItemType.PROPERTY, 'foreground', {
                titleOverride: label
            });
            modal.open();
        });
    });

    menu.addItem((item: MenuItem) => {
        setAsyncOnClick(item.setTitle(strings.contextMenu.tag.changeBackground).setIcon('lucide-paint-bucket'), async () => {
            const { ColorPickerModal } = await import('../../modals/ColorPickerModal');
            const modal = new ColorPickerModal(app, metadataService, normalizedNodeId, ItemType.PROPERTY, 'background', {
                titleOverride: label
            });
            modal.open();
        });
    });

    if (typeof MenuItem.prototype.setSubmenu === 'function') {
        menu.addItem((item: MenuItem) => {
            const currentOverride = metadataService.getPropertyChildSortOrderOverride(normalizedNodeId);
            const effectiveOrder = currentOverride ?? settings.propertySortOrder;
            const sortIcon = currentOverride
                ? effectiveOrder.endsWith('-desc')
                    ? 'lucide-sort-desc'
                    : 'lucide-sort-asc'
                : 'lucide-sliders-horizontal';

            const sortOrderSubmenu = tryCreateSubmenu(item);
            if (!sortOrderSubmenu) {
                item.setTitle(strings.paneHeader.changeSortOrder).setIcon(sortIcon).setDisabled(true);
                return;
            }

            const globalDefaultLabel = (() => {
                switch (settings.propertySortOrder) {
                    case 'alpha-desc':
                        return strings.settings.items.propertySortOrder.options.alphaDesc;
                    case 'frequency-asc':
                        return strings.settings.items.propertySortOrder.options.lowToHigh;
                    case 'frequency-desc':
                        return strings.settings.items.propertySortOrder.options.highToLow;
                    case 'alpha-asc':
                    default:
                        return strings.settings.items.propertySortOrder.options.alphaAsc;
                }
            })();

            item.setTitle(strings.paneHeader.changeSortOrder).setIcon(sortIcon);

            sortOrderSubmenu.addItem(subItem => {
                subItem.setTitle(`${strings.folderAppearance.defaultLabel} (${globalDefaultLabel})`).setChecked(!currentOverride);
                setAsyncOnClick(subItem, async () => {
                    await metadataService.removePropertyChildSortOrderOverride(normalizedNodeId);
                    app.workspace.requestSaveLayout();
                });
            });

            sortOrderSubmenu.addSeparator();

            sortOrderSubmenu.addItem(subItem => {
                subItem.setTitle(strings.settings.items.propertySortOrder.options.alphaAsc).setChecked(currentOverride === 'alpha-asc');
                setAsyncOnClick(subItem, async () => {
                    await metadataService.setPropertyChildSortOrderOverride(normalizedNodeId, 'alpha-asc');
                    app.workspace.requestSaveLayout();
                });
            });

            sortOrderSubmenu.addItem(subItem => {
                subItem.setTitle(strings.settings.items.propertySortOrder.options.alphaDesc).setChecked(currentOverride === 'alpha-desc');
                setAsyncOnClick(subItem, async () => {
                    await metadataService.setPropertyChildSortOrderOverride(normalizedNodeId, 'alpha-desc');
                    app.workspace.requestSaveLayout();
                });
            });
        });
    }

    const propertyIcon = metadataService.getPropertyIcon(normalizedNodeId);
    const propertyColorData = metadataService.getPropertyColorData(normalizedNodeId);
    const propertyColor = propertyColorData.color;
    const propertyBackgroundColor = propertyColorData.background;
    const directPropertyIcon = settings.propertyIcons?.[normalizedNodeId];
    const directPropertyColor = settings.propertyColors?.[normalizedNodeId];
    const directPropertyBackground = settings.propertyBackgroundColors?.[normalizedNodeId];

    addStyleMenu({
        menu,
        styleData: {
            icon: propertyIcon,
            color: propertyColor,
            background: propertyBackgroundColor
        },
        hasIcon: settings.showPropertyIcons,
        hasColor: true,
        hasBackground: true,
        applyStyle: async clipboard => {
            const { icon, color, background } = clipboard;
            const actions: Promise<void>[] = [];

            if (icon) {
                actions.push(metadataService.setPropertyIcon(normalizedNodeId, icon));
            }
            if (color) {
                actions.push(metadataService.setPropertyColor(normalizedNodeId, color));
            }
            if (background) {
                actions.push(metadataService.setPropertyBackgroundColor(normalizedNodeId, background));
            }

            await Promise.all(actions);
        },
        removeIcon: directPropertyIcon ? async () => metadataService.removePropertyIcon(normalizedNodeId) : undefined,
        removeColor: directPropertyColor ? async () => metadataService.removePropertyColor(normalizedNodeId) : undefined,
        removeBackground: directPropertyBackground ? async () => metadataService.removePropertyBackgroundColor(normalizedNodeId) : undefined
    });

    const disableNavigationSeparatorActions = Boolean(options?.disableNavigationSeparatorActions);
    const shouldAddShortcutSectionSeparator = Boolean(services.shortcuts) || !disableNavigationSeparatorActions;
    if (shouldAddShortcutSectionSeparator) {
        menu.addSeparator();
    }

    if (services.shortcuts) {
        const { addPropertyShortcut, propertyShortcutKeysByNodeId, removeShortcut, renameShortcut, shortcutMap } = services.shortcuts;
        const existingShortcutKey = propertyShortcutKeysByNodeId.get(normalizedNodeId);

        if (existingShortcutKey) {
            const existingShortcut = shortcutMap.get(existingShortcutKey);
            const defaultLabel = label;

            addShortcutRenameMenuItem({
                app,
                menu,
                shortcutKey: existingShortcutKey,
                defaultLabel,
                existingShortcut,
                title: strings.shortcuts.rename,
                placeholder: strings.searchInput.shortcutNamePlaceholder,
                renameShortcut
            });
        }

        menu.addItem((item: MenuItem) => {
            if (existingShortcutKey) {
                setAsyncOnClick(
                    item
                        .setTitle(strings.shortcuts.remove)
                        .setIcon(resolveUXIconForMenu(settings.interfaceIcons, 'nav-shortcuts', 'lucide-star-off')),
                    async () => {
                        await removeShortcut(existingShortcutKey);
                    }
                );
            } else {
                setAsyncOnClick(
                    item
                        .setTitle(strings.shortcuts.add)
                        .setIcon(resolveUXIconForMenu(settings.interfaceIcons, 'nav-shortcuts', 'lucide-star')),
                    async () => {
                        await addPropertyShortcut(normalizedNodeId);
                    }
                );
            }
        });
    }

    if (!disableNavigationSeparatorActions) {
        const propertySeparatorTarget = { type: 'property', nodeId: normalizedNodeId } as const;
        const hasSeparator = metadataService.hasNavigationSeparator(propertySeparatorTarget);

        menu.addItem((item: MenuItem) => {
            const title = hasSeparator ? strings.contextMenu.navigation.removeSeparator : strings.contextMenu.navigation.addSeparator;
            setAsyncOnClick(item.setTitle(title).setIcon('lucide-separator-horizontal'), async () => {
                if (hasSeparator) {
                    await metadataService.removeNavigationSeparator(propertySeparatorTarget);
                    return;
                }
                await metadataService.addNavigationSeparator(propertySeparatorTarget);
            });
        });
    }
}
