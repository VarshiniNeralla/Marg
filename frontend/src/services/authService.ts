import apiClient from './apiClient';
import type {
  ApiResponse,
  LoginRequest,
  LoginResponse,
  RegisterRequest,
  RegisterResponse,
  MeResponse,
  RefreshResponse,
  ForgotPasswordRequest,
  ResetPasswordRequest,
  ChangePasswordRequest,
} from '@/types/dto';

export const authService = {
  async login(payload: LoginRequest): Promise<LoginResponse> {
    const { data } = await apiClient.post<ApiResponse<LoginResponse>>('/auth/login', payload);
    return data.data!;
  },

  async register(payload: RegisterRequest): Promise<RegisterResponse> {
    const { data } = await apiClient.post<ApiResponse<RegisterResponse>>('/auth/register', payload);
    return data.data!;
  },

  async me(): Promise<MeResponse> {
    const { data } = await apiClient.get<ApiResponse<MeResponse>>('/auth/me');
    return data.data!;
  },

  async refresh(): Promise<RefreshResponse> {
    const { data } = await apiClient.post<ApiResponse<RefreshResponse>>('/auth/refresh', {});
    return data.data!;
  },

  async logout(): Promise<void> {
    await apiClient.post('/auth/logout', {});
  },

  async forgotPassword(payload: ForgotPasswordRequest): Promise<void> {
    await apiClient.post('/auth/forgot-password', payload);
  },

  async resetPassword(payload: ResetPasswordRequest): Promise<void> {
    await apiClient.post('/auth/reset-password', payload);
  },

  async changePassword(payload: ChangePasswordRequest): Promise<void> {
    await apiClient.put('/auth/me/password', payload);
  },
};
