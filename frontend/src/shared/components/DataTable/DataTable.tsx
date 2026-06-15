import React from 'react';
import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  CircularProgress,
  Skeleton,
} from '@mui/material';
import { colors, radii } from '@theme/tokens';
import EmptyState from '../EmptyState/EmptyState';

export interface Column<T = Record<string, unknown>> {
  key: string;
  label: string;
  width?: string | number;
  align?: 'left' | 'center' | 'right';
  render?: (row: T, index: number) => React.ReactNode;
}

export interface DataTableProps<T = Record<string, unknown>> {
  columns: Column<T>[];
  rows: T[];
  rowKey: keyof T | ((row: T) => string);
  loading?: boolean;
  total?: number;
  page?: number;
  rowsPerPage?: number;
  onPageChange?: (page: number) => void;
  onRowsPerPageChange?: (n: number) => void;
  emptyTitle?: string;
  emptyDescription?: string;
  onRowClick?: (row: T) => void;
}

export default function DataTable<T = Record<string, unknown>>({
  columns,
  rows,
  rowKey,
  loading = false,
  total,
  page = 0,
  rowsPerPage = 20,
  onPageChange,
  onRowsPerPageChange,
  emptyTitle = 'No data',
  emptyDescription,
  onRowClick,
}: DataTableProps<T>) {
  const getKey = (row: T) =>
    typeof rowKey === 'function'
      ? rowKey(row)
      : String(row[rowKey]);

  return (
    <Box
      sx={{
        backgroundColor: colors.card,
        border: `1px solid ${colors.border}`,
        borderRadius: radii.md,
        overflow: 'hidden',
      }}
    >
      <TableContainer>
        <Table size="small">
          {/* Head */}
          <TableHead>
            <TableRow>
              {columns.map((col) => (
                <TableCell
                  key={col.key}
                  align={col.align ?? 'left'}
                  width={col.width}
                  sx={{
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: colors.textMuted,
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    backgroundColor: colors.bg,
                    borderBottom: `1px solid ${colors.border}`,
                    py: 1.25,
                  }}
                >
                  {col.label}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>

          {/* Body */}
          <TableBody>
            {loading ? (
              // Skeleton rows
              Array.from({ length: rowsPerPage }).map((_, i) => (
                <TableRow key={i}>
                  {columns.map((col) => (
                    <TableCell key={col.key}>
                      <Skeleton variant="text" width="80%" height={18} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} sx={{ border: 0 }}>
                  <EmptyState
                    title={emptyTitle}
                    description={emptyDescription}
                  />
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row, i) => (
                <TableRow
                  key={getKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  sx={{
                    cursor: onRowClick ? 'pointer' : 'default',
                    '&:hover': onRowClick
                      ? { backgroundColor: `${colors.bg}80` }
                      : undefined,
                    '&:last-child td': { border: 0 },
                  }}
                >
                  {columns.map((col) => (
                    <TableCell
                      key={col.key}
                      align={col.align ?? 'left'}
                      sx={{
                        fontSize: '0.875rem',
                        color: colors.text,
                        borderBottom: `1px solid ${colors.border}`,
                        py: 1.25,
                      }}
                    >
                      {col.render
                        ? col.render(row, i)
                        : String((row as Record<string, unknown>)[col.key] ?? '')}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Pagination */}
      {total !== undefined && onPageChange && (
        <TablePagination
          component="div"
          count={total}
          page={page}
          rowsPerPage={rowsPerPage}
          rowsPerPageOptions={[10, 20, 50]}
          onPageChange={(_, p) => onPageChange(p)}
          onRowsPerPageChange={(e) =>
            onRowsPerPageChange?.(parseInt(e.target.value, 10))
          }
          sx={{
            borderTop: `1px solid ${colors.border}`,
            fontSize: '0.8125rem',
            color: colors.textMuted,
            '& .MuiTablePagination-select': { fontSize: '0.8125rem' },
          }}
        />
      )}
    </Box>
  );
}
