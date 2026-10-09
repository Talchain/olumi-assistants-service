export interface GoalCensus {
  references: Record<string, string[]>;
  counts: Record<string, number>;
  total_references: number;
  controls: Record<string, number>;
}
export declare const GOAL_FIELDS: readonly string[];
export declare const ABSENT_CONTROL: string;
export declare function tokenPattern(token: string): RegExp;
export declare function runCensus(root?: string): GoalCensus;
export declare function baselineDifferences(census: GoalCensus, baseline: Pick<GoalCensus, 'references'>): string[];
