export type AnalysisStatus =
  "processing" | "ready" | "failed" | "approved" | "rejected";
export interface CandidateEdit {
  id: string;
  title: string;
  due_at: string | null;
  description: string | null;
  selected: boolean;
}
export interface AnalysisCandidate extends CandidateEdit {
  evidence_text: string;
  confidence: number;
}
export interface SourcePeriod {
  // Additive site label; older responses describe Saramin and omit this field.
  site?:
    | "saramin"
    | "jobkorea"
    | "catch"
    | "jobplanet"
    | "jasoseol"
    | "linkareer"
    | "work24";
  start_text: string | null;
  end_text: string | null;
  deadline_at: string | null;
  remaining_text: string | null;
  has_conflict: boolean;
}
export interface Analysis {
  id: string;
  source_id: string;
  input_text: string;
  input_hash?: string;
  model: string;
  status: AnalysisStatus;
  revision: number;
  candidates: AnalysisCandidate[];
  warnings: string[];
  approved_deadline_ids: string[];
  error_message: string | null;
  created_at: string;
  updated_at: string;
  // Additive API field: old analysis responses remain compatible.
  source_period?: SourcePeriod | null;
  date_choices?: {
    id: string;
    raw_text: string;
    date: string | null;
    due_at: string | null;
    evidence_text: string;
  }[];
  is_open_ended?: boolean;
}
