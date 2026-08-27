export const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "https://ssh.devbool.com"

export const RELEASES_FALLBACK_URL =
  (import.meta.env.VITE_RELEASES_PAGE_URL as string | undefined) ??
  "https://ssh.devbool.com/admin/releases"

export const GITHUB_REPO_URL = "https://github.com/prefnex/sshbool"
export const GITHUB_LATEST_RELEASE_URL = `${GITHUB_REPO_URL}/releases/latest`

export const UPDATE_SESSION_KEY = "updateSession"

export interface CmsPage {
  id: string
  title: string
  slug: string
  content: string
  updated_at: string | null
}

export async function fetchCmsPage(slug: string): Promise<CmsPage> {
  const response = await fetch(`${API_BASE_URL}/api/v1/pages/${encodeURIComponent(slug)}`)
  if (!response.ok) {
    throw new Error(`Failed to load page "${slug}" (${response.status})`)
  }
  return response.json() as Promise<CmsPage>
}

export interface ChangelogEntry {
  category: string
  description: string
}

export interface UpdateCheckResult {
  has_update: boolean
  current_version: string
  latest_version: string | null
  platform: string | null
  platform_download_url: string | null
  has_platform_download: boolean
  can_install_in_app: boolean
  notes: string | null
  publish_date: string | null
  download_url: string | null
  releases_page_url: string | null
  github_releases_url: string | null
  sha256_hash: string | null
  is_critical: boolean
  is_force: boolean
  changelog: ChangelogEntry[]
}

export async function checkForUpdate(
  platform: string,
  version: string,
  channel = "stable",
): Promise<UpdateCheckResult> {
  const params = new URLSearchParams({ platform, version, channel })
  const response = await fetch(`${API_BASE_URL}/api/v1/update/check?${params}`)
  if (!response.ok) {
    throw new Error(`Update check failed (${response.status})`)
  }
  return response.json() as Promise<UpdateCheckResult>
}

/** Prefer native platform from app_info; fall back to UA heuristic. */
export function resolveUpdatePlatform(appInfo?: { updatePlatform?: string | null }): string {
  if (appInfo?.updatePlatform) {
    return appInfo.updatePlatform
  }
  return getUpdatePlatformFromUserAgent()
}

/** @deprecated Use resolveUpdatePlatform(ipc.appInfo()) instead. */
export function getUpdatePlatform(): string {
  return getUpdatePlatformFromUserAgent()
}

function getUpdatePlatformFromUserAgent(): string {
  const ua = navigator.userAgent.toLowerCase()
  let os = "linux"
  if (ua.includes("win")) {
    os = "windows"
  } else if (ua.includes("mac")) {
    os = "darwin"
  }

  const arch =
    ua.includes("aarch64") || ua.includes("arm64") ? "aarch64" : "x86_64"

  return `${os}-${arch}`
}
