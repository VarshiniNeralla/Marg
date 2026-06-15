import apiClient from '@services/apiClient';
import type { AuthUser } from '@store/authStore';
import type { RegisterFormValues } from '../schemas/authSchemas';

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
    const { data } = await apiClient.post<ApiEnvelope<LoginResponse>>(
      '/auth/login',
      payload
    );
    return data.data;
  },

  async register(payload: RegisterFormValues): Promise<{ id: string; name: string }> {
    const { data } = await apiClient.post<ApiEnvelope<{ id: string; name: string }>>(
      '/auth/register',
      payload
    );
    return data.data;
  },

  async forgotPassword(email: string): Promise<void> {
    await apiClient.post('/auth/forgot-password', { email });
  },

  async resetPassword(token: string, new_password: string): Promise<void> {
    await apiClient.post('/auth/reset-password', { token, new_password });
  },

  async logout(): Promise<void> {
    await apiClient.post('/auth/logout');
  },
};
