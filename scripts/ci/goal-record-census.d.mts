export interface GoalCensus {
  references: Record<string, Record<string, number>>;
  counts: Record<string, number>;
  total_references: number;
  controls: Record<string, number>;
}
export declare const GOAL_FIELDS: readonly string[];
export declare const ABSENT_CONTROL: string;
export declare function tokenPattern(token: string): RegExp;
export declare function censusFiles(root?: string): string[];
export declare function countOccurrences(source: string, token: string): number;
export declare function runCensus(root?: string): GoalCensus;
export declare function baselineDifferences(census: GoalCensus, baseline: Pick<GoalCensus, 'references'>): string[];
