import apiClient from './apiClient';
import type { ApiResponse } from '@/types/dto';

export interface OverallProgress {
  percentage: number;
  description: string;
}

export interface ChangeDetected {
  category: string;
  change: string;
  importance: 'High' | 'Medium' | 'Low';
}

export interface ProgressAnalysisReport {
  summary: string;
  overallProgress: OverallProgress;
  changesDetected: ChangeDetected[];
  completedWork: string[];
  newlyAdded: string[];
  removedItems: string[];
  pendingWork: string[];
  qualityObservations: string[];
  risks: string[];
  recommendedNextSteps: string[];
  confidence: number;
}

export type AnalysisJobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface ProgressAnalysisStartResult {
  status: AnalysisJobStatus;
  jobId: string | null;
  reportId: string | null;
  saved: boolean;
  cached: boolean;
  analysis: ProgressAnalysisReport | null;
}

export interface ProgressAnalysisJobResult {
  status: AnalysisJobStatus;
  jobId: string;
  reportId: string | null;
  saved: boolean;
  cached: boolean;
  analysis: ProgressAnalysisReport | null;
  error?: string | null;
}

export interface ProgressAnalysisCompleteResult {
  report: ProgressAnalysisReport;
  reportId: string;
  saved: boolean;
}

export interface StartProgressAnalysisPayload {
  beforeImage: string;
  afterImage: string;
  beforeDate: string;
  afterDate: string;
  beforeTimelineId: string;
  afterTimelineId: string;
  projectName: string;
  projectId?: string;
  tower: string;
  floor: string;
  pinName: string;
  captureType?: string;
  floorPlanImage?: string;
  floorPlanId?: string;
  pinX?: number;
  pinY?: number;
  forceRefresh?: boolean;
}

export interface ProgressReportVisualMeta {
  projectName?: string;
  tower?: string;
  floor?: string;
  pinName?: string;
  beforeDate?: string;
  afterDate?: string;
  beforeImageUrl?: string;
  afterImageUrl?: string;
  floorPlanImageUrl?: string;
  pinX?: number | null;
  pinY?: number | null;
  /** ISO timestamp when the report was generated (not capture dates). */
  generatedAt?: string;
}

export interface ProgressReportSummary {
  reportId: string;
  beforeTimelineId: string;
  afterTimelineId: string;
  projectId: string;
  projectName: string;
  tower: string;
  floor: string;
  pinName: string;
  beforeDate: string;
  afterDate: string;
  captureType: string;
  summary: string;
  overallProgressPercentage: number;
  confidence: number;
  createdAt: string;
  savedAt?: string;
  beforeImageUrl?: string;
  afterImageUrl?: string;
  floorPlanImageUrl?: string;
  pinX?: number | null;
  pinY?: number | null;
  saved?: boolean;
}

export interface ProgressReportDetail extends ProgressReportSummary {
  analysis: ProgressAnalysisReport;
  model?: string | null;
  latencyMs?: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  requestedBy?: string | null;
}

export interface ProgressAnalysisAuditEntry {
  reportId: string;
  projectId: string;
  projectName: string;
  tower: string;
  floor: string;
  pinName: string;
  model?: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  requestedBy?: string | null;
  requestedByName?: string | null;
  createdAt?: string | null;
  latencyMs?: number | null;
}

export interface ProgressAnalysisAuditSummary {
  analysisCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ListProgressAnalysisAuditResult {
  items: ProgressAnalysisAuditEntry[];
  total: number;
  page: number;
  limit: number;
  summary: ProgressAnalysisAuditSummary;
}

export interface ListProgressReportsParams {
  page?: number;
  limit?: number;
  projectId?: string;
  pinName?: string;
  beforeTimelineId?: string;
  afterTimelineId?: string;
}

export interface ListProgressReportsResult {
  items: ProgressReportSummary[];
  total: number;
  page: number;
  limit: number;
}

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 45;

async function getData<T>(request: Promise<{ data: ApiResponse<T> }>): Promise<T> {
  const { data } = await request;
  return data.data as T;
}

export const progressAnalysisService = {
  async start(payload: StartProgressAnalysisPayload): Promise<ProgressAnalysisStartResult> {
    return getData<ProgressAnalysisStartResult>(
      apiClient.post('/progress-analysis', payload),
    );
  },

  async getJob(jobId: string): Promise<ProgressAnalysisJobResult> {
    return getData<ProgressAnalysisJobResult>(
      apiClient.get(`/progress-analysis/${jobId}`),
    );
  },

  async listReports(params: ListProgressReportsParams = {}): Promise<ListProgressReportsResult> {
    const { data } = await apiClient.get<{
      success: boolean;
      data: ProgressReportSummary[];
      total: number;
      page: number;
      limit: number;
    }>('/progress-analysis/reports', { params });
    return {
      items: data.data ?? [],
      total: data.total ?? 0,
      page: data.page ?? 1,
      limit: data.limit ?? 20,
    };
  },

  async getReport(reportId: string): Promise<ProgressReportDetail> {
    return getData<ProgressReportDetail>(
      apiClient.get(`/progress-analysis/reports/${reportId}`),
    );
  },

  async saveReport(reportId: string): Promise<ProgressReportSummary> {
    const result = await getData<{ reportId: string; saved: boolean; summary: ProgressReportSummary }>(
      apiClient.post(`/progress-analysis/reports/${reportId}/save`),
    );
    return result.summary;
  },

  async listTokenAudit(page = 1, limit = 20): Promise<ListProgressAnalysisAuditResult> {
    const { data } = await apiClient.get<{
      success: boolean;
      data: ProgressAnalysisAuditEntry[];
      total: number;
      page: number;
      limit: number;
      summary: ProgressAnalysisAuditSummary;
    }>('/progress-analysis/audit', { params: { page, limit } });
    return {
      items: data.data ?? [],
      total: data.total ?? 0,
      page: data.page ?? page,
      limit: data.limit ?? limit,
      summary: data.summary ?? {
        analysisCount: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      },
    };
  },

  async runUntilComplete(
    payload: StartProgressAnalysisPayload,
    onStatus?: (status: AnalysisJobStatus) => void,
  ): Promise<ProgressAnalysisCompleteResult> {
    const start = await this.start(payload);

    if (start.status === 'completed' && start.analysis && start.reportId) {
      return {
        report: start.analysis,
        reportId: start.reportId,
        saved: start.saved,
      };
    }

    if (!start.jobId) {
      throw new Error('Analysis did not return a job ID');
    }

    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
      const job = await this.getJob(start.jobId);
      onStatus?.(job.status);

      if (job.status === 'completed' && job.analysis && job.reportId) {
        return {
          report: job.analysis,
          reportId: job.reportId,
          saved: job.saved,
        };
      }
      if (job.status === 'failed') {
        throw new Error(job.error || 'Construction progress analysis failed');
      }
    }

    throw new Error('Analysis timed out — please try again');
  },
};

export { formatReportAsText, exportReportToPdf } from '@/utils/reportPdf';
export { normalizeProgressReport } from '@/utils/reportNormalization';
