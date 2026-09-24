export const env = {
  apiUrl: import.meta.env.VITE_API_URL ?? 'http://localhost:5001/api/v1',
  socketUrl: import.meta.env.VITE_SOCKET_URL ?? 'http://localhost:5001',
  appName: import.meta.env.VITE_APP_NAME ?? 'MedAssist',
  /** Live updates over Socket.IO; 'off' in tests (no real connections). */
  realtime: import.meta.env.VITE_REALTIME !== 'off',
} as const;
