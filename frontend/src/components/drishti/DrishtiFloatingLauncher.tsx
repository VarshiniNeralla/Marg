import { Box, Tooltip } from '@mui/material';
import { useNavigate, useLocation } from 'react-router-dom';
import { colors, zIndex, motion } from '@theme/tokens';

/** Cute girl-bot face — rounded head, antenna, friendly eyes, blush — drawn
 * inline so the launcher needs no external asset/network request. */
function BotAvatar() {
  return (
    <svg width="34" height="34" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* antenna */}
      <line x1="32" y1="6" x2="32" y2="14" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="32" cy="5" r="3.5" fill="#ffd166" />
      {/* head */}
      <rect x="10" y="14" width="44" height="38" rx="16" fill="#ffffff" />
      {/* two little hair tufts / bow to read as "girl" */}
      <path d="M18 20 Q14 12 22 13 Q20 16 20 20 Z" fill="#ff8fab" />
      <path d="M46 20 Q50 12 42 13 Q44 16 44 20 Z" fill="#ff8fab" />
      <circle cx="32" cy="17" r="4" fill="#ff8fab" />
      <circle cx="29" cy="16" r="1.4" fill="#ffffff" />
      {/* face */}
      <circle cx="24" cy="33" r="4.2" fill="#243b55" />
      <circle cx="40" cy="33" r="4.2" fill="#243b55" />
      <circle cx="22.7" cy="31.3" r="1.2" fill="#ffffff" />
      <circle cx="38.7" cy="31.3" r="1.2" fill="#ffffff" />
      {/* blush */}
      <circle cx="17" cy="38" r="3" fill="#ff8fab" opacity="0.55" />
      <circle cx="47" cy="38" r="3" fill="#ff8fab" opacity="0.55" />
      {/* smile */}
      <path d="M25 41 Q32 47 39 41" stroke="#243b55" strokeWidth="2.5" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export default function DrishtiFloatingLauncher() {
  const navigate = useNavigate();
  const location = useLocation();

  // Hide on Drishti's own pages — no point floating a launcher for the page you're already on.
  if (location.pathname.startsWith('/drishti')) return null;

  return (
    <Tooltip title="Ask Drishti" placement="left">
      <Box
        role="button"
        aria-label="Open Drishti, your construction intelligence assistant"
        onClick={() => navigate('/drishti')}
        sx={{
          position: 'fixed',
          right: { xs: 16, sm: 28 },
          bottom: { xs: 16, sm: 28 },
          zIndex: zIndex.nav,
          width: 60,
          height: 60,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          background: `linear-gradient(135deg, ${colors.primary}, #6d8dff)`,
          boxShadow: '0 10px 28px rgba(37,99,235,0.35)',
          border: '2px solid rgba(255,255,255,0.6)',
          transition: `transform ${motion.durationFast} ${motion.easeOut}, box-shadow ${motion.durationFast}`,
          '&:hover': {
            transform: 'translateY(-3px) scale(1.04)',
            boxShadow: '0 14px 34px rgba(37,99,235,0.42)',
          },
          '&:active': { transform: 'translateY(-1px) scale(0.98)' },
        }}
      >
        <BotAvatar />
      </Box>
    </Tooltip>
  );
}
