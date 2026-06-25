import React from 'react';
import { Box, Typography, Grid } from '@mui/material';
import {
  PhotoCameraRounded, ArrowForwardRounded,
  MapRounded, HistoryRounded,
} from '@mui/icons-material';
import { Link } from 'react-router-dom';
import { useAuthStore } from '@store/authStore';
import { useWorkflowStore } from '@store/workflowStore';

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

  const assignedIds = new Set(user?.assignedProjectIds ?? []);
  const myProjects  = assignedIds.size
    ? projects.filter(p => assignedIds.has(p.id) && !p.archived)
    : projects.filter(p => !p.archived).slice(0, 3);

  const pending  = captures.filter(c => c.status === 'review');
  const reviewed = captures.filter(c => c.status === 'processed');

  const hour     = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const name     = user?.name?.split(' ')[0] ?? 'Engineer';

  return (
    <Box sx={{ maxWidth: 960, mx: 'auto', pb: 6 }}>

      {/* ════════════════════════════════════════════════════════════════════
          HERO — dark ink card, full width
      ════════════════════════════════════════════════════════════════════ */}
      <Box
        sx={{
          position: 'relative', overflow: 'hidden',
          borderRadius: '20px', mb: 3,
          background: `linear-gradient(140deg, ${P.black} 0%, ${P.ink} 60%, #0a0f1a 100%)`,
          border: `1px solid ${P.borderDark}`,
          boxShadow: '0 20px 60px rgba(0,0,0,0.28), 0 1px 0 rgba(255,255,255,0.04) inset',
        }}
      >
        {/* Grid noise */}
        <Box sx={{ position:'absolute', inset:0, opacity:0.03, pointerEvents:'none',
          backgroundImage:`linear-gradient(rgba(255,255,255,1) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,1) 1px,transparent 1px)`,
          backgroundSize:'28px 28px' }} />
        {/* Blue radial */}
        <Box sx={{ position:'absolute', top:-80, left:-80, width:320, height:320, borderRadius:'50%',
          background:`radial-gradient(circle, rgba(37,99,235,0.15) 0%, transparent 65%)`, pointerEvents:'none' }} />
        {/* Red radial */}
        <Box sx={{ position:'absolute', bottom:-60, right:80, width:240, height:240, borderRadius:'50%',
          background:`radial-gradient(circle, rgba(220,38,38,0.11) 0%, transparent 65%)`, pointerEvents:'none' }} />

        <Box sx={{ position:'relative', px:{ xs:3, md:5 }, pt:{ xs:3.5, md:4.5 }, pb:{ xs:3, md:4 },
          display:'flex', alignItems:'center', justifyContent:'space-between', gap:3, flexWrap:'wrap' }}>
          <Box>
            <Typography sx={{ fontSize:'0.6875rem', fontWeight:700, letterSpacing:'0.12em',
              textTransform:'uppercase', color:'rgba(255,255,255,0.32)', mb:1.25 }}>
              My Overview
            </Typography>
            <Typography sx={{
              fontFamily:'"Google Sans Flex","Google Sans",Inter,sans-serif',
              fontSize:{ xs:'2rem', md:'2.625rem' }, fontWeight:800,
              color:P.white, letterSpacing:'-0.055em', lineHeight:1.05, mb:0.875,
            }}>
              {greeting}, {name}
            </Typography>
            <Typography sx={{ fontSize:'0.9375rem', color:'rgba(255,255,255,0.38)', letterSpacing:'-0.01em' }}>
              Your capture assignments and upload status
            </Typography>
          </Box>

          {/* CTA */}
          <Box component={Link} to="/capture-workflow" sx={{
            display:'flex', alignItems:'center', gap:1.5,
            px:2.75, py:1.5, borderRadius:'12px', flexShrink:0,
            background:`linear-gradient(135deg, ${P.blue} 0%, ${P.blueHover} 100%)`,
            color:P.white, textDecoration:'none',
            fontSize:'0.9375rem', fontWeight:700, letterSpacing:'-0.01em',
            boxShadow:`0 4px 20px rgba(37,99,235,0.5)`,
            transition: T,
            '&:hover':{ background:`linear-gradient(135deg,${P.blueHover} 0%,#1e40af 100%)`,
              boxShadow:`0 6px 28px rgba(37,99,235,0.6)`, transform:'translateY(-1px)' },
          }}>
            <PhotoCameraRounded sx={{ fontSize:19 }} />
            Start Capture
          </Box>
        </Box>

        {/* Bottom accent line */}
        <Box sx={{ height:2, background:`linear-gradient(90deg, ${P.blue}80 0%, transparent 100%)` }} />
      </Box>

      {/* ════════════════════════════════════════════════════════════════════
          KPI STRIP
      ════════════════════════════════════════════════════════════════════ */}
      <Grid container spacing={1.5} sx={{ mb: 3 }}>
        {[
          { label:'Assigned Projects', value: myProjects.length, sub:'active sites',      accent: P.blue    },
          { label:'Total Uploads',     value: captures.length,   sub:'captures uploaded', accent: P.strong  },
          { label:'Pending Review',    value: pending.length,    sub:'awaiting manager',  accent: '#d97706' },
          { label:'Reviewed',          value: reviewed.length,   sub:'captures reviewed', accent: '#16a34a' },
        ].map(({ label, value, sub, accent }) => (
          <Grid key={label} size={{ xs:6, md:3 }}>
            <Box sx={{
              px:2.5, py:2.5, borderRadius:'16px',
              backgroundColor: P.white,
              border:`1.5px solid ${P.border}`,
              boxShadow:'0 1px 3px rgba(0,0,0,0.04)',
              transition: T,
              '&:hover':{ borderColor: accent + '55', boxShadow:`0 4px 16px ${accent}14` },
            }}>
              <Typography sx={{ fontSize:'2rem', fontWeight:800, color: accent === P.strong ? P.strong : accent,
                letterSpacing:'-0.06em', lineHeight:1, mb:0.5 }}>
                {value}
              </Typography>
              <Typography sx={{ fontSize:'0.8125rem', fontWeight:600, color:P.strong, mb:0.125 }}>{label}</Typography>
              <Typography sx={{ fontSize:'0.6875rem', color:P.subtle }}>{sub}</Typography>
            </Box>
          </Grid>
        ))}
      </Grid>

      {/* ════════════════════════════════════════════════════════════════════
          CAPTURE WORKFLOW — primary nav card
      ════════════════════════════════════════════════════════════════════ */}
      <Box
        component={Link}
        to="/capture-workflow"
        sx={{
          display:'flex', alignItems:'center', gap:3,
          px:{ xs:2.5, md:3.5 }, py:2.75, mb:1.5,
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
        {/* Icon */}
        <Box sx={{
          width:50, height:50, borderRadius:'14px', flexShrink:0,
          background:`linear-gradient(135deg, ${P.blue} 0%, ${P.blueHover} 100%)`,
          display:'flex', alignItems:'center', justifyContent:'center',
          boxShadow:`0 4px 16px rgba(37,99,235,0.35)`,
        }}>
          <PhotoCameraRounded sx={{ fontSize:24, color:P.white }} />
        </Box>

        {/* Text */}
        <Box sx={{ flex:1 }}>
          <Typography sx={{ fontSize:'1rem', fontWeight:700, color:P.strong, letterSpacing:'-0.02em', mb:0.25 }}>
            Capture Workflow
          </Typography>
          <Typography sx={{ fontSize:'0.8125rem', color:P.muted }}>
          Choose Project, Tower, Floor, and capture the image.
          </Typography>
        </Box>

        {/* Pill badge */}
        <Box sx={{ px:1.5, py:0.5, borderRadius:'8px', backgroundColor: P.blueSoft,
          fontSize:'0.6875rem', fontWeight:700, color: P.blue, flexShrink:0, display:{ xs:'none', sm:'block' } }}>
          Primary
        </Box>

        <ArrowForwardRounded className="arrow-icon" sx={{ fontSize:18, color:P.subtle, flexShrink:0, transition: T }} />
      </Box>

      {/* ════════════════════════════════════════════════════════════════════
          SECONDARY NAV — 2 cards
      ════════════════════════════════════════════════════════════════════ */}
      <Grid container spacing={1.5} sx={{ mb: 3 }}>
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
