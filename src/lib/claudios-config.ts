export const claudiosConfig = {
  sessionManagerUrl: process.env.SESSION_MANAGER_URL || 'http://localhost:7655',
  acpUrl: process.env.ACP_URL || 'http://localhost:9878',
  wshubUrl: process.env.WSHUB_URL || 'ws://localhost:9877/ws',
  claudiosApiUrl: process.env.CLAUDIOS_API_URL || 'http://localhost:3000',
  wshubPsk: process.env.WSHUB_PSK || '',
  pollIntervalMs: 10_000,
  stalledThresholdMs: 10 * 60 * 1000, // 10 minutes — session active but no activity = stalled/error
} as const
