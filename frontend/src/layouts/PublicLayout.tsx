import React from 'react';
import { Outlet } from 'react-router-dom';

interface PublicLayoutProps {
  children?: React.ReactNode;
}

export default function PublicLayout({ children }: PublicLayoutProps) {
  return <>{children ?? <Outlet />}</>;
}
