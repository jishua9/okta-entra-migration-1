export interface Candidate { id: string; displayName?: string; userPrincipalName?: string }
export type MatchStatus = "matched" | "ambiguous" | "not_found";

export interface MatchResult {
  sourceName: string;
  status: MatchStatus;
  entraId?: string;
  candidates?: Candidate[];
}

export function classifyMatch(sourceName: string, candidates: Candidate[]): MatchResult {
  if (candidates.length === 1) return { sourceName, status: "matched", entraId: candidates[0].id };
  if (candidates.length > 1) return { sourceName, status: "ambiguous", candidates };
  return { sourceName, status: "not_found" };
}
