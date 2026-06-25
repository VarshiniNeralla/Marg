import React from 'react';
import { Navigate } from 'react-router-dom';

// Registration is disabled — users are created by Admin only.
export default function RegisterPage() {
  return <Navigate to="/login" replace />;
}
