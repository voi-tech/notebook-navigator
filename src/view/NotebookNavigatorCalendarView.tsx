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

import React from 'react';
import { Root, createRoot } from 'react-dom/client';
import { ItemView, WorkspaceLeaf } from 'obsidian';
import { SettingsProvider } from '../context/SettingsContext';
import { ServicesProvider } from '../context/ServicesContext';
import { CalendarRightSidebar } from '../components/CalendarRightSidebar';
import { NOTEBOOK_NAVIGATOR_ICON_ID } from '../constants/notebookNavigatorIcon';
import { strings } from '../i18n';
import NotebookNavigatorPlugin from '../main';
import { NOTEBOOK_NAVIGATOR_CALENDAR_VIEW } from '../types';
import { setupNotebookNavigatorViewContainer, teardownNotebookNavigatorViewContainer } from './NotebookNavigatorView';

export class NotebookNavigatorCalendarView extends ItemView {
    private readonly plugin: NotebookNavigatorPlugin;
    private root: Root | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: NotebookNavigatorPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType() {
        return NOTEBOOK_NAVIGATOR_CALENDAR_VIEW;
    }

    getDisplayText() {
        return strings.plugin.calendarViewName;
    }

    getIcon() {
        return NOTEBOOK_NAVIGATOR_ICON_ID;
    }

    async onOpen() {
        const container = this.containerEl.children[1];
        if (!(container instanceof HTMLElement)) {
            return;
        }

        setupNotebookNavigatorViewContainer(container);

        this.root = createRoot(container);
        this.root.render(
            <React.StrictMode>
                <SettingsProvider plugin={this.plugin}>
                    <ServicesProvider plugin={this.plugin}>
                        <CalendarRightSidebar />
                    </ServicesProvider>
                </SettingsProvider>
            </React.StrictMode>
        );
    }

    async onClose() {
        const container = this.containerEl.children[1];
        if (!(container instanceof HTMLElement)) {
            return;
        }

        this.root?.unmount();
        teardownNotebookNavigatorViewContainer(container);
        this.root = null;
    }
}
