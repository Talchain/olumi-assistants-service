/**
 * Deadline Extractor
 *
 * Extracts temporal constraints from natural language briefs.
 * Handles various deadline formats:
 * - "by Q3" / "by Q2 2025" → Quarter end date
 * - "within 6 months" / "in 3 months" → Direct month count
 * - "by December" / "by December 2025" → Specific month end
 * - "by end of year" / "by year-end" → December 31
 *
 * If no explicit reference date, assumes today and flags assumed_reference_date: true.
 */

// ============================================================================
// Types
// ============================================================================

export interface DeadlineExtractionResult {
  /** Whether a deadline was detected */
  detected: boolean;
  /** Deadline as months from reference date */
  months: number;
  /** ISO date string for deadline */
  deadlineDate: string;
  /** ISO date string for reference (start) date */
  referenceDate: string;
  /** Whether reference date was assumed vs explicit */
  assumed: boolean;
  /** Source quote from brief */
  sourceQuote: string;
  /** Extraction confidence */
  confidence: number;
}

// ============================================================================
// Quarter Mapping
// ============================================================================

/**
 * Quarter end month mapping.
 * Q1 → March 31, Q2 → June 30, Q3 → September 30, Q4 → December 31
 */
const QUARTER_END_MONTHS: Record<string, number> = {
  Q1: 2,  // March (0-indexed)
  Q2: 5,  // June
  Q3: 8,  // September
  Q4: 11, // December
};

/**
 * Get the last day of a month.
 */
function getLastDayOfMonth(year: number, month: number): number {
  // Month is 0-indexed, so we pass month+1 as the next month, day 0 gives last day
  return new Date(year, month + 1, 0).getDate();
}

/**
 * Compute deadline date for a quarter.
 */
function getQuarterEndDate(quarter: string, year: number): Date {
  const month = QUARTER_END_MONTHS[quarter.toUpperCase()];
  if (month === undefined) {
    throw new Error(`Invalid quarter: ${quarter}`);
  }
  const lastDay = getLastDayOfMonth(year, month);
  return new Date(year, month, lastDay);
}

// ============================================================================
// Month Name Mapping
// ============================================================================

const MONTH_NAMES: Record<string, number> = {
  january: 0, jan: 0,
  february: 1, feb: 1,
  march: 2, mar: 2,
  april: 3, apr: 3,
  may: 4,
  june: 5, jun: 5,
  july: 6, jul: 6,
  august: 7, aug: 7,
  september: 8, sep: 8, sept: 8,
  october: 9, oct: 9,
  november: 10, nov: 10,
  december: 11, dec: 11,
};

/**
 * Parse month name to 0-indexed month number.
 */
function parseMonthName(monthStr: string): number | null {
  return MONTH_NAMES[monthStr.toLowerCase()] ?? null;
}

// ============================================================================
// Patterns
// ============================================================================

/** Quarter patterns: "by Q3", "by Q2 2025", "before Q4" */
const QUARTER_PATTERN = /\b(?:by|before|until)\s+(Q[1-4])(?:\s+(\d{4}))?\b/gi;

/** Direct month count: "within 6 months", "in 3 months" */
const DIRECT_MONTHS_PATTERN = /\b(?:within|in)\s+(\d+)\s+months?\b/gi;

/** Month name patterns: "by December", "by December 2025", "before March" */
const MONTH_NAME_PATTERN = /\b(?:by|before|until)\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)(?:\s+(\d{4}))?\b/gi;

/** Year-end patterns: "by end of year", "by year-end", "by EOY" */
const YEAR_END_PATTERN = /\b(?:by|before)\s+(?:end of year|year-?end|EOY)(?:\s+(\d{4}))?\b/gi;

/** Week patterns: "within 2 weeks", "in 4 weeks" */
const WEEKS_PATTERN = /\b(?:within|in)\s+(\d+)\s+weeks?\b/gi;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Format a Date as ISO date string (YYYY-MM-DD) without timezone conversion.
 * This avoids the toISOString() UTC conversion issue.
 */
function formatDateAsISO(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// ============================================================================
// Extraction Functions
// ============================================================================

/**
 * Calculate months between two dates.
 */
function monthsBetween(start: Date, end: Date): number {
  const yearDiff = end.getFullYear() - start.getFullYear();
  const monthDiff = end.getMonth() - start.getMonth();
  const dayDiff = end.getDate() - start.getDate();

  let months = yearDiff * 12 + monthDiff;

  // Adjust for partial months
  if (dayDiff < 0) {
    months -= 1;
  }

  return Math.max(0, months);
}

/**
 * Extract deadline from a brief.
 *
 * @param brief - Natural language decision brief
 * @param referenceDate - Reference date for relative deadlines (default: today)
 * @returns Extraction result
 */
export function extractDeadline(
  brief: string,
  referenceDate?: Date
): DeadlineExtractionResult {
  const now = referenceDate || new Date();
  const currentYear = now.getFullYear();

  // Try each pattern in priority order

  // 1. Quarter patterns
  QUARTER_PATTERN.lastIndex = 0;
  const quarterMatch = QUARTER_PATTERN.exec(brief);
  if (quarterMatch) {
    const [fullMatch, quarter, yearStr] = quarterMatch;
    const year = yearStr ? parseInt(yearStr, 10) : currentYear;

    // If quarter is in past, assume next year
    const deadlineDate = getQuarterEndDate(quarter, year);
    const effectiveDeadline = deadlineDate < now && !yearStr
      ? getQuarterEndDate(quarter, year + 1)
      : deadlineDate;

    return {
      detected: true,
      months: monthsBetween(now, effectiveDeadline),
      deadlineDate: formatDateAsISO(effectiveDeadline),
      referenceDate: formatDateAsISO(now),
      assumed: referenceDate === undefined,
      sourceQuote: fullMatch,
      confidence: yearStr ? 0.95 : 0.85, // Higher confidence with explicit year
    };
  }

  // 2. Direct month count
  DIRECT_MONTHS_PATTERN.lastIndex = 0;
  const directMatch = DIRECT_MONTHS_PATTERN.exec(brief);
  if (directMatch) {
    const [fullMatch, monthsStr] = directMatch;
    const months = parseInt(monthsStr, 10);

    const deadlineDate = new Date(now);
    deadlineDate.setMonth(deadlineDate.getMonth() + months);

    return {
      detected: true,
      months,
      deadlineDate: formatDateAsISO(deadlineDate),
      referenceDate: formatDateAsISO(now),
      assumed: referenceDate === undefined,
      sourceQuote: fullMatch,
      confidence: 0.95,
    };
  }

  // 3. Month name patterns
  MONTH_NAME_PATTERN.lastIndex = 0;
  const monthMatch = MONTH_NAME_PATTERN.exec(brief);
  if (monthMatch) {
    const [fullMatch, monthName, yearStr] = monthMatch;
    const month = parseMonthName(monthName);
    if (month !== null) {
      const year = yearStr ? parseInt(yearStr, 10) : currentYear;
      const lastDay = getLastDayOfMonth(year, month);
      let deadlineDate = new Date(year, month, lastDay);

      // If date is in past and no explicit year, assume next year
      if (deadlineDate < now && !yearStr) {
        deadlineDate = new Date(year + 1, month, getLastDayOfMonth(year + 1, month));
      }

      return {
        detected: true,
        months: monthsBetween(now, deadlineDate),
        deadlineDate: formatDateAsISO(deadlineDate),
        referenceDate: formatDateAsISO(now),
        assumed: referenceDate === undefined,
        sourceQuote: fullMatch,
        confidence: yearStr ? 0.95 : 0.85,
      };
    }
  }

  // 4. Year-end patterns
  YEAR_END_PATTERN.lastIndex = 0;
  const yearEndMatch = YEAR_END_PATTERN.exec(brief);
  if (yearEndMatch) {
    const [fullMatch, yearStr] = yearEndMatch;
    const year = yearStr ? parseInt(yearStr, 10) : currentYear;
    let deadlineDate = new Date(year, 11, 31); // December 31

    // If date is in past and no explicit year, use next year
    if (deadlineDate < now && !yearStr) {
      deadlineDate = new Date(year + 1, 11, 31);
    }

    return {
      detected: true,
      months: monthsBetween(now, deadlineDate),
      deadlineDate: formatDateAsISO(deadlineDate),
      referenceDate: formatDateAsISO(now),
      assumed: referenceDate === undefined,
      sourceQuote: fullMatch,
      confidence: yearStr ? 0.95 : 0.85,
    };
  }

  // 5. Week patterns (convert to months)
  WEEKS_PATTERN.lastIndex = 0;
  const weeksMatch = WEEKS_PATTERN.exec(brief);
  if (weeksMatch) {
    const [fullMatch, weeksStr] = weeksMatch;
    const weeks = parseInt(weeksStr, 10);
    const days = weeks * 7;

    const deadlineDate = new Date(now);
    deadlineDate.setDate(deadlineDate.getDate() + days);

    // Convert to months (approximate)
    const months = Math.ceil(days / 30);

    return {
      detected: true,
      months: Math.max(1, months), // At least 1 month
      deadlineDate: formatDateAsISO(deadlineDate),
      referenceDate: formatDateAsISO(now),
      assumed: referenceDate === undefined,
      sourceQuote: fullMatch,
      confidence: 0.90,
    };
  }

  // No deadline detected
  return {
    detected: false,
    months: 0,
    deadlineDate: "",
    referenceDate: formatDateAsISO(now),
    assumed: true,
    sourceQuote: "",
    confidence: 0,
  };
}

/**
 * Check if a brief contains any deadline language.
 * Useful for quick pre-filtering.
 */
export function hasDeadlineLanguage(brief: string): boolean {
  const quickPatterns = [
    /\b(?:by|before|until)\s+Q[1-4]/i,
    /\b(?:within|in)\s+\d+\s+(?:months?|weeks?)/i,
    /\b(?:by|before)\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)/i,
    /\b(?:by|before)\s+(?:end of year|year-?end|EOY)/i,
  ];

  return quickPatterns.some((pattern) => pattern.test(brief));
}
