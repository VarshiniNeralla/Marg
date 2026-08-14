import React from 'react';
import { Box, Typography, Grid } from '@mui/material';
import {
  PhotoCameraRounded, ArrowForwardRounded,
  MapRounded, HistoryRounded,
  FolderOpenRounded, CloudUploadRounded, HourglassTopRounded, CheckCircleRounded,
} from '@mui/icons-material';
import { Link } from 'react-router-dom';
import { useAuthStore } from '@store/authStore';
import { useWorkflowStore } from '@store/workflowStore';
import DashboardHero from '@shared/components/DashboardHero/DashboardHero';
import { filterGalleryCaptures } from '@/utils/captureGallery';

/* ─── palette ────────────────────────────────────────────────────────────── */
const P = {
  black:      '#080a0d',
  ink:        '#111318',
  inkSurface: '#1a1d24',
  border:     '#e4e7ec',
  borderDark: 'rgba(255,255,255,0.07)',
  muted:      '#6b7280',
  subtle:     '#9ca3af',
  body:       '#374151',
  strong:     '#111827',
  blue:       '#2563eb',
  blueHover:  '#1d4ed8',
  blueSoft:   'rgba(37,99,235,0.08)',
  blueRing:   'rgba(37,99,235,0.18)',
  white:      '#ffffff',
  bg:         '#f7f8fa',
};

const EASE = 'cubic-bezier(0.4,0,0.2,1)';
const T = `all 160ms ${EASE}`;

export default function EngineerDashboard() {
  const user     = useAuthStore(s => s.user);
  const projects = useWorkflowStore(s => s.projects);
  const captures = useWorkflowStore(s => s.captures);
  const capturePins = useWorkflowStore(s => s.capturePins);
  const tours    = useWorkflowStore(s => s.tours);

  // Same project scope as Capture History (/my-captures): assigned projects when
  // set, otherwise every active project (do not slice to 3 — that under-counted uploads).
  const assignedIds = user?.assignedProjectIds ?? [];
  const assignedSet = assignedIds.length > 0 ? new Set(assignedIds) : null;
  const myProjects = assignedSet
    ? projects.filter(p => assignedSet.has(p.id) && !p.archived)
    : projects.filter(p => !p.archived);

  // Same count as Capture History cards: one per pin (latest visit), not every visit.
  const myCaptures = filterGalleryCaptures(captures, capturePins, assignedSet);
  const myProjectIds = new Set(myProjects.map(p => p.id));
  const pendingTours  = tours.filter(t => myProjectIds.has(t.projectId) && t.status === 'published' && !(t as any).managerReviewed);
  const reviewedTours = tours.filter(t => myProjectIds.has(t.projectId) && (t as any).managerReviewed);

  const hour     = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const name     = user?.name?.split(' ')[0] ?? 'Engineer';

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto', pb: 6 }}>

      <DashboardHero
        eyebrow="My Overview"
        greeting={`${greeting}, ${name}`}
        subtitle="Your capture assignments and upload status"
        ctaLabel="Start Capture"
        ctaIcon={<PhotoCameraRounded sx={{ fontSize: 19 }} />}
        ctaTo="/capture-workflow"
        accent={P.blue}
        accentHover={P.blueHover}
      />

      {/* ════════════════════════════════════════════════════════════════════
          KPI STRIP
      ════════════════════════════════════════════════════════════════════ */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        {[
          { label:'Assigned Projects', value: myProjects.length,     sub:'active sites',          color: P.blue,    bg: 'rgba(37,99,235,0.08)',   icon: <FolderOpenRounded /> },
          { label:'Total Uploads',     value: myCaptures.length,     sub:'captures uploaded',     color: '#0891b2', bg: 'rgba(8,145,178,0.08)',   icon: <CloudUploadRounded /> },
          { label:'Pending Review',    value: pendingTours.length,   sub:'tours awaiting review', color: '#d97706', bg: 'rgba(217,119,6,0.08)',   icon: <HourglassTopRounded /> },
          { label:'Reviewed',          value: reviewedTours.length,  sub:'tours reviewed',        color: '#16a34a', bg: 'rgba(22,163,74,0.08)',   icon: <CheckCircleRounded /> },
        ].map(({ label, value, sub, color, bg, icon }) => (
          <Grid key={label} size={{ xs:6, md:3 }}>
            <Box sx={{
              position: 'relative', overflow: 'hidden',
              p: { xs: 2, sm: 2.25 }, borderRadius: '16px',
              backgroundColor: P.white,
              border: `1px solid ${P.border}`,
              transition: T,
              '&:hover': { transform: 'translateY(-1px)', boxShadow: `0 4px 16px rgba(0,0,0,0.07)` },
            }}>
              {/* top accent bar */}
              <Box sx={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, borderRadius: '16px 16px 0 0', backgroundColor: color, opacity: 0.7 }} />
              <Box sx={{ width: 36, height: 36, borderRadius: '10px', backgroundColor: bg, color, display: 'flex', alignItems: 'center', justifyContent: 'center', mb: 1.5, '& svg': { fontSize: 18 } }}>
                {icon}
              </Box>
              <Typography sx={{ fontSize: '0.8125rem', fontWeight: 500, color: P.muted, mb: 0.375 }}>{label}</Typography>
              <Typography sx={{ fontSize: '1.5rem', fontWeight: 800, color: P.strong, lineHeight: 1, letterSpacing: '-0.03em' }}>{value}</Typography>
              <Typography sx={{ fontSize: '0.75rem', color: P.subtle, mt: 0.375 }}>{sub}</Typography>
            </Box>
          </Grid>
        ))}
      </Grid>

      {/* ════════════════════════════════════════════════════════════════════
          NAV CARDS — all three in one Grid so widths are identical
      ════════════════════════════════════════════════════════════════════ */}
      <Grid container spacing={1.5} sx={{ mb: 3 }}>
        {/* Capture Workflow — full width */}
        <Grid size={{ xs:12 }}>
          <Box
            component={Link}
            to="/capture-workflow"
            sx={{
              display:'flex', alignItems:'center', gap:3,
              px:2.5, py:2.75,
              borderRadius:'16px',
              backgroundColor: P.white,
              border:`1.5px solid ${P.border}`,
              textDecoration:'none',
              transition: T,
              boxShadow:'0 1px 3px rgba(0,0,0,0.04)',
              '&:hover':{ borderColor: P.blueRing, boxShadow:`0 6px 24px rgba(37,99,235,0.1)`, transform:'translateY(-1px)' },
              '&:hover .arrow-icon':{ transform:'translateX(3px)', color: P.blue },
            }}
          >
            <Box sx={{
              width:50, height:50, borderRadius:'14px', flexShrink:0,
              background:`linear-gradient(135deg, ${P.blue} 0%, ${P.blueHover} 100%)`,
              display:'flex', alignItems:'center', justifyContent:'center',
              boxShadow:`0 4px 16px rgba(37,99,235,0.35)`,
            }}>
              <PhotoCameraRounded sx={{ fontSize:24, color:P.white }} />
            </Box>

            <Box sx={{ flex:1 }}>
              <Typography sx={{ fontSize:'1rem', fontWeight:700, color:P.strong, letterSpacing:'-0.02em', mb:0.25 }}>
                Capture Workflow
              </Typography>
              <Typography sx={{ fontSize:'0.8125rem', color:P.muted }}>
                Choose Project, Tower, Floor, and capture the image.
              </Typography>
            </Box>

            <Box sx={{ px:1.5, py:0.5, borderRadius:'8px', backgroundColor: P.blueSoft,
              fontSize:'0.6875rem', fontWeight:700, color: P.blue, flexShrink:0, display:{ xs:'none', sm:'block' } }}>
              Primary
            </Box>

            <ArrowForwardRounded className="arrow-icon" sx={{ fontSize:18, color:P.subtle, flexShrink:0, transition: T }} />
          </Box>
        </Grid>

        {/* Capture History + Floor Plans — half width each */}
        {[
          { to:'/my-captures', icon:<HistoryRounded sx={{ fontSize:20 }} />, label:'Capture History',
            desc:'View all your uploaded captures', accent: P.strong },
          { to:'/floor-plans',  icon:<MapRounded sx={{ fontSize:20 }} />,    label:'Floor Plans',
            desc:'Browse uploaded site blueprints', accent: P.blue },
        ].map(c => (
          <Grid key={c.to} size={{ xs:12, sm:6 }}>
            <Box component={Link} to={c.to} sx={{
              display:'flex', alignItems:'center', gap:2,
              px:2.5, py:2.25, borderRadius:'14px',
              backgroundColor: P.white,
              border:`1.5px solid ${P.border}`,
              textDecoration:'none',
              transition: T,
              boxShadow:'0 1px 3px rgba(0,0,0,0.04)',
              '&:hover':{ borderColor:`${c.accent}40`, boxShadow:`0 4px 16px ${c.accent}10`, transform:'translateY(-1px)' },
              '&:hover .sec-arrow':{ transform:'translateX(3px)', color: c.accent },
              '&:hover .sec-icon':{ color: c.accent, backgroundColor:`${c.accent}12` },
            }}>
              <Box className="sec-icon" sx={{ width:40, height:40, borderRadius:'11px',
                backgroundColor:`${c.accent}0d`, color: c.accent,
                display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, transition: T }}>
                {c.icon}
              </Box>
              <Box sx={{ flex:1, minWidth:0 }}>
                <Typography sx={{ fontSize:'0.875rem', fontWeight:700, color:P.strong, letterSpacing:'-0.01em' }}>{c.label}</Typography>
                <Typography sx={{ fontSize:'0.75rem', color:P.muted }}>{c.desc}</Typography>
              </Box>
              <ArrowForwardRounded className="sec-arrow" sx={{ fontSize:16, color:P.subtle, flexShrink:0, transition: T }} />
            </Box>
          </Grid>
        ))}
      </Grid>


    </Box>
  );
}
