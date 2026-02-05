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

// Determines evaluation mode for search tokens (filter uses AND for all, tag uses expression tree)
export type FilterMode = 'filter' | 'tag';

// Logical operator for combining tag filter expressions
export type InclusionOperator = 'AND' | 'OR';

// Date field target for @c:/@m: prefix filters (default uses sort-based resolution)
type DateFilterField = 'default' | 'created' | 'modified';

// Locale-based date component order for ambiguous day/month parsing
type DayMonthOrder = 'DMY' | 'MDY';

interface DateFilterRange {
    field: DateFilterField;
    /** Inclusive lower bound in milliseconds since epoch (local time). */
    startMs: number | null;
    /** Exclusive upper bound in milliseconds since epoch (local time). */
    endMs: number | null;
}

// Operands in a tag filter expression tree
type TagExpressionOperand =
    | {
          kind: 'tag';
          value: string;
      }
    | {
          kind: 'notTag';
          value: string;
      }
    | {
          kind: 'requireTagged';
      }
    | {
          kind: 'untagged';
      };

// Tokens in a tag filter expression (operands and operators)
type TagExpressionToken =
    | TagExpressionOperand
    | {
          kind: 'operator';
          operator: InclusionOperator;
      };

/**
 * Tokens extracted from a filter search query.
 */
export interface FilterSearchTokens {
    mode: FilterMode;
    expression: TagExpressionToken[];
    hasInclusions: boolean;
    requiresTags: boolean;
    allRequireTags: boolean;
    includedTagTokens: string[];
    nameTokens: string[];
    tagTokens: string[];
    dateRanges: DateFilterRange[];
    requireTagged: boolean;
    includeUntagged: boolean;
    excludeNameTokens: string[];
    excludeTagTokens: string[];
    excludeDateRanges: DateFilterRange[];
    excludeTagged: boolean;
}

// Default empty token set returned for blank queries
const EMPTY_TOKENS: FilterSearchTokens = {
    mode: 'filter',
    expression: [],
    hasInclusions: false,
    requiresTags: false,
    allRequireTags: false,
    includedTagTokens: [],
    nameTokens: [],
    tagTokens: [],
    dateRanges: [],
    requireTagged: false,
    includeUntagged: false,
    excludeNameTokens: [],
    excludeTagTokens: [],
    excludeDateRanges: [],
    excludeTagged: false
};

// Precedence values for expression evaluation (higher number binds tighter)
const OPERATOR_PRECEDENCE: Record<InclusionOperator, number> = {
    AND: 2,
    OR: 1
};

// Set of recognized connector words in search queries
const CONNECTOR_TOKEN_SET = new Set(['and', 'or']);

// Checks if a tag token matches a lowercase tag path (exact or descendant)
const tagMatchesToken = (tagPath: string, token: string): boolean => {
    if (!tagPath || !token) {
        return false;
    }
    return tagPath === token || tagPath.startsWith(`${token}/`);
};

// Intermediate token representation during classification
type ClassifiedToken =
    | {
          kind: 'operator';
          operator: InclusionOperator;
      }
    | {
          kind: 'tag';
          value: string | null;
      }
    | {
          kind: 'tagNegation';
          value: string | null;
      }
    | {
          kind: 'date';
          range: DateFilterRange;
      }
    | {
          kind: 'dateNegation';
          range: DateFilterRange;
      }
    | {
          kind: 'name';
          value: string;
      }
    | {
          kind: 'nameNegation';
          value: string;
      };

// Result of classifying raw string tokens into typed tokens
interface TokenClassificationResult {
    tokens: ClassifiedToken[];
    hasTagOperand: boolean;
    hasNonTagOperand: boolean;
    hasInvalidToken: boolean;
}

// Checks if a token set can use tag expression mode
const canUseTagMode = (classification: TokenClassificationResult): boolean => {
    return classification.hasTagOperand && !classification.hasNonTagOperand && !classification.hasInvalidToken;
};

// Recognized relative date keywords for @today, @yesterday, etc.
export const DATE_FILTER_RELATIVE_KEYWORDS = ['today', 'yesterday', 'last7d', 'last30d', 'thisweek', 'thismonth'] as const;
const DATE_FILTER_RELATIVE_KEYWORD_SET = new Set<string>(DATE_FILTER_RELATIVE_KEYWORDS);

// Extracts optional c:/m:/created:/modified: prefix from a date filter token
export const parseDateFieldPrefix = (value: string): { field: DateFilterField; prefix: string; remainder: string } => {
    if (!value) {
        return { field: 'default', prefix: '', remainder: '' };
    }

    const lower = value.toLowerCase();

    if (lower.startsWith('c:')) {
        return { field: 'created', prefix: 'c:', remainder: value.slice(2) };
    }
    if (lower.startsWith('m:')) {
        return { field: 'modified', prefix: 'm:', remainder: value.slice(2) };
    }
    if (lower.startsWith('created:')) {
        return { field: 'created', prefix: 'created:', remainder: value.slice('created:'.length) };
    }
    if (lower.startsWith('modified:')) {
        return { field: 'modified', prefix: 'modified:', remainder: value.slice('modified:'.length) };
    }

    return { field: 'default', prefix: '', remainder: value };
};

// Cached result of locale-based day/month order detection
let cachedDayMonthOrder: DayMonthOrder | null = null;

// Detects whether the user's locale prefers month-day-year or day-month-year ordering
const resolveDayMonthOrder = (): DayMonthOrder => {
    if (cachedDayMonthOrder) {
        return cachedDayMonthOrder;
    }

    try {
        const parts = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(
            new Date(2020, 11, 31)
        );
        const yearIndex = parts.findIndex(part => part.type === 'year');
        const monthIndex = parts.findIndex(part => part.type === 'month');
        const dayIndex = parts.findIndex(part => part.type === 'day');

        const yearLast = yearIndex !== -1 && monthIndex !== -1 && dayIndex !== -1 && yearIndex > monthIndex && yearIndex > dayIndex;
        if (yearLast && monthIndex < dayIndex) {
            cachedDayMonthOrder = 'MDY';
            return cachedDayMonthOrder;
        }
    } catch {
        // Fallback below.
    }

    cachedDayMonthOrder = 'DMY';
    return cachedDayMonthOrder;
};

// Creates a timestamp range for a single calendar day (start inclusive, end exclusive)
const createLocalDayRange = (year: number, month: number, day: number): { startMs: number; endMs: number } | null => {
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
        return null;
    }

    if (year < 1000 || year > 9999) {
        return null;
    }
    if (month < 1 || month > 12) {
        return null;
    }
    if (day < 1 || day > 31) {
        return null;
    }

    const start = new Date(year, month - 1, day);
    if (start.getFullYear() !== year || start.getMonth() !== month - 1 || start.getDate() !== day || Number.isNaN(start.getTime())) {
        return null;
    }

    const end = new Date(year, month - 1, day + 1);
    if (Number.isNaN(end.getTime())) {
        return null;
    }

    return { startMs: start.getTime(), endMs: end.getTime() };
};

// Creates a timestamp range spanning an entire calendar month
const createLocalMonthRange = (year: number, month: number): { startMs: number; endMs: number } | null => {
    if (!Number.isFinite(year) || !Number.isFinite(month)) {
        return null;
    }

    if (year < 1000 || year > 9999) {
        return null;
    }
    if (month < 1 || month > 12) {
        return null;
    }

    const start = new Date(year, month - 1, 1);
    if (start.getFullYear() !== year || start.getMonth() !== month - 1 || start.getDate() !== 1 || Number.isNaN(start.getTime())) {
        return null;
    }

    const end = new Date(year, month, 1);
    if (Number.isNaN(end.getTime())) {
        return null;
    }

    return { startMs: start.getTime(), endMs: end.getTime() };
};

// Creates a timestamp range spanning an entire calendar quarter (Q1-Q4)
const createLocalQuarterRange = (year: number, quarter: number): { startMs: number; endMs: number } | null => {
    if (!Number.isFinite(year) || !Number.isFinite(quarter)) {
        return null;
    }

    if (year < 1000 || year > 9999) {
        return null;
    }
    if (quarter < 1 || quarter > 4) {
        return null;
    }

    const startMonthIndex = (quarter - 1) * 3;
    const start = new Date(year, startMonthIndex, 1);
    if (start.getFullYear() !== year || start.getMonth() !== startMonthIndex || start.getDate() !== 1 || Number.isNaN(start.getTime())) {
        return null;
    }

    const end = new Date(year, startMonthIndex + 3, 1);
    if (Number.isNaN(end.getTime())) {
        return null;
    }

    return { startMs: start.getTime(), endMs: end.getTime() };
};

// Creates a timestamp range spanning an entire calendar year
const createLocalYearRange = (year: number): { startMs: number; endMs: number } | null => {
    if (!Number.isFinite(year)) {
        return null;
    }

    if (year < 1000 || year > 9999) {
        return null;
    }

    const start = new Date(year, 0, 1);
    if (start.getFullYear() !== year || start.getMonth() !== 0 || start.getDate() !== 1 || Number.isNaN(start.getTime())) {
        return null;
    }

    const end = new Date(year + 1, 0, 1);
    if (Number.isNaN(end.getTime())) {
        return null;
    }

    return { startMs: start.getTime(), endMs: end.getTime() };
};

// Returns the Monday at 00:00 local time that starts ISO week 1 of the given year
const getIsoWeek1Start = (isoYear: number): Date | null => {
    if (!Number.isFinite(isoYear)) {
        return null;
    }
    if (isoYear < 1000 || isoYear > 9999) {
        return null;
    }

    // ISO week 1 is the week containing January 4. This returns the local-time Monday at the start of ISO week 1.
    const jan4 = new Date(isoYear, 0, 4);
    if (Number.isNaN(jan4.getTime())) {
        return null;
    }

    const diffToMonday = (jan4.getDay() + 6) % 7; // Monday = 0
    const monday = new Date(jan4);
    monday.setDate(monday.getDate() - diffToMonday);
    if (Number.isNaN(monday.getTime())) {
        return null;
    }

    return monday;
};

// Returns the number of ISO weeks in the given ISO year (52 or 53)
const getIsoWeeksInYear = (isoYear: number): number | null => {
    const start = getIsoWeek1Start(isoYear);
    const end = getIsoWeek1Start(isoYear + 1);
    if (!start || !end) {
        return null;
    }

    const startDayUtc = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
    const endDayUtc = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
    const diffDays = Math.round((endDayUtc - startDayUtc) / (24 * 60 * 60 * 1000));
    if (diffDays <= 0 || diffDays % 7 !== 0) {
        return null;
    }

    const weeks = diffDays / 7;
    return weeks >= 52 && weeks <= 53 ? weeks : null;
};

// Creates a timestamp range spanning an entire ISO week (Monday through Sunday)
const createLocalIsoWeekRange = (isoYear: number, isoWeek: number): { startMs: number; endMs: number } | null => {
    if (!Number.isFinite(isoYear) || !Number.isFinite(isoWeek)) {
        return null;
    }

    if (isoYear < 1000 || isoYear > 9999) {
        return null;
    }
    if (isoWeek < 1 || isoWeek > 53) {
        return null;
    }

    const isoWeeksInYear = getIsoWeeksInYear(isoYear);
    if (!isoWeeksInYear || isoWeek > isoWeeksInYear) {
        return null;
    }

    const week1Start = getIsoWeek1Start(isoYear);
    if (!week1Start) {
        return null;
    }

    const start = new Date(week1Start);
    start.setDate(start.getDate() + (isoWeek - 1) * 7);
    if (Number.isNaN(start.getTime())) {
        return null;
    }

    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    if (Number.isNaN(end.getTime())) {
        return null;
    }

    return { startMs: start.getTime(), endMs: end.getTime() };
};

// Parses ambiguous day/month/year values using locale-aware ordering when both interpretations are valid
const parseDayMonthYear = (first: number, second: number, year: number): { startMs: number; endMs: number } | null => {
    const dmy = createLocalDayRange(year, second, first);
    const mdy = createLocalDayRange(year, first, second);

    if (dmy && !mdy) {
        return dmy;
    }
    if (mdy && !dmy) {
        return mdy;
    }
    if (!dmy || !mdy) {
        return null;
    }

    return resolveDayMonthOrder() === 'MDY' ? mdy : dmy;
};

// Parses a date string representing a specific day in various formats (YYYY-MM-DD, DD/MM/YYYY, etc.)
const parseDayToken = (value: string): { startMs: number; endMs: number } | null => {
    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }

    const ymdSeparator = trimmed.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
    if (ymdSeparator) {
        const year = Number(ymdSeparator[1]);
        const month = Number(ymdSeparator[2]);
        const day = Number(ymdSeparator[3]);
        return createLocalDayRange(year, month, day);
    }

    const ymdCompact = trimmed.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (ymdCompact) {
        const year = Number(ymdCompact[1]);
        const month = Number(ymdCompact[2]);
        const day = Number(ymdCompact[3]);
        return createLocalDayRange(year, month, day);
    }

    const dayMonthYearSeparator = trimmed.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
    if (dayMonthYearSeparator) {
        const first = Number(dayMonthYearSeparator[1]);
        const second = Number(dayMonthYearSeparator[2]);
        const year = Number(dayMonthYearSeparator[3]);
        return parseDayMonthYear(first, second, year);
    }

    const dayMonthYearCompact = trimmed.match(/^(\d{2})(\d{2})(\d{4})$/);
    if (dayMonthYearCompact) {
        const first = Number(dayMonthYearCompact[1]);
        const second = Number(dayMonthYearCompact[2]);
        const year = Number(dayMonthYearCompact[3]);
        return parseDayMonthYear(first, second, year);
    }

    return null;
};

// Parses a date string into a timestamp range (year, month, quarter, week, or day granularity)
const parseDateToken = (value: string): { startMs: number; endMs: number } | null => {
    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }

    const yearOnly = trimmed.match(/^(\d{4})$/);
    if (yearOnly) {
        const year = Number(yearOnly[1]);
        return createLocalYearRange(year);
    }

    const yearMonthSeparator = trimmed.match(/^(\d{4})[-/.](\d{1,2})$/);
    if (yearMonthSeparator) {
        const year = Number(yearMonthSeparator[1]);
        const month = Number(yearMonthSeparator[2]);
        return createLocalMonthRange(year, month);
    }

    const yearMonthCompact = trimmed.match(/^(\d{4})(\d{2})$/);
    if (yearMonthCompact) {
        const year = Number(yearMonthCompact[1]);
        const month = Number(yearMonthCompact[2]);
        return createLocalMonthRange(year, month);
    }

    const yearQuarter = trimmed.match(/^(\d{4})[-/.]?q([1-4])$/);
    if (yearQuarter) {
        const year = Number(yearQuarter[1]);
        const quarter = Number(yearQuarter[2]);
        return createLocalQuarterRange(year, quarter);
    }

    const yearWeek = trimmed.match(/^(\d{4})[-/.]?w(\d{1,2})$/);
    if (yearWeek) {
        const year = Number(yearWeek[1]);
        const week = Number(yearWeek[2]);
        return createLocalIsoWeekRange(year, week);
    }

    return parseDayToken(trimmed);
};

// Converts a relative date keyword (today, yesterday, last7d, etc.) into a timestamp range
const resolveRelativeDateRange = (keyword: string): { startMs: number; endMs: number } | null => {
    if (!keyword) {
        return null;
    }

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);

    switch (keyword) {
        case 'today':
            return { startMs: todayStart.getTime(), endMs: tomorrowStart.getTime() };
        case 'yesterday': {
            const yesterdayStart = new Date(todayStart);
            yesterdayStart.setDate(yesterdayStart.getDate() - 1);
            return { startMs: yesterdayStart.getTime(), endMs: todayStart.getTime() };
        }
        case 'last7d': {
            const start = new Date(todayStart);
            start.setDate(start.getDate() - 6);
            return { startMs: start.getTime(), endMs: tomorrowStart.getTime() };
        }
        case 'last30d': {
            const start = new Date(todayStart);
            start.setDate(start.getDate() - 29);
            return { startMs: start.getTime(), endMs: tomorrowStart.getTime() };
        }
        case 'thisweek': {
            const start = new Date(todayStart);
            const day = start.getDay(); // 0 = Sunday
            const diff = (day + 6) % 7; // Monday = 0
            start.setDate(start.getDate() - diff);
            const end = new Date(start);
            end.setDate(end.getDate() + 7);
            return { startMs: start.getTime(), endMs: end.getTime() };
        }
        case 'thismonth': {
            const start = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);
            const end = new Date(todayStart.getFullYear(), todayStart.getMonth() + 1, 1);
            return { startMs: start.getTime(), endMs: end.getTime() };
        }
    }

    return null;
};

// Parses a complete @-prefixed date filter token into a DateFilterRange
const parseDateFilterRange = (token: string): DateFilterRange | null => {
    if (!token.startsWith('@')) {
        return null;
    }

    const raw = token.slice(1);
    const { field, remainder: rawRemainder } = parseDateFieldPrefix(raw);
    const remainder = rawRemainder.trim().toLowerCase();
    if (!remainder) {
        return null;
    }

    if (DATE_FILTER_RELATIVE_KEYWORD_SET.has(remainder)) {
        const relative = resolveRelativeDateRange(remainder);
        if (!relative) {
            return null;
        }
        return { field, startMs: relative.startMs, endMs: relative.endMs };
    }

    const rangeDelimiter = remainder.indexOf('..');
    if (rangeDelimiter !== -1) {
        const left = remainder.slice(0, rangeDelimiter).trim();
        const right = remainder.slice(rangeDelimiter + 2).trim();

        if (!left && !right) {
            return null;
        }

        const leftDay = left ? parseDateToken(left) : null;
        const rightDay = right ? parseDateToken(right) : null;

        if (left && !leftDay) {
            return null;
        }
        if (right && !rightDay) {
            return null;
        }

        const startMs = leftDay ? leftDay.startMs : null;
        const endMs = rightDay ? rightDay.endMs : null;

        if (startMs !== null && endMs !== null && startMs >= endMs) {
            return null;
        }

        return { field, startMs, endMs };
    }

    const day = parseDateToken(remainder);
    if (!day) {
        return null;
    }

    return { field, startMs: day.startMs, endMs: day.endMs };
};

// Checks if a token looks like a date filter (starts with @ followed by digits, dots, or relative keywords)
const isDateFilterCandidate = (token: string): boolean => {
    if (!token.startsWith('@')) {
        return false;
    }

    const raw = token.slice(1);
    const { remainder } = parseDateFieldPrefix(raw);
    const normalized = remainder.trim().toLowerCase();
    if (!normalized) {
        return true;
    }

    const first = normalized.charAt(0);
    if (first === '.' || (first >= '0' && first <= '9')) {
        return true;
    }

    for (const keyword of DATE_FILTER_RELATIVE_KEYWORDS) {
        if (keyword.startsWith(normalized)) {
            return true;
        }
    }

    return false;
};

// Parses raw tokens into classified tokens with metadata
const classifyRawTokens = (rawTokens: string[]): TokenClassificationResult => {
    const tokens: ClassifiedToken[] = [];
    let hasTagOperand = false;
    let hasNonTagOperand = false;
    let hasInvalidToken = false;

    for (const token of rawTokens) {
        if (!token) {
            continue;
        }

        if (token === 'and') {
            tokens.push({ kind: 'operator', operator: 'AND' });
            continue;
        }

        if (token === 'or') {
            tokens.push({ kind: 'operator', operator: 'OR' });
            continue;
        }

        if (token.startsWith('!')) {
            const negatedToken = token.slice(1);
            if (!negatedToken) {
                hasInvalidToken = true;
                continue;
            }

            if (negatedToken.startsWith('@')) {
                if (isDateFilterCandidate(negatedToken)) {
                    // Only commit to a date filter when parsing succeeds. Partial/invalid date fragments are ignored
                    // so they don't affect filtering until the token is complete.
                    const range = parseDateFilterRange(negatedToken);
                    if (range) {
                        tokens.push({ kind: 'dateNegation', range });
                    }
                    continue;
                }

                hasNonTagOperand = true;
                tokens.push({ kind: 'nameNegation', value: negatedToken });
                continue;
            }

            if (negatedToken.startsWith('#')) {
                const tagValue = negatedToken.slice(1);
                tokens.push({ kind: 'tagNegation', value: tagValue.length > 0 ? tagValue : null });
                hasTagOperand = true;
                continue;
            }

            hasNonTagOperand = true;
            tokens.push({ kind: 'nameNegation', value: negatedToken });
            continue;
        }

        if (token.startsWith('@')) {
            if (isDateFilterCandidate(token)) {
                // Only commit to a date filter when parsing succeeds. Partial/invalid date fragments are ignored
                // so they don't affect filtering until the token is complete.
                const range = parseDateFilterRange(token);
                if (range) {
                    tokens.push({ kind: 'date', range });
                }
                continue;
            }

            hasNonTagOperand = true;
            tokens.push({ kind: 'name', value: token });
            continue;
        }

        if (token.startsWith('#')) {
            const tagValue = token.slice(1);
            tokens.push({ kind: 'tag', value: tagValue.length > 0 ? tagValue : null });
            hasTagOperand = true;
            continue;
        }

        hasNonTagOperand = true;
        tokens.push({ kind: 'name', value: token });
    }

    return {
        tokens,
        hasTagOperand,
        hasNonTagOperand,
        hasInvalidToken
    };
};

// Result of building a tag expression tree from classified tokens
interface TagExpressionBuildResult {
    expression: TagExpressionToken[];
    includeUntagged: boolean;
    requireTagged: boolean;
    includedTagTokens: string[];
}

// Builds a postfix expression tree from classified tokens using operator precedence
const buildTagExpression = (classifiedTokens: ClassifiedToken[]): TagExpressionBuildResult | null => {
    const expression: TagExpressionToken[] = [];
    const operatorStack: InclusionOperator[] = [];
    const positiveTags = new Set<string>();

    let expectOperand = true;
    let includeUntagged = false;
    let requireTagged = false;
    let hasOperand = false;

    // Pushes an operator to the expression, respecting precedence
    const pushOperator = (operator: InclusionOperator): boolean => {
        if (expectOperand) {
            return false;
        }

        // Pop higher or equal precedence operators from stack
        while (operatorStack.length > 0) {
            const top = operatorStack[operatorStack.length - 1];
            if (OPERATOR_PRECEDENCE[top] >= OPERATOR_PRECEDENCE[operator]) {
                expression.push({ kind: 'operator', operator: operatorStack.pop() as InclusionOperator });
            } else {
                break;
            }
        }

        operatorStack.push(operator);
        expectOperand = true;
        return true;
    };

    // Pushes an operand to the expression, inserting implicit AND if needed
    const pushOperand = (operand: TagExpressionOperand): boolean => {
        if (!expectOperand) {
            // Insert implicit AND between adjacent operands
            if (!pushOperator('AND')) {
                return false;
            }
        }

        expression.push(operand);
        expectOperand = false;
        hasOperand = true;
        return true;
    };

    for (const token of classifiedTokens) {
        if (token.kind === 'operator') {
            if (!pushOperator(token.operator)) {
                return null;
            }
            continue;
        }

        if (token.kind === 'tag') {
            if (token.value === null) {
                if (!pushOperand({ kind: 'requireTagged' })) {
                    return null;
                }
                requireTagged = true;
            } else {
                if (!pushOperand({ kind: 'tag', value: token.value })) {
                    return null;
                }
                positiveTags.add(token.value);
            }
            continue;
        }

        if (token.kind === 'tagNegation') {
            if (token.value === null) {
                if (!pushOperand({ kind: 'untagged' })) {
                    return null;
                }
                includeUntagged = true;
            } else {
                if (!pushOperand({ kind: 'notTag', value: token.value })) {
                    return null;
                }
            }
            continue;
        }

        return null;
    }

    // Validate expression is not incomplete
    if (expectOperand) {
        return null;
    }

    // Pop remaining operators from stack
    while (operatorStack.length > 0) {
        const operator = operatorStack.pop();
        if (!operator) {
            break;
        }
        expression.push({ kind: 'operator', operator });
    }

    // Validate expression has at least one operand
    if (!hasOperand) {
        return null;
    }

    // Validate postfix expression structure (each operator consumes two operands)
    let depth = 0;
    for (const token of expression) {
        if (token.kind === 'operator') {
            if (depth < 2) {
                return null;
            }
            depth -= 1;
        } else {
            depth += 1;
        }
    }

    // Final depth should be exactly 1 (single result)
    if (depth !== 1) {
        return null;
    }

    return {
        expression,
        includeUntagged,
        requireTagged,
        includedTagTokens: Array.from(positiveTags)
    };
};

// Evaluates a postfix tag expression against a file's tags
const evaluateTagExpression = (expression: TagExpressionToken[], lowercaseTags: string[]): boolean => {
    if (expression.length === 0) {
        return true;
    }

    const stack: boolean[] = [];

    const hasTagMatch = (token: string): boolean => {
        for (const tag of lowercaseTags) {
            if (tagMatchesToken(tag, token)) {
                return true;
            }
        }
        return false;
    };

    for (const token of expression) {
        if (token.kind === 'operator') {
            const right = stack.pop();
            const left = stack.pop();
            if (left === undefined || right === undefined) {
                return false;
            }
            stack.push(token.operator === 'AND' ? left && right : left || right);
            continue;
        }

        let value = false;
        if (token.kind === 'tag') {
            value = hasTagMatch(token.value);
        } else if (token.kind === 'notTag') {
            value = !hasTagMatch(token.value);
        } else if (token.kind === 'requireTagged') {
            value = lowercaseTags.length > 0;
        } else if (token.kind === 'untagged') {
            value = lowercaseTags.length === 0;
        }
        stack.push(value);
    }

    return stack.length === 0 ? true : Boolean(stack[stack.length - 1]);
};

// Parses tokens into tag expression mode with OR/AND precedence
const parseTagModeTokens = (classifiedTokens: ClassifiedToken[], excludeTagTokens: string[]): FilterSearchTokens | null => {
    const dateRanges: DateFilterRange[] = [];
    const excludeDateRanges: DateFilterRange[] = [];
    const tagExpressionTokens = classifiedTokens.filter(token => {
        if (token.kind === 'date') {
            dateRanges.push(token.range);
            return false;
        }
        if (token.kind === 'dateNegation') {
            excludeDateRanges.push(token.range);
            return false;
        }
        return true;
    });

    const buildResult = buildTagExpression(tagExpressionTokens);
    if (!buildResult) {
        return null;
    }

    const { expression, includeUntagged, requireTagged, includedTagTokens } = buildResult;
    const hasInclusions = expression.length > 0;
    const requiresTags = hasInclusions;
    // Check if empty tag array would fail (meaning all clauses require tags)
    const allRequireTags = hasInclusions ? !evaluateTagExpression(expression, []) : false;

    return {
        mode: 'tag',
        expression,
        hasInclusions,
        requiresTags,
        allRequireTags,
        includedTagTokens,
        nameTokens: [],
        tagTokens: includedTagTokens.slice(),
        dateRanges,
        requireTagged,
        includeUntagged,
        excludeNameTokens: [],
        excludeTagTokens,
        excludeDateRanges,
        excludeTagged: false
    };
};

// Parses tokens into filter mode with simple AND semantics
const parseFilterModeTokens = (
    classifiedTokens: ClassifiedToken[],
    excludeTagTokens: string[],
    hasUntaggedOperand: boolean
): FilterSearchTokens => {
    const nameTokens: string[] = [];
    const tagTokens: string[] = [];
    const dateRanges: DateFilterRange[] = [];
    const connectorCandidates: string[] = [];
    const excludeNameTokens: string[] = [];
    const excludeDateRanges: DateFilterRange[] = [];
    let requireTagged = false;

    // Extract name and tag tokens, treating operators as potential name tokens
    for (const token of classifiedTokens) {
        switch (token.kind) {
            case 'name':
                nameTokens.push(token.value);
                break;
            case 'nameNegation':
                excludeNameTokens.push(token.value);
                break;
            case 'tag':
                if (token.value) {
                    tagTokens.push(token.value);
                }
                requireTagged = true;
                break;
            case 'date':
                dateRanges.push(token.range);
                break;
            case 'operator':
                connectorCandidates.push(token.operator.toLowerCase());
                break;
            case 'tagNegation':
                break;
            case 'dateNegation':
                excludeDateRanges.push(token.range);
                break;
        }
    }

    // Treat connector words as literal tokens when not in tag mode
    if (connectorCandidates.length > 0) {
        nameTokens.push(...connectorCandidates);
    }

    const hasInclusions = nameTokens.length > 0 || tagTokens.length > 0 || dateRanges.length > 0 || requireTagged;
    const requiresTags = requireTagged || tagTokens.length > 0;
    const allRequireTags = hasInclusions ? requiresTags : false;
    const includedTagTokens = tagTokens.slice();

    return {
        mode: 'filter',
        expression: [],
        hasInclusions,
        requiresTags,
        allRequireTags,
        includedTagTokens,
        nameTokens,
        tagTokens,
        dateRanges,
        requireTagged,
        includeUntagged: hasUntaggedOperand,
        excludeNameTokens,
        excludeTagTokens,
        excludeDateRanges,
        excludeTagged: hasUntaggedOperand
    };
};

/**
 * Parse a filter search query into name and tag tokens with support for negations.
 *
 * Inclusion patterns (must match):
 * - #tag - Include notes with tags containing "tag"
 * - # - Include only notes that have at least one tag
 * - @today - Include notes matching the default date field on the current day
 * - @YYYY-MM-DD / @YYYYMMDD - Include notes matching the default date field on a specific day
 * - @YYYY - Include notes matching the default date field inside a calendar year
 * - @YYYY-MM / @YYYYMM - Include notes matching the default date field inside a calendar month
 * - @YYYY-Www - Include notes matching the default date field inside an ISO week
 * - @YYYY-Qq - Include notes matching the default date field inside a calendar quarter
 * - @YYYY-MM-DD..YYYY-MM-DD - Include notes matching the default date field inside an inclusive day range (open ends supported)
 * - @c:... / @m:... - Target created/modified date field for a date token
 * - word - Include notes with "word" in their name
 *
 * Exclusion patterns (must NOT match):
 * - !#tag - Exclude notes with tags containing "tag"
 * - !# - Exclude all tagged notes (show only untagged)
 * - !@... - Exclude notes matching a date token or range
 * - !word - Exclude notes with "word" in their name
 *
 * Special handling:
 * - AND has higher precedence than OR for inclusion clauses
 * - Adjacent tokens without connectors implicitly use AND
 * - Leading or consecutive connectors are treated as literal text tokens
 * - All tokens are normalized to lowercase for case-insensitive matching
 *
 * @param query - Raw search query from the UI
 * @returns Parsed tokens with include/exclude criteria for filtering
 */
export function parseFilterSearchTokens(query: string): FilterSearchTokens {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
        return EMPTY_TOKENS;
    }

    const rawTokens = normalized.split(/\s+/).filter(Boolean);
    if (rawTokens.length === 0) {
        return EMPTY_TOKENS;
    }

    const classification = classifyRawTokens(rawTokens);
    const { tokens: classifiedTokens } = classification;

    const excludeTagTokens: string[] = [];
    let hasUntaggedOperand = false;
    for (const token of classifiedTokens) {
        if (token.kind !== 'tagNegation') {
            continue;
        }

        if (token.value === null) {
            hasUntaggedOperand = true;
        } else {
            excludeTagTokens.push(token.value);
        }
    }

    if (canUseTagMode(classification)) {
        const tagTokens = parseTagModeTokens(classifiedTokens, excludeTagTokens);
        if (tagTokens) {
            return tagTokens;
        }
    }

    return parseFilterModeTokens(classifiedTokens, excludeTagTokens, hasUntaggedOperand);
}

// Checks if a token is a recognized connector word
const isConnectorToken = (value: string | undefined): boolean => {
    if (!value) {
        return false;
    }
    return CONNECTOR_TOKEN_SET.has(value.toLowerCase());
};

export interface UpdateFilterQueryWithTagResult {
    query: string;
    action: 'added' | 'removed';
    changed: boolean;
}

/**
 * Toggle a normalized tag inside a raw query string, inserting or pruning connectors.
 * Returns the updated query string and whether the operation modified the input.
 */
export function updateFilterQueryWithTag(
    query: string,
    normalizedTag: string,
    operator: InclusionOperator
): UpdateFilterQueryWithTagResult {
    const trimmed = query.trim();
    if (!normalizedTag) {
        return {
            query: trimmed,
            action: 'removed',
            changed: false
        };
    }

    const formattedTag = `#${normalizedTag}`;
    const tokens = trimmed.length > 0 ? trimmed.split(/\s+/) : [];
    const lowerTarget = formattedTag.toLowerCase();
    const removalIndex = tokens.findIndex(token => token.toLowerCase() === lowerTarget);

    if (removalIndex !== -1) {
        const updatedTokens = tokens.slice();
        updatedTokens.splice(removalIndex, 1);

        const precedingIndex = removalIndex - 1;
        if (precedingIndex >= 0 && isConnectorToken(updatedTokens[precedingIndex])) {
            updatedTokens.splice(precedingIndex, 1);
        }

        while (updatedTokens.length > 0 && isConnectorToken(updatedTokens[0])) {
            updatedTokens.shift();
        }

        for (let index = 0; index < updatedTokens.length - 1; index += 1) {
            if (isConnectorToken(updatedTokens[index]) && isConnectorToken(updatedTokens[index + 1])) {
                updatedTokens.splice(index + 1, 1);
                index -= 1;
            }
        }

        while (updatedTokens.length > 0 && isConnectorToken(updatedTokens[updatedTokens.length - 1])) {
            updatedTokens.pop();
        }

        const nextQuery = updatedTokens.join(' ').trim();
        return {
            query: nextQuery,
            action: 'removed',
            changed: nextQuery !== trimmed
        };
    }

    const connector = operator === 'OR' ? 'OR' : 'AND';
    const nextTokens = tokens.slice();

    if (nextTokens.length === 0) {
        nextTokens.push(formattedTag);
    } else if (isConnectorToken(nextTokens[nextTokens.length - 1])) {
        nextTokens[nextTokens.length - 1] = connector;
        nextTokens.push(formattedTag);
    } else {
        nextTokens.push(connector, formattedTag);
    }

    const nextQuery = nextTokens.join(' ').trim();
    return {
        query: nextQuery,
        action: 'added',
        changed: nextQuery !== trimmed
    };
}

/**
 * Check if parsed tokens contain any include or exclude criteria.
 */
export function filterSearchHasActiveCriteria(tokens: FilterSearchTokens): boolean {
    return (
        tokens.hasInclusions ||
        tokens.excludeNameTokens.length > 0 ||
        tokens.excludeTagTokens.length > 0 ||
        tokens.excludeDateRanges.length > 0 ||
        tokens.excludeTagged
    );
}

/**
 * Check if evaluating the parsed tokens requires file tag metadata.
 */
export function filterSearchNeedsTagLookup(tokens: FilterSearchTokens): boolean {
    return tokens.requiresTags || tokens.excludeTagged || tokens.excludeTagTokens.length > 0;
}

/**
 * Check if every matching clause requires tagged files.
 */
export function filterSearchRequiresTagsForEveryMatch(tokens: FilterSearchTokens): boolean {
    return tokens.hasInclusions && tokens.allRequireTags;
}

/**
 * Check if a file matches parsed filter search tokens.
 *
 * Filtering logic:
 * - Inclusion clauses are evaluated with AND semantics; the file must satisfy every token inside a clause
 * - If any clause matches, the file is accepted (OR across clauses)
 * - All exclusion tokens (!name, !#tag) are ANDed - file must match NONE
 * - Tag requirements (# or !#) control whether tagged/untagged notes are shown
 *
 * @param lowercaseName - File display name in lowercase
 * @param lowercaseTags - File tags in lowercase
 * @param tokens - Parsed query tokens with include/exclude criteria
 * @returns True when the file passes all filter criteria
 */
export function fileMatchesFilterTokens(lowercaseName: string, lowercaseTags: string[], tokens: FilterSearchTokens): boolean {
    if (tokens.mode === 'filter') {
        if (tokens.excludeNameTokens.length > 0) {
            const hasExcludedName = tokens.excludeNameTokens.some(token => lowercaseName.includes(token));
            if (hasExcludedName) {
                return false;
            }
        }

        if (tokens.excludeTagged) {
            if (lowercaseTags.length > 0) {
                return false;
            }
        } else if (tokens.excludeTagTokens.length > 0 && lowercaseTags.length > 0) {
            const hasExcludedTag = tokens.excludeTagTokens.some(token => lowercaseTags.some(tag => tagMatchesToken(tag, token)));
            if (hasExcludedTag) {
                return false;
            }
        }

        if (tokens.nameTokens.length > 0) {
            const matchesName = tokens.nameTokens.every(token => lowercaseName.includes(token));
            if (!matchesName) {
                return false;
            }
        }

        if (tokens.requireTagged || tokens.tagTokens.length > 0) {
            if (lowercaseTags.length === 0) {
                return false;
            }
            if (tokens.tagTokens.length > 0) {
                const matchesTags = tokens.tagTokens.every(token => lowercaseTags.some(tag => tagMatchesToken(tag, token)));
                if (!matchesTags) {
                    return false;
                }
            }
        }

        return true;
    }

    if (tokens.excludeTagged) {
        if (lowercaseTags.length > 0) {
            return false;
        }
    }

    if (tokens.expression.length === 0) {
        return true;
    }

    return evaluateTagExpression(tokens.expression, lowercaseTags);
}

// File date context passed to date filter matching functions
interface FilterSearchFileDateContext {
    created: number;
    modified: number;
    defaultField: 'created' | 'modified';
}

// Checks if a timestamp falls within a date range (start inclusive, end exclusive)
const timestampMatchesDateRange = (timestamp: number, range: DateFilterRange): boolean => {
    if (!Number.isFinite(timestamp)) {
        return false;
    }

    if (range.startMs !== null && timestamp < range.startMs) {
        return false;
    }
    if (range.endMs !== null && timestamp >= range.endMs) {
        return false;
    }
    return true;
};

/**
 * Check if a file's timestamps match all date filter tokens.
 * All inclusion ranges must match AND all exclusion ranges must not match.
 */
export function fileMatchesDateFilterTokens(date: FilterSearchFileDateContext, tokens: FilterSearchTokens): boolean {
    if (tokens.dateRanges.length === 0 && tokens.excludeDateRanges.length === 0) {
        return true;
    }

    const resolveTimestamp = (range: DateFilterRange): number => {
        if (range.field === 'created') {
            return date.created;
        }
        if (range.field === 'modified') {
            return date.modified;
        }

        return date.defaultField === 'created' ? date.created : date.modified;
    };

    for (const range of tokens.dateRanges) {
        const timestamp = resolveTimestamp(range);
        if (!timestampMatchesDateRange(timestamp, range)) {
            return false;
        }
    }

    for (const range of tokens.excludeDateRanges) {
        const timestamp = resolveTimestamp(range);
        if (timestampMatchesDateRange(timestamp, range)) {
            return false;
        }
    }

    return true;
}
