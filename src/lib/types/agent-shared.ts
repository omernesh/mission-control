/**
 * Shared types used across agent panel components.
 * Centralises WorkItem, HeartbeatResponse, SoulTemplate, and status maps.
 */

export interface WorkItem {
  type: string
  count: number
  items: unknown[]
}

export interface HeartbeatResponse {
  status: 'HEARTBEAT_OK' | 'WORK_ITEMS_FOUND'
  agent: string
  checked_at: number
  work_items?: WorkItem[]
  total_items?: number
  message?: string
}

export interface SoulTemplate {
  name: string
  description: string
  size: number
}

export const statusColors: Record<string, string> = {
  offline: 'bg-gray-500',
  idle: 'bg-green-500',
  busy: 'bg-yellow-500',
  error: 'bg-red-500',
}

export const statusIcons: Record<string, string> = {
  offline: '-',
  idle: 'o',
  busy: '~',
  error: '!',
}
