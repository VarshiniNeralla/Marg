import type { AuthUser } from '@store/authStore';
import type { RegisterFormValues } from '../schemas/authSchemas';
import { authService as backendAuthService } from '@services/authService';

interface LoginPayload {
  email: string;
  password: string;
}

interface LoginResponse {
  access_token: string;
  user: AuthUser;
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  message?: string;
}

export const authService = {
  async login(payload: LoginPayload): Promise<LoginResponse> {
    const data = await backendAuthService.login(payload);
    return {
      access_token: data.access_token,
      user: {
        ...data.user,
        org_slug: 'default',
      } satisfies AuthUser,
    };
  },

  async register(payload: RegisterFormValues): Promise<{ id: string; name: string }> {
    const data = await backendAuthService.register(payload);
    return { id: data.id, name: data.name };
  },

  async forgotPassword(email: string): Promise<void> {
    await backendAuthService.forgotPassword({ email });
  },

  async resetPassword(token: string, new_password: string): Promise<void> {
    await backendAuthService.resetPassword({ token, new_password });
  },

  async logout(): Promise<void> {
    await backendAuthService.logout();
  },
};
