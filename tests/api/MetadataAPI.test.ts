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
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MetadataAPI } from '../../src/api/modules/MetadataAPI';
import { DEFAULT_SETTINGS } from '../../src/settings/defaultSettings';
import type { NotebookNavigatorAPI } from '../../src/api/NotebookNavigatorAPI';
import type { NotebookNavigatorSettings } from '../../src/settings';
import type { IconString } from '../../src/api/types';
import { TFolder } from 'obsidian';

describe('MetadataAPI icon normalization', () => {
    let plugin: {
        settings: NotebookNavigatorSettings;
        saveSettingsAndUpdate: ReturnType<typeof vi.fn>;
    };
    let api: NotebookNavigatorAPI;
    let triggerMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        plugin = {
            settings: structuredClone(DEFAULT_SETTINGS),
            saveSettingsAndUpdate: vi.fn().mockResolvedValue(undefined)
        };
        triggerMock = vi.fn();

        api = {
            getPlugin: () => plugin,
            getApp: () =>
                ({
                    vault: {
                        getFolderByPath: () => null
                    }
                }) as unknown,
            trigger: triggerMock
        } as unknown as NotebookNavigatorAPI;
    });

    it('normalizes legacy lucide identifiers provided through the API', async () => {
        const metadataAPI = new MetadataAPI(api);
        const folder = new TFolder();
        folder.path = 'Folder';

        await metadataAPI.setFolderMeta(folder, {
            icon: 'lucide-sun' as unknown as IconString
        });

        expect(plugin.settings.folderIcons.Folder).toBe('sun');
        expect(plugin.saveSettingsAndUpdate).toHaveBeenCalled();
    });

    it('normalizes provider-prefixed identifiers provided through the API', async () => {
        const metadataAPI = new MetadataAPI(api);
        const folder = new TFolder();
        folder.path = 'Folder';

        await metadataAPI.setFolderMeta(folder, {
            icon: 'phosphor:ph-apple-logo' as IconString
        });

        expect(plugin.settings.folderIcons.Folder).toBe('phosphor:apple-logo');
    });

    it('normalizes property node ids when setting property metadata', async () => {
        const metadataAPI = new MetadataAPI(api);

        await metadataAPI.setPropertyMeta('key:Status=Done', {
            color: '#112233'
        });
        metadataAPI.updateFromSettings(plugin.settings);

        expect(plugin.settings.propertyColors['key:status=done']).toBe('#112233');
        expect(metadataAPI.getPropertyMeta('key:status=done')).toEqual({
            color: '#112233',
            backgroundColor: undefined,
            icon: undefined
        });
    });

    it('ignores invalid property node ids when setting property metadata', async () => {
        const metadataAPI = new MetadataAPI(api);

        await metadataAPI.setPropertyMeta('properties-root', {
            color: '#112233'
        });

        expect(plugin.settings.propertyColors['properties-root']).toBeUndefined();
        expect(plugin.saveSettingsAndUpdate).not.toHaveBeenCalled();
    });

    it('emits property-changed events when property metadata changes', () => {
        const metadataAPI = new MetadataAPI(api);

        const updatedSettings = structuredClone(plugin.settings);
        updatedSettings.propertyColors['key:status'] = '#334455';

        metadataAPI.updateFromSettings(updatedSettings);

        expect(triggerMock).toHaveBeenCalledWith('property-changed', {
            nodeId: 'key:status',
            metadata: {
                color: '#334455',
                backgroundColor: undefined,
                icon: undefined
            }
        });
    });

    it('emits property-changed events when property background metadata changes', () => {
        const metadataAPI = new MetadataAPI(api);

        const updatedSettings = structuredClone(plugin.settings);
        updatedSettings.propertyBackgroundColors['key:status'] = '#223344';

        metadataAPI.updateFromSettings(updatedSettings);

        expect(triggerMock).toHaveBeenCalledWith('property-changed', {
            nodeId: 'key:status',
            metadata: {
                color: undefined,
                backgroundColor: '#223344',
                icon: undefined
            }
        });
    });

    it('emits property-changed events when property icon metadata changes', () => {
        const metadataAPI = new MetadataAPI(api);

        const updatedSettings = structuredClone(plugin.settings);
        updatedSettings.propertyIcons['key:status'] = 'lucide:hash';

        metadataAPI.updateFromSettings(updatedSettings);

        expect(triggerMock).toHaveBeenCalledWith('property-changed', {
            nodeId: 'key:status',
            metadata: {
                color: undefined,
                backgroundColor: undefined,
                icon: 'lucide:hash'
            }
        });
    });
});
