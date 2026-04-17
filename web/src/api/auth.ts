import { get, post } from './client.js';

export type Session = {
  authenticated: boolean;
  email: string | null;
};

export const authApi = {
  getSession: () => get<Session>('/auth/session'),
  loginStart: () => get<{ authUrl: string }>('/auth/login/start'),
  logout: () => post<void>('/auth/logout'),
};
