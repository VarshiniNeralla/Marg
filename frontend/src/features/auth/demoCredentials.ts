/**
 * Demo accounts listed on the (development-only) login page for the Kohinoor tenant.
 *
 * E-mail addresses and roles ONLY. Passwords are deliberately NOT in source: they are generated
 * during provisioning and delivered in a Windows-user-restricted local credentials file.
 * (The My Home list on the login page predates this and is intentionally left unchanged.)
 */
export interface KohinoorDemoCredential {
  role: 'admin' | 'manager' | 'field_engineer';
  roleLabel: string;
  email: string;
  color: string;
}

export const KOHINOOR_DEMO_CREDENTIALS: readonly KohinoorDemoCredential[] = [
  { role: 'admin',          roleLabel: 'Admin',          email: 'admin@kohinoorpune.com',        color: '#3b82f6' },
  { role: 'manager',        roleLabel: 'Manager',        email: 'manager@kohinoorpune.com',      color: '#8b5cf6' },
  { role: 'field_engineer', roleLabel: 'Field Engineer', email: 'engineerdemo@kohinoorpune.com', color: '#10b981' },
];

export const KOHINOOR_DEMO_PASSWORD_HINT =
  'Passwords are not stored in the app. Use the credentials file provided by your administrator.';
