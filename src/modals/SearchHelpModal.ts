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

import { App, Modal } from 'obsidian';
import { strings } from '../i18n';

const INLINE_CODE_PATTERN = /`([^`]+)`/g;

// Appends text to a container, converting backtick-wrapped segments into <code> elements
const appendInlineCodeText = (container: HTMLElement, value: string): void => {
    if (!value) {
        return;
    }

    let currentIndex = 0;

    for (const match of value.matchAll(INLINE_CODE_PATTERN)) {
        const matchText = match[0];
        const codeValue = match[1];
        if (!matchText || codeValue === undefined) {
            continue;
        }

        const matchIndex = match.index ?? -1;
        if (matchIndex === -1) {
            break;
        }

        if (matchIndex > currentIndex) {
            container.appendText(value.slice(currentIndex, matchIndex));
        }

        const codeEl = container.createEl('code');
        codeEl.textContent = codeValue;
        currentIndex = matchIndex + matchText.length;
    }

    if (currentIndex < value.length) {
        container.appendText(value.slice(currentIndex));
    }
};

export class SearchHelpModal extends Modal {
    constructor(app: App) {
        super(app);
        this.modalEl.addClass('nn-search-help-modal');
        this.titleEl.setText(strings.searchInput.searchHelpTitle);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();

        const scrollEl = contentEl.createDiv({ cls: 'nn-search-help-scroll' });
        scrollEl.createEl('p', { text: strings.searchInput.searchHelpModal.intro });
        const switchingEl = scrollEl.createEl('p');
        switchingEl.createEl('strong', { text: strings.searchInput.searchHelpModal.introSwitching });

        const { fileNames, tags, dates, omnisearch } = strings.searchInput.searchHelpModal.sections;
        const sections = [fileNames, tags, dates, omnisearch];

        for (const section of sections) {
            scrollEl.createEl('h3', { text: section.title });
            const listEl = scrollEl.createEl('ul');

            for (const itemText of section.items) {
                const item = listEl.createEl('li');
                appendInlineCodeText(item, itemText);
            }
        }
    }

    onClose(): void {
        this.modalEl.removeClass('nn-search-help-modal');
        this.contentEl.empty();
    }
}
