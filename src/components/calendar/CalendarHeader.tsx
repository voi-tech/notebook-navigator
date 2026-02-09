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

import React from 'react';
import { strings } from '../../i18n';
import { ServiceIcon } from '../ServiceIcon';

type CalendarHeaderPeriodKind = 'month' | 'quarter' | 'year';

interface CalendarHeaderProps {
    monthLabel: string;
    yearLabel: string;
    quarterLabel: string;
    showYearInHeader: boolean;
    monthNotesEnabled: boolean;
    quarterNotesEnabled: boolean;
    yearNotesEnabled: boolean;
    showQuarter: boolean;
    hasMonthPeriodNote: boolean;
    hasQuarterPeriodNote: boolean;
    hasYearPeriodNote: boolean;
    showInlineMonthNavigation: boolean;
    showCompactQuarterInMonthRow: boolean;
    showHeaderPeriodDetails: boolean;
    showHeaderNavRow: boolean;
    showCompactHeaderInlineInfoButton: boolean;
    showInfoInNavRow: boolean;
    onNavigate: (delta: number) => void;
    onToday: () => void;
    onOpenHelp: () => void;
    onPeriodClick: (event: React.MouseEvent<HTMLElement>, kind: CalendarHeaderPeriodKind) => void;
    onPeriodContextMenu: (event: React.MouseEvent<HTMLElement>, kind: CalendarHeaderPeriodKind) => void;
}

export const CalendarHeader = React.memo(function CalendarHeader({
    monthLabel,
    yearLabel,
    quarterLabel,
    showYearInHeader,
    monthNotesEnabled,
    quarterNotesEnabled,
    yearNotesEnabled,
    showQuarter,
    hasMonthPeriodNote,
    hasQuarterPeriodNote,
    hasYearPeriodNote,
    showInlineMonthNavigation,
    showCompactQuarterInMonthRow,
    showHeaderPeriodDetails,
    showHeaderNavRow,
    showCompactHeaderInlineInfoButton,
    showInfoInNavRow,
    onNavigate,
    onToday,
    onOpenHelp,
    onPeriodClick,
    onPeriodContextMenu
}: CalendarHeaderProps) {
    const headerYearControl =
        showYearInHeader && yearNotesEnabled ? (
            <button
                type="button"
                className={[
                    'nn-navigation-calendar-period-button',
                    'nn-navigation-calendar-period-year',
                    hasYearPeriodNote ? 'has-period-note' : ''
                ]
                    .filter(Boolean)
                    .join(' ')}
                onClick={event => onPeriodClick(event, 'year')}
                onContextMenu={event => onPeriodContextMenu(event, 'year')}
            >
                {yearLabel}
            </button>
        ) : showYearInHeader ? (
            <span
                className="nn-navigation-calendar-period-label nn-navigation-calendar-period-year"
                onClick={event => onPeriodClick(event, 'year')}
                onContextMenu={event => onPeriodContextMenu(event, 'year')}
            >
                {yearLabel}
            </span>
        ) : null;

    const renderQuarterControl = (isInline: boolean) => {
        if (quarterNotesEnabled) {
            return (
                <button
                    type="button"
                    className={[
                        'nn-navigation-calendar-period-button',
                        'nn-navigation-calendar-quarter-button',
                        isInline ? 'nn-navigation-calendar-quarter-inline' : '',
                        hasQuarterPeriodNote ? 'has-period-note' : ''
                    ]
                        .filter(Boolean)
                        .join(' ')}
                    onClick={event => onPeriodClick(event, 'quarter')}
                    onContextMenu={event => onPeriodContextMenu(event, 'quarter')}
                >
                    <span aria-hidden="true">(</span>
                    {quarterLabel}
                    <span aria-hidden="true">)</span>
                </button>
            );
        }

        return (
            <span
                className={[
                    'nn-navigation-calendar-period-label',
                    'nn-navigation-calendar-quarter-label',
                    isInline ? 'nn-navigation-calendar-quarter-inline' : ''
                ]
                    .filter(Boolean)
                    .join(' ')}
                onClick={event => onPeriodClick(event, 'quarter')}
                onContextMenu={event => onPeriodContextMenu(event, 'quarter')}
            >
                <span aria-hidden="true">(</span>
                {quarterLabel}
                <span aria-hidden="true">)</span>
            </span>
        );
    };

    return (
        <div className="nn-navigation-calendar-header">
            <div
                className={[
                    'nn-navigation-calendar-month',
                    showInlineMonthNavigation ? 'has-inline-month-nav' : '',
                    showCompactHeaderInlineInfoButton ? 'has-inline-help' : ''
                ]
                    .filter(Boolean)
                    .join(' ')}
            >
                {showInlineMonthNavigation ? (
                    <button
                        type="button"
                        className="nn-navigation-calendar-nav-button nn-navigation-calendar-year-nav-button nn-navigation-calendar-inline-month-nav-prev"
                        aria-label={strings.common.previous}
                        onClick={() => onNavigate(-1)}
                    >
                        <ServiceIcon iconId="lucide-chevron-left" aria-hidden={true} />
                    </button>
                ) : null}
                <div className="nn-navigation-calendar-inline-month-center">
                    {monthNotesEnabled ? (
                        <button
                            type="button"
                            className={[
                                'nn-navigation-calendar-period-button',
                                'nn-navigation-calendar-period-month',
                                hasMonthPeriodNote ? 'has-period-note' : ''
                            ]
                                .filter(Boolean)
                                .join(' ')}
                            onClick={event => onPeriodClick(event, 'month')}
                            onContextMenu={event => onPeriodContextMenu(event, 'month')}
                        >
                            {monthLabel}
                        </button>
                    ) : (
                        <span
                            className="nn-navigation-calendar-period-label nn-navigation-calendar-period-month"
                            onClick={event => onPeriodClick(event, 'month')}
                            onContextMenu={event => onPeriodContextMenu(event, 'month')}
                        >
                            {monthLabel}
                        </span>
                    )}
                    {showCompactQuarterInMonthRow ? renderQuarterControl(true) : null}
                    {showCompactHeaderInlineInfoButton ? (
                        <button
                            type="button"
                            className="nn-navigation-calendar-nav-button nn-navigation-calendar-month-help nn-navigation-calendar-inline-help"
                            aria-label={strings.navigationCalendar.helpModal.title}
                            onClick={onOpenHelp}
                        >
                            <ServiceIcon iconId="info" aria-hidden={true} />
                        </button>
                    ) : null}
                </div>
                {showInlineMonthNavigation ? (
                    <button
                        type="button"
                        className="nn-navigation-calendar-nav-button nn-navigation-calendar-year-nav-button nn-navigation-calendar-inline-month-nav-next"
                        aria-label={strings.common.next}
                        onClick={() => onNavigate(1)}
                    >
                        <ServiceIcon iconId="lucide-chevron-right" aria-hidden={true} />
                    </button>
                ) : null}

                {showHeaderPeriodDetails ? headerYearControl : null}
                {showHeaderPeriodDetails && showQuarter ? renderQuarterControl(false) : null}
            </div>
            {showHeaderNavRow ? (
                <div className="nn-navigation-calendar-nav">
                    {showInfoInNavRow ? (
                        <button
                            type="button"
                            className={[
                                'nn-navigation-calendar-nav-button',
                                'nn-navigation-calendar-help',
                                'nn-navigation-calendar-help-inline'
                            ]
                                .filter(Boolean)
                                .join(' ')}
                            aria-label={strings.navigationCalendar.helpModal.title}
                            onClick={onOpenHelp}
                        >
                            <ServiceIcon iconId="info" aria-hidden={true} />
                        </button>
                    ) : null}
                    <button
                        type="button"
                        className="nn-navigation-calendar-nav-button nn-navigation-calendar-nav-prev"
                        aria-label={strings.common.previous}
                        onClick={() => onNavigate(-1)}
                    >
                        <ServiceIcon iconId="lucide-chevron-left" aria-hidden={true} />
                    </button>
                    <button type="button" className="nn-navigation-calendar-today" aria-label={strings.dateGroups.today} onClick={onToday}>
                        {strings.dateGroups.today}
                    </button>
                    <button
                        type="button"
                        className="nn-navigation-calendar-nav-button nn-navigation-calendar-nav-next"
                        aria-label={strings.common.next}
                        onClick={() => onNavigate(1)}
                    >
                        <ServiceIcon iconId="lucide-chevron-right" aria-hidden={true} />
                    </button>
                </div>
            ) : null}
        </div>
    );
});
