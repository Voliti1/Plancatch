export interface User {
  id: string;
  email: string;
  display_name: string | null;
  is_active: boolean;
  created_at: string;
}
export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}
export interface Source {
  id: string;
  source_type: string;
  title: string | null;
  original_url: string | null;
  original_text: string | null;
  extracted_text: string | null;
  storage_key: string | null;
  processing_status: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}
export type SourceInput =
  | { title?: string; source_type: "url"; original_url: string }
  | { title?: string; source_type: "text"; original_text: string };
export interface Deadline {
  id: string;
  source_id: string | null;
  title: string;
  due_at: string;
  deadline_type: string | null;
  description: string | null;
  confidence: string | number | null;
  evidence_text: string | null;
  is_confirmed: boolean;
  created_at: string;
  updated_at: string;
}
export interface DeadlineInput {
  title: string;
  due_at: string;
  source_id: string | null;
  deadline_type: string | null;
  description: string | null;
  is_confirmed: boolean;
}
