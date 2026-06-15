import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Typography, TextField, Dialog, LinearProgress } from '@mui/material';
import {
  BusinessRounded, FolderOpenRounded, DomainRounded, CameraAltRounded,
  CheckCircleRounded, ArrowForwardRounded, CloseRounded,
} from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import { useAuthStore } from '@store/authStore';

const ONBOARD_KEY = 'sitesurelabs_onboarded';

export function isOnboarded(): boolean {
  return localStorage.getItem(ONBOARD_KEY) === 'true';
}

function markOnboarded() {
  localStorage.setItem(ONBOARD_KEY, 'true');
}

const STEPS = [
  { num: 1, icon: <BusinessRounded sx={{ fontSize: 28 }} />, title: 'Set up your organization', desc: 'Tell us about your organization to personalize your workspace.' },
  { num: 2, icon: <FolderOpenRounded sx={{ fontSize: 28 }} />, title: 'Create your first project', desc: 'A project represents a single construction site or development.' },
  { num: 3, icon: <DomainRounded sx={{ fontSize: 28 }} />, title: 'Add a tower', desc: 'Towers group the floors and rooms within your project.' },
  { num: 4, icon: <CameraAltRounded sx={{ fontSize: 28 }} />, title: 'Upload your first capture', desc: 'Upload a 360° panoramic image to start building digital twins.' },
];

const fieldSx = {
  '& .MuiOutlinedInput-root': {
    borderRadius: '10px', fontSize: '0.9375rem',
    '& .MuiOutlinedInput-notchedOutline': { borderColor: '#e5e7eb' },
    '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#cbd5e1' },
    '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: colors.primary, borderWidth: 1.5 },
  },
};

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function OnboardingWizard({ open, onClose }: Props) {
  const navigate = useNavigate();
  const user = useAuthStore(s => s.user);
  const [step, setStep] = useState(0);
  const [orgName, setOrgName] = useState('');
  const [projectName, setProjectName] = useState('');
  const [towerName, setTowerName] = useState('');
  const [done, setDone] = useState(false);

  const progress = ((step + 1) / STEPS.length) * 100;

  function handleNext() {
    if (step < STEPS.length - 1) {
      setStep(s => s + 1);
    }
  }

  function handleFinish() {
    markOnboarded();
    setDone(true);
    setTimeout(() => {
      onClose();
      navigate('/captures/upload');
    }, 1500);
  }

  function handleSkip() {
    markOnboarded();
    onClose();
  }

  const currentStep = STEPS[step];

  return (
    <Dialog open={open} maxWidth="sm" fullWidth slotProps={{ paper: { sx: { borderRadius: '24px', overflow: 'hidden' } } }}>
      {/* Progress bar */}
      <LinearProgress variant="determinate" value={progress} sx={{ height: 3, backgroundColor: colors.bgDeep, '& .MuiLinearProgress-bar': { background: colors.primaryGradient } }} />

      <Box sx={{ p: 4 }}>
        {done ? (
          <Box sx={{ textAlign: 'center', py: 3 }}>
            <CheckCircleRounded sx={{ fontSize: 56, color: colors.success, mb: 2 }} />
            <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: '1.5rem', fontWeight: 800, color: colors.textStrong, mb: 1, letterSpacing: '-0.04em' }}>
              You're all set!
            </Typography>
            <Typography sx={{ fontSize: '1rem', color: colors.textMuted }}>
              Redirecting you to upload your first capture…
            </Typography>
          </Box>
        ) : (
          <>
            {/* Header */}
            <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 3 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Box sx={{ width: 48, height: 48, borderRadius: '14px', backgroundColor: colors.primarySoft, color: colors.primary, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {currentStep.icon}
                </Box>
                <Box>
                  <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: colors.textSubdued, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 0.25 }}>
                    Step {step + 1} of {STEPS.length}
                  </Typography>
                  <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: '1.125rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.03em' }}>
                    {currentStep.title}
                  </Typography>
                </Box>
              </Box>
              <Box onClick={handleSkip} sx={{ color: colors.textSubdued, cursor: 'pointer', '&:hover': { color: colors.textStrong }, p: 0.5 }}>
                <CloseRounded sx={{ fontSize: 20 }} />
              </Box>
            </Box>

            <Typography sx={{ fontSize: '0.9375rem', color: colors.textMuted, mb: 3, lineHeight: 1.6 }}>
              {currentStep.desc}
            </Typography>

            {/* Step-specific form */}
            {step === 0 && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <TextField label="Organization Name" value={orgName} onChange={e => setOrgName(e.target.value)} fullWidth placeholder="e.g. My Home Constructions" sx={fieldSx} />
                <TextField label="Your Name" defaultValue={user?.name ?? ''} fullWidth sx={fieldSx} />
              </Box>
            )}
            {step === 1 && (
              <TextField label="Project Name" value={projectName} onChange={e => setProjectName(e.target.value)} fullWidth placeholder="e.g. My Home Udyan Phase 2" sx={fieldSx} />
            )}
            {step === 2 && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <TextField label="Tower Name" value={towerName} onChange={e => setTowerName(e.target.value)} fullWidth placeholder="e.g. Tower A" sx={fieldSx} />
                <TextField label="Number of Floors" type="number" defaultValue="14" fullWidth sx={fieldSx} />
              </Box>
            )}
            {step === 3 && (
              <Box sx={{ p: 3, borderRadius: '12px', border: `2px dashed ${colors.border}`, textAlign: 'center', cursor: 'pointer', '&:hover': { borderColor: colors.primary, backgroundColor: colors.primarySoft }, transition: `all ${motion.durationFast}` }}>
                <CameraAltRounded sx={{ fontSize: 32, color: colors.textSubdued, mb: 1 }} />
                <Typography sx={{ fontSize: '0.9375rem', fontWeight: 600, color: colors.textStrong, mb: 0.25 }}>Click to choose files</Typography>
                <Typography sx={{ fontSize: '0.8125rem', color: colors.textMuted }}>JPG, PNG, DNG, INSP, INSV supported</Typography>
              </Box>
            )}

            {/* Step dots */}
            <Box sx={{ display: 'flex', justifyContent: 'center', gap: 1, mt: 3, mb: 1 }}>
              {STEPS.map((_, i) => (
                <Box key={i} sx={{ width: i === step ? 20 : 8, height: 8, borderRadius: '99px', backgroundColor: i <= step ? colors.primary : colors.border, transition: `all ${motion.durationNormal}` }} />
              ))}
            </Box>

            {/* Actions */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 3 }}>
              <Box onClick={handleSkip} sx={{ fontSize: '0.875rem', color: colors.textMuted, cursor: 'pointer', '&:hover': { color: colors.textStrong } }}>
                Skip setup
              </Box>
              <Box onClick={step < STEPS.length - 1 ? handleNext : handleFinish} sx={{
                display: 'inline-flex', alignItems: 'center', gap: 1, px: 2.5, py: 1.25, borderRadius: '10px',
                background: colors.primaryGradient, color: '#fff', fontWeight: 700, fontSize: '0.9375rem',
                cursor: 'pointer', boxShadow: '0 4px 14px rgba(37,99,235,0.28)',
                '&:hover': { opacity: 0.9 }, transition: `opacity ${motion.durationFast}`,
              }}>
                {step < STEPS.length - 1 ? (
                  <>Continue <ArrowForwardRounded sx={{ fontSize: 16 }} /></>
                ) : (
                  <>Finish setup <CheckCircleRounded sx={{ fontSize: 16 }} /></>
                )}
              </Box>
            </Box>
          </>
        )}
      </Box>
    </Dialog>
  );
}
