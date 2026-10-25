export interface User {
  id: string;
  name: string;
  email: string;
  role: 'researcher' | 'clinician';
}

export interface InvestigationMetadata {
  cancerType: string | null;
  specimenContext: string | null;
  referenceGenome: 'GRCh37' | 'GRCh38' | null;
  transcriptId: string | null;
}

export interface Investigation {
  id: string;
  title: string;
  inputType?: string;
  inputMetadata?: InvestigationMetadata;
  selectedCancerContext?: string | null;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Paged<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}

export interface AuthResponse {
  user: User;
  csrfToken: string;
}
