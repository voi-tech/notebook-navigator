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

import { STORAGE_KEYS } from '../../types';
import { localStorage } from '../../utils/localStorage';

// Persists minimal rebuild-notice state so a cache rebuild progress notice can be restored after an Obsidian restart.
export interface CacheRebuildNoticeState {
    // Number of indexable files at rebuild start (used as the progress bar max).
    total: number;
}

// Validates the vault-scoped localStorage payload before using it to drive UI.
function isCacheRebuildNoticeState(value: unknown): value is CacheRebuildNoticeState {
    if (value === null || typeof value !== 'object') {
        return false;
    }

    const record = value as Record<string, unknown>;
    if (typeof record.total !== 'number' || !Number.isFinite(record.total) || record.total < 0) {
        return false;
    }
    return true;
}

export function getCacheRebuildNoticeState(): CacheRebuildNoticeState | null {
    const stored = localStorage.get<unknown>(STORAGE_KEYS.cacheRebuildNoticeKey);
    if (!isCacheRebuildNoticeState(stored)) {
        return null;
    }
    return stored;
}

export function setCacheRebuildNoticeState(state: CacheRebuildNoticeState): void {
    localStorage.set(STORAGE_KEYS.cacheRebuildNoticeKey, state);
}

export function clearCacheRebuildNoticeState(): void {
    localStorage.remove(STORAGE_KEYS.cacheRebuildNoticeKey);
}
