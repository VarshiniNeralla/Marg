import React, { useEffect, useMemo, useState } from 'react';
import { Box, Typography, CircularProgress, Select, MenuItem, IconButton, Modal, Button } from '@mui/material';
import { InsightsRounded, ChevronRightRounded, HourglassEmptyRounded, FolderOpenRounded, BusinessRounded, LayersRounded, DeleteOutlineRounded } from '@mui/icons-material';
import { Link } from 'react-router-dom';
import { colors, motion } from '@theme/tokens';
import { toast } from 'react-toastify';
import { useWorkflowStore } from '@store/workflowStore';
import { getTowersByProject, getFloorsByTower } from '@store/workflowSelectors';
import {
  constructionProgressService,
  type FloorSummary,
} from '@/services/constructionProgressService';

const P = {
  border: '#e4e7ec',
  muted: '#6b7280',
  subtle: '#9ca3af',
  strong: '#111827',
  white: '#ffffff',
  bg: '#f7f8fa',
};

function progressColor(pct: number | null): string {
  if (pct == null) return P.subtle;
  if (pct >= 75) return colors.success;
  if (pct >= 40) return colors.warning;
  return colors.danger;
}

function formatLastInspection(value: string | null): string {
  if (!value) return 'Not yet inspected';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'Not yet inspected';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function SelectorStep({
  icon,
  label,
  value,
  onChange,
  options,
  disabled,
  placeholder,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { id: string; name: string }[];
  disabled?: boolean;
  placeholder: string;
}) {
  return (
    <Box sx={{ flex: 1, minWidth: 180 }}>
      <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: P.muted, mb: 0.5, display: 'flex', alignItems: 'center', gap: 0.5 }}>
        {icon} {label}
      </Typography>
      <Select
        size="small"
        fullWidth
        displayEmpty
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        sx={{ fontSize: '0.875rem', backgroundColor: P.white }}
      >
        <MenuItem value="" disabled sx={{ fontSize: '0.875rem' }}>
          {placeholder}
        </MenuItem>
        {options.map(o => (
          <MenuItem key={o.id} value={o.id} sx={{ fontSize: '0.875rem' }}>
            {o.name}
          </MenuItem>
        ))}
      </Select>
    </Box>
  );
}

function floorHeading(floor: FloorSummary): string {
  return [floor.projectName, floor.towerName, floor.floorName].filter(Boolean).join(', ');
}

function DeleteConfirmModal({
  floor,
  deleting,
  onCancel,
  onConfirm,
}: {
  floor: FloorSummary;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal open onClose={onCancel} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
      <Box sx={{ width: '100%', maxWidth: 420, backgroundColor: '#fff', borderRadius: '16px', p: 3, outline: 'none' }}>
        <Typography sx={{ fontSize: '1.0625rem', fontWeight: 700, color: P.strong, mb: 1 }}>
          Delete progress reports?
        </Typography>
        <Typography sx={{ fontSize: '0.875rem', color: P.muted, mb: 3 }}>
          This permanently deletes every analysis report and history for{' '}
          <strong>{floorHeading(floor)}</strong>. This can't be undone.
        </Typography>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1.5 }}>
          <Button
            onClick={onCancel}
            disabled={deleting}
            sx={{ textTransform: 'none', fontWeight: 600, color: P.muted }}
          >
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            disabled={deleting}
            startIcon={deleting ? <CircularProgress size={14} sx={{ color: '#fff' }} /> : undefined}
            sx={{
              backgroundColor: colors.danger, color: '#fff', px: 2.5, borderRadius: '10px',
              fontWeight: 700, textTransform: 'none',
              '&:hover': { opacity: 0.9, backgroundColor: colors.danger },
            }}
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </Button>
        </Box>
      </Box>
    </Modal>
  );
}

function FloorCard({ floor, onDelete }: { floor: FloorSummary; onDelete: (floor: FloorSummary) => void }) {
  const pct = floor.overallProgressPct;
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        p: 2,
        borderRadius: '14px',
        backgroundColor: P.white,
        border: `1.5px solid ${P.border}`,
        transition: `all ${motion.durationFast}`,
        '&:hover': {
          borderColor: colors.primary,
          boxShadow: '0 8px 24px rgba(37,99,235,0.08)',
        },
      }}
    >
      <Box
        component={Link}
        to={`/construction-progress/${floor.floorId}`}
        sx={{ display: 'flex', alignItems: 'center', gap: 2, flex: 1, minWidth: 0, textDecoration: 'none' }}
      >
        <Box
          sx={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: `3px solid ${progressColor(pct)}`,
            backgroundColor: `${progressColor(pct)}0f`,
          }}
        >
          <Typography sx={{ fontSize: '0.9375rem', fontWeight: 800, color: progressColor(pct) }}>
            {pct != null ? `${Math.round(pct)}%` : '—'}
          </Typography>
        </Box>

        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
            <Typography sx={{ fontSize: '0.9375rem', fontWeight: 700, color: P.strong }} noWrap>
              {floorHeading(floor) || 'Floor'}
            </Typography>
            {floor.analyzed && (
              <Box
                sx={{
                  px: 0.875, py: 0.0625, borderRadius: '5px', flexShrink: 0,
                  backgroundColor: floor.overallStatus === 'completed' ? colors.successBg : colors.warningBg,
                }}
              >
                <Typography sx={{
                  fontSize: '0.625rem', fontWeight: 700,
                  color: floor.overallStatus === 'completed' ? colors.success : colors.warning,
                }}>
                  {floor.overallStatus === 'completed' ? 'Completed' : 'In Progress'}
                </Typography>
              </Box>
            )}
          </Box>
          <Typography sx={{ fontSize: '0.75rem', color: P.subtle, mt: 0.25 }} noWrap>
            {floor.analyzed ? formatLastInspection(floor.lastInspection) : 'Not analyzed yet'}
          </Typography>
        </Box>

        <ChevronRightRounded sx={{ fontSize: 20, color: P.subtle, flexShrink: 0 }} />
      </Box>

      {floor.analyzed && (
        <IconButton
          size="small"
          onClick={e => { e.preventDefault(); e.stopPropagation(); onDelete(floor); }}
          sx={{ color: P.subtle, flexShrink: 0, '&:hover': { color: colors.danger, backgroundColor: `${colors.danger}0f` } }}
          aria-label="Delete progress reports"
        >
          <DeleteOutlineRounded sx={{ fontSize: 19 }} />
        </IconButton>
      )}
    </Box>
  );
}

export default function ConstructionProgressOverviewPage() {
  const [loading, setLoading] = useState(true);
  const [floors, setFloors] = useState<FloorSummary[]>([]);
  const [selectedProject, setSelectedProject] = useState('');
  const [selectedTower, setSelectedTower] = useState('');
  const [selectedFloor, setSelectedFloor] = useState('');
  const [pendingDelete, setPendingDelete] = useState<FloorSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  const allProjects = useWorkflowStore(s => s.projects);
  const allTowers = useWorkflowStore(s => s.towers);
  const allFloors = useWorkflowStore(s => s.floors);

  useEffect(() => {
    setLoading(true);
    constructionProgressService.listFloors()
      .then(setFloors)
      .catch(() => toast.error('Failed to load floors'))
      .finally(() => setLoading(false));
  }, []);

  // Only projects/towers/floors that actually have at least one capture
  // (per the backend's filtered listFloors()) are selectable — otherwise
  // this page just dumps every floor in the org, most with nothing to show.
  const projectIdsWithCaptures = useMemo(() => new Set(floors.map(f => f.projectId)), [floors]);
  const towerIdsWithCaptures = useMemo(() => new Set(floors.map(f => f.towerId)), [floors]);
  const floorIdsWithCaptures = useMemo(() => new Set(floors.map(f => f.floorId)), [floors]);

  const projectOptions = useMemo(
    () => allProjects.filter(p => projectIdsWithCaptures.has(p.id)).map(p => ({ id: p.id, name: p.name })),
    [allProjects, projectIdsWithCaptures],
  );
  const towerOptions = useMemo(
    () => selectedProject
      ? getTowersByProject(allTowers, selectedProject)
          .filter(t => towerIdsWithCaptures.has(t.id))
          .map(t => ({ id: t.id, name: t.name }))
      : [],
    [allTowers, selectedProject, towerIdsWithCaptures],
  );
  const floorOptions = useMemo(
    () => selectedTower
      ? getFloorsByTower(allFloors, selectedTower)
          .filter(f => floorIdsWithCaptures.has(f.id))
          .map(f => ({ id: f.id, name: f.label }))
      : [],
    [allFloors, selectedTower, floorIdsWithCaptures],
  );

  const selectedFloorSummary = floors.find(f => f.floorId === selectedFloor) ?? null;
  const previousReports = useMemo(
    () => floors.filter(f => f.analyzed).sort((a, b) => (b.lastInspection ?? '').localeCompare(a.lastInspection ?? '')),
    [floors],
  );

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await constructionProgressService.deleteFloorReports(pendingDelete.floorId);
      setFloors(prev => prev.map(f => (
        f.floorId === pendingDelete.floorId
          ? { ...f, analyzed: false, overallProgressPct: null, lastInspection: null }
          : f
      )));
      toast.success('Progress reports deleted');
      setPendingDelete(null);
    } catch {
      toast.error('Failed to delete progress reports');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Box sx={{ maxWidth: 960, mx: 'auto', px: { xs: 2, sm: 3 }, py: 4 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.5 }}>
        <Box
          sx={{
            width: 40, height: 40, borderRadius: '10px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: colors.primaryGradient,
          }}
        >
          <InsightsRounded sx={{ fontSize: 22, color: '#fff' }} />
        </Box>
        <Typography sx={{ fontSize: '1.375rem', fontWeight: 800, color: P.strong }}>
          Construction Progress
        </Typography>
      </Box>
      <Typography sx={{ fontSize: '0.9375rem', color: P.muted, mb: 3, ml: '52px' }}>
        Choose a project, tower, and floor to view its AI-estimated finishing progress.
      </Typography>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress size={28} sx={{ color: colors.primary }} />
        </Box>
      ) : floors.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 8 }}>
          <HourglassEmptyRounded sx={{ fontSize: 36, color: P.subtle, mb: 1 }} />
          <Typography sx={{ fontSize: '0.9375rem', color: P.muted }}>
            No floors have any captures yet. Progress can only be estimated once field engineers upload photos.
          </Typography>
        </Box>
      ) : (
        <>
          <Box
            sx={{
              display: 'flex', gap: 2, flexWrap: 'wrap', p: 2.5, mb: 3,
              borderRadius: '14px', border: `1.5px solid ${P.border}`, backgroundColor: P.bg,
            }}
          >
            <SelectorStep
              icon={<FolderOpenRounded sx={{ fontSize: 14 }} />}
              label="Project"
              value={selectedProject}
              onChange={v => { setSelectedProject(v); setSelectedTower(''); setSelectedFloor(''); }}
              options={projectOptions}
              placeholder="Choose a project"
            />
            <SelectorStep
              icon={<BusinessRounded sx={{ fontSize: 14 }} />}
              label="Tower"
              value={selectedTower}
              onChange={v => { setSelectedTower(v); setSelectedFloor(''); }}
              options={towerOptions}
              disabled={!selectedProject}
              placeholder={selectedProject ? 'Choose a tower' : 'Select a project first'}
            />
            <SelectorStep
              icon={<LayersRounded sx={{ fontSize: 14 }} />}
              label="Floor"
              value={selectedFloor}
              onChange={setSelectedFloor}
              options={floorOptions}
              disabled={!selectedTower}
              placeholder={selectedTower ? 'Choose a floor' : 'Select a tower first'}
            />
          </Box>

          {selectedFloorSummary ? (
            <FloorCard floor={selectedFloorSummary} onDelete={setPendingDelete} />
          ) : (
            <>
              <Box sx={{ textAlign: 'center', py: 4 }}>
                <Typography sx={{ fontSize: '0.875rem', color: P.subtle }}>
                  Select a project, tower, and floor above to view its progress dashboard.
                </Typography>
              </Box>

              {previousReports.length > 0 && (
                <Box sx={{ mt: 2 }}>
                  <Typography sx={{ fontSize: '0.8125rem', fontWeight: 700, color: P.muted, mb: 1.5 }}>
                    Previous Reports
                  </Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                    {previousReports.map(f => (
                      <FloorCard key={f.floorId} floor={f} onDelete={setPendingDelete} />
                    ))}
                  </Box>
                </Box>
              )}
            </>
          )}
        </>
      )}

      {pendingDelete && (
        <DeleteConfirmModal
          floor={pendingDelete}
          deleting={deleting}
          onCancel={() => setPendingDelete(null)}
          onConfirm={handleConfirmDelete}
        />
      )}
    </Box>
  );
}
