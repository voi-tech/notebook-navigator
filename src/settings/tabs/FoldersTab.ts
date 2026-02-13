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

import { Platform, Setting } from 'obsidian';
import { strings } from '../../i18n';
import { isFolderNoteCreationPreference } from '../../types/folderNote';
import { isAlphaSortOrder } from '../types';
import type { SettingsTabContext } from './SettingsTabContext';
import { createSettingGroupFactory } from '../settingGroups';
import { addSettingSyncModeToggle } from '../syncModeToggle';
import { wireToggleSettingWithSubSettings } from '../subSettings';
import { FilePathInputSuggest } from '../../suggest/FilePathInputSuggest';
import { FOLDER_NOTE_NAME_PATTERN_PLACEHOLDER } from '../../utils/folderNoteName';
import { normalizeOptionalVaultFilePath } from '../../utils/pathUtils';

/** Renders the folders settings tab */
export function renderFoldersTab(context: SettingsTabContext): void {
    const { containerEl, plugin, addToggleSetting } = context;
    const createGroup = createSettingGroupFactory(containerEl);

    const topGroup = createGroup(undefined);

    if (!Platform.isMobile) {
        addToggleSetting(
            topGroup.addSetting,
            strings.settings.items.autoSelectFirstFileOnFocusChange.name,
            strings.settings.items.autoSelectFirstFileOnFocusChange.desc,
            () => plugin.settings.autoSelectFirstFileOnFocusChange,
            value => {
                plugin.settings.autoSelectFirstFileOnFocusChange = value;
            }
        );
    }

    addToggleSetting(
        topGroup.addSetting,
        strings.settings.items.autoExpandNavItems.name,
        strings.settings.items.autoExpandNavItems.desc,
        () => plugin.settings.autoExpandNavItems,
        value => {
            plugin.settings.autoExpandNavItems = value;
        }
    );

    if (!Platform.isMobile) {
        const springLoadedFoldersSetting = topGroup.addSetting(setting => {
            setting.setName(strings.settings.items.springLoadedFolders.name).setDesc(strings.settings.items.springLoadedFolders.desc);
        });
        const springLoadedFoldersSubSettings = wireToggleSettingWithSubSettings(
            springLoadedFoldersSetting,
            () => plugin.settings.springLoadedFolders,
            async value => {
                plugin.settings.springLoadedFolders = value;
                await plugin.saveSettingsAndUpdate();
            }
        );

        new Setting(springLoadedFoldersSubSettings)
            .setName(strings.settings.items.springLoadedFoldersInitialDelay.name)
            .setDesc(strings.settings.items.springLoadedFoldersInitialDelay.desc)
            .addSlider(slider =>
                slider
                    .setLimits(0.1, 2, 0.1)
                    .setValue(plugin.settings.springLoadedFoldersInitialDelay)
                    .setInstant(false)
                    .setDynamicTooltip()
                    .onChange(async value => {
                        plugin.settings.springLoadedFoldersInitialDelay = Math.round(value * 10) / 10;
                        await plugin.saveSettingsAndUpdate();
                    })
            );

        new Setting(springLoadedFoldersSubSettings)
            .setName(strings.settings.items.springLoadedFoldersSubsequentDelay.name)
            .setDesc(strings.settings.items.springLoadedFoldersSubsequentDelay.desc)
            .addSlider(slider =>
                slider
                    .setLimits(0.1, 2, 0.1)
                    .setValue(plugin.settings.springLoadedFoldersSubsequentDelay)
                    .setInstant(false)
                    .setDynamicTooltip()
                    .onChange(async value => {
                        plugin.settings.springLoadedFoldersSubsequentDelay = Math.round(value * 10) / 10;
                        await plugin.saveSettingsAndUpdate();
                    })
            );
    }

    const foldersGroup = createGroup(strings.settings.sections.folders);

    addToggleSetting(
        foldersGroup.addSetting,
        strings.settings.items.showFolderIcons.name,
        strings.settings.items.showFolderIcons.desc,
        () => plugin.settings.showFolderIcons,
        value => {
            plugin.settings.showFolderIcons = value;
        }
    );

    addToggleSetting(
        foldersGroup.addSetting,
        strings.settings.items.showRootFolder.name,
        strings.settings.items.showRootFolder.desc,
        () => plugin.settings.showRootFolder,
        value => {
            plugin.settings.showRootFolder = value;
        }
    );

    addToggleSetting(
        foldersGroup.addSetting,
        strings.settings.items.inheritFolderColors.name,
        strings.settings.items.inheritFolderColors.desc,
        () => plugin.settings.inheritFolderColors,
        value => {
            plugin.settings.inheritFolderColors = value;
        }
    );

    const folderSortOrderSetting = foldersGroup.addSetting(setting => {
        setting.setName(strings.settings.items.folderSortOrder.name).setDesc(strings.settings.items.folderSortOrder.desc);
        setting.addDropdown(dropdown => {
            dropdown
                .addOption('alpha-asc', strings.settings.items.folderSortOrder.options.alphaAsc)
                .addOption('alpha-desc', strings.settings.items.folderSortOrder.options.alphaDesc)
                .setValue(plugin.getFolderSortOrder())
                .onChange(value => {
                    if (!isAlphaSortOrder(value)) {
                        return;
                    }
                    plugin.setFolderSortOrder(value);
                });
        });
    });

    addSettingSyncModeToggle({ setting: folderSortOrderSetting, plugin, settingId: 'folderSortOrder' });

    const folderNotesGroup = createGroup(strings.settings.sections.folderNotes);

    const enableFolderNotesSetting = folderNotesGroup.addSetting(setting => {
        setting.setName(strings.settings.items.enableFolderNotes.name).setDesc(strings.settings.items.enableFolderNotes.desc);
    });
    const folderNotesSettingsEl = wireToggleSettingWithSubSettings(
        enableFolderNotesSetting,
        () => plugin.settings.enableFolderNotes,
        async value => {
            plugin.settings.enableFolderNotes = value;
            await plugin.saveSettingsAndUpdate();
        }
    );

    new Setting(folderNotesSettingsEl)
        .setName(strings.settings.items.folderNoteType.name)
        .setDesc(strings.settings.items.folderNoteType.desc)
        .addDropdown(dropdown => {
            dropdown
                .addOption('ask', strings.settings.items.folderNoteType.options.ask)
                .addOption('markdown', strings.settings.items.folderNoteType.options.markdown)
                .addOption('canvas', strings.settings.items.folderNoteType.options.canvas)
                .addOption('base', strings.settings.items.folderNoteType.options.base)
                .setValue(plugin.settings.folderNoteType)
                .onChange(async value => {
                    if (!isFolderNoteCreationPreference(value)) {
                        return;
                    }
                    plugin.settings.folderNoteType = value;
                    await plugin.saveSettingsAndUpdate();
                });
        });

    // Use context directly to satisfy eslint exhaustive-deps requirements
    context.createDebouncedTextSetting(
        folderNotesSettingsEl,
        strings.settings.items.folderNoteName.name,
        strings.settings.items.folderNoteName.desc,
        strings.settings.items.folderNoteName.placeholder,
        () => plugin.settings.folderNoteName,
        value => {
            plugin.settings.folderNoteName = value;
        }
    );

    context.createDebouncedTextSetting(
        folderNotesSettingsEl,
        strings.settings.items.folderNoteNamePattern.name,
        strings.settings.items.folderNoteNamePattern.desc,
        FOLDER_NOTE_NAME_PATTERN_PLACEHOLDER,
        () => plugin.settings.folderNoteNamePattern,
        value => {
            plugin.settings.folderNoteNamePattern = value;
        }
    );

    const folderNoteTemplateSetting = context.createDebouncedTextSetting(
        folderNotesSettingsEl,
        strings.settings.items.folderNoteTemplate.name,
        strings.settings.items.folderNoteTemplate.desc,
        '',
        () => plugin.settings.folderNoteTemplate ?? '',
        value => {
            plugin.settings.folderNoteTemplate = normalizeOptionalVaultFilePath(value);
        }
    );
    folderNoteTemplateSetting.controlEl.addClass('nn-setting-wide-input');
    const folderNoteTemplateInputEl = folderNoteTemplateSetting.controlEl.querySelector<HTMLInputElement>('input');
    if (folderNoteTemplateInputEl) {
        const templateSuggest = new FilePathInputSuggest(context.app, folderNoteTemplateInputEl, {
            getBaseFolder: () => plugin.settings.calendarTemplateFolder,
            includeFile: file => file.extension === 'md'
        });
        folderNoteTemplateInputEl.addEventListener('click', () => templateSuggest.open());
    }

    new Setting(folderNotesSettingsEl)
        .setName(strings.settings.items.openFolderNotesInNewTab.name)
        .setDesc(strings.settings.items.openFolderNotesInNewTab.desc)
        .addToggle(toggle =>
            toggle.setValue(plugin.settings.openFolderNotesInNewTab).onChange(async value => {
                plugin.settings.openFolderNotesInNewTab = value;
                await plugin.saveSettingsAndUpdate();
            })
        );

    new Setting(folderNotesSettingsEl)
        .setName(strings.settings.items.hideFolderNoteInList.name)
        .setDesc(strings.settings.items.hideFolderNoteInList.desc)
        .addToggle(toggle =>
            toggle.setValue(plugin.settings.hideFolderNoteInList).onChange(async value => {
                plugin.settings.hideFolderNoteInList = value;
                await plugin.saveSettingsAndUpdate();
            })
        );

    new Setting(folderNotesSettingsEl)
        .setName(strings.settings.items.pinCreatedFolderNote.name)
        .setDesc(strings.settings.items.pinCreatedFolderNote.desc)
        .addToggle(toggle =>
            toggle.setValue(plugin.settings.pinCreatedFolderNote).onChange(async value => {
                plugin.settings.pinCreatedFolderNote = value;
                await plugin.saveSettingsAndUpdate();
            })
        );
}
