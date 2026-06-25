import type { AuthUser, AppRole } from '@store/authStore';
import { authService as backendAuthService } from '@services/authService';

interface LoginPayload {
  email: string;
  password: string;
}

interface LoginResponse {
  access_token: string;
  user: AuthUser;
}

// ── Mock credential table ─────────────────────────────────────────────────────
// Used when the backend is unreachable (network error / dev without server).
// Password for all mock accounts: Horizon@123

const MOCK_USERS: AuthUser[] = [
  {
    id: 'u1',
    name: 'Priya Sharma',
    email: 'priya@myhomeconstructions.com',
    role: 'admin',
    org_id: 'org1',
    org_name: 'My Home Constructions',
    org_slug: 'myhome',
    avatar_url: null,
    assignedProjectIds: ['1', '2', '3', '4'],
  },
  {
    id: 'u2',
    name: 'Ravi Kumar',
    email: 'ravi@myhomeconstructions.com',
    role: 'manager',
    org_id: 'org1',
    org_name: 'My Home Constructions',
    org_slug: 'myhome',
    avatar_url: null,
    assignedProjectIds: ['1', '3'],
  },
  {
    id: 'u7',
    name: 'Kiran Desai',
    email: 'kiran@myhomeconstructions.com',
    role: 'field_engineer',
    org_id: 'org1',
    org_name: 'My Home Constructions',
    org_slug: 'myhome',
    avatar_url: null,
    assignedProjectIds: ['1'],
  },
];

const MOCK_PASSWORD = 'Horizon@123';

function mockLogin(email: string, password: string): LoginResponse | null {
  if (password !== MOCK_PASSWORD) return null;
  const user = MOCK_USERS.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (!user) return null;
  return {
    access_token: `mock-token-${user.id}-${Date.now()}`,
    user,
  };
}

// ── Auth service ──────────────────────────────────────────────────────────────

export const authService = {
  async login(payload: LoginPayload): Promise<LoginResponse> {
    try {
      const data = await backendAuthService.login(payload);
      return {
        access_token: data.access_token,
        user: {
          ...data.user,
          org_slug: 'default',
          role: (data.user.role === 'user' ? 'field_engineer' : data.user.role) as AuthUser['role'],
        } satisfies AuthUser,
      };
    } catch (err: unknown) {
      // If backend is unreachable (network error), fall through to mock login.
      const isNetworkError =
        typeof err === 'object' && err !== null &&
        ('code' in err
          ? (err as { code?: string }).code === 'ERR_NETWORK' ||
            (err as { code?: string }).code === 'ECONNREFUSED'
          : !('response' in err && (err as { response?: unknown }).response));

      if (isNetworkError) {
        const mock = mockLogin(payload.email, payload.password);
        if (mock) return mock;
        throw new Error('Invalid email or password.');
      }
      throw err;
    }
  },

  async forgotPassword(email: string): Promise<void> {
    try {
      await backendAuthService.forgotPassword({ email });
    } catch {
      // In mock mode, silently succeed.
    }
  },

  async resetPassword(token: string, new_password: string): Promise<void> {
    try {
      await backendAuthService.resetPassword({ token, new_password });
    } catch {
      // In mock mode, silently succeed.
    }
  },

  async logout(): Promise<void> {
    try {
      await backendAuthService.logout();
    } catch {
      // Ignore — clearAuth() in the store handles client-side cleanup.
    }
  },
};
