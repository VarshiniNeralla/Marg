// Mirrors backend/app/schemas/drishti.py. Kept as a dedicated file (rather
// than inlined in drishtiService.ts) since the message bubble, breadcrumb,
// and suggestions components all need these types independently of the
// service layer.

export interface DrishtiProjectListItem {
  projectId: string;
  projectName: string;
  towerCount: number;
  floorCount: number;
  overallProgressPct: number | null;
  floorsAnalyzed: number;
  floorsNotYetAnalyzed: number;
  lastAnalyzedAt: string | null;
}

export interface DrishtiScope {
  towerId: string | null;
  towerName: string | null;
  floorId: string | null;
  floorName: string | null;
  flatName: string | null;
  roomName: string | null;
}

export interface DrishtiMetric {
  label: string;
  value: string;
  trend: 'up' | 'down' | 'flat' | null;
}

export interface DrishtiEvidenceRef {
  floorId: string | null;
  flatName: string | null;
  roomName: string | null;
  snapshotId: string | null;
  note: string;
}

/** The strict structured shape every Drishti answer conforms to — the
 * backend validates every LLM response against this before it can ever
 * reach the frontend. */
export interface DrishtiAnswer {
  answer: string;
  scope: DrishtiScope;
  facts: string[];
  insights: string[];
  recommendations: string[];
  metrics: DrishtiMetric[];
  evidence: DrishtiEvidenceRef[];
  followUpQuestions: string[];
}

export interface DrishtiMessage {
  messageId: string;
  role: 'user' | 'assistant';
  content: string;
  structuredPayload: DrishtiAnswer | null;
  createdAt: string;
}

export interface DrishtiConversationSummary {
  conversationId: string;
  projectId: string;
  projectName: string;
  title: string;
  updatedAt: string;
}

export interface DrishtiConversationDetail extends DrishtiConversationSummary {
  scope: DrishtiScope;
  messages: DrishtiMessage[];
  createdAt: string;
}

export interface AskDrishtiResponse {
  conversationId: string;
  message: DrishtiMessage;
}
