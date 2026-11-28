import apiClient from './apiClient';
import type { ApiResponse } from '@/types/dto';

export type BinKind = 'capture' | 'tour' | 'floor_plan' | 'project';
export type BinFilter = BinKind | 'all';
export type BinSort = 'newest' | 'oldest' | 'expiring' | 'name' | 'type';

export interface BinItem {
  /** Pass this to restore. Projects look like "project:<id>". */
  id: string;
  kind: BinKind;
  title: string;
  subtitle: string;
  projectId?: string | null;
  deletedAt: string;
  deletedByName: string;
  expiresAt: string;
  /** Whole days left before it is deleted for good. */
  daysLeft: number;
}

export interface BinPage {
  items: BinItem[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
  /** How many items of each kind this person can see (before the kind filter). */
  counts: Record<BinFilter, number>;
  retentionDays: number;
}

async function unwrap<T>(request: Promise<{ data: ApiResponse<T> }>): Promise<T> {
  const { data } = await request;
  return data.data as T;
}

export const recycleBinService = {
  list(params: { kind: BinFilter; sort: BinSort; page: number; pageSize: number }): Promise<BinPage> {
    return unwrap(apiClient.get('/recycle-bin', { params }));
  },

  restore(id: string): Promise<{ id: string; kind: BinKind; outcome: 'restored' | 'already_present' | 'skipped' }> {
    return unwrap(apiClient.post(`/recycle-bin/${encodeURIComponent(id)}/restore`));
  },

  /** Permanently deletes everything this person can see in the bin (or one kind). */
  empty(kind: BinFilter = 'all'): Promise<{ purged: number }> {
    return unwrap(apiClient.delete('/recycle-bin', { params: { kind } }));
  },
};
