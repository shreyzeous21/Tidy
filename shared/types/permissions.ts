/**
 * macOS privacy permissions Tidy asks for during first-run onboarding.
 *
 * - `folders`       Desktop / Documents / Downloads (TCC prompts in-app).
 * - `fullDiskAccess` Trash + protected folders (System Settings only).
 */
export type PermissionId = 'folders' | 'fullDiskAccess'

/** Every permission the onboarding flow walks through, in order. */
export const PERMISSION_IDS: readonly PermissionId[] = ['folders', 'fullDiskAccess']

export type PermissionState = 'granted' | 'denied'

export interface PermissionStatus {
  id: PermissionId
  state: PermissionState
  /** True when macOS offers no in-app prompt — access must be granted in System Settings. */
  systemSettingsOnly: boolean
}

export const SYSTEM_SETTINGS_ONLY: Record<PermissionId, boolean> = {
  folders: false,
  fullDiskAccess: true
}
