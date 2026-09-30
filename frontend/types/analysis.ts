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
export interface Analysis {
  id: string;
  source_id: string;
  input_text: string;
  model: string;
  status: AnalysisStatus;
  revision: number;
  candidates: AnalysisCandidate[];
  warnings: string[];
  approved_deadline_ids: string[];
  error_message: string | null;
  created_at: string;
  updated_at: string;
}
