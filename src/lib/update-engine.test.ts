import { describe, expect, it } from "vitest"

import type { UpdateCheckResult } from "@/lib/api"
import type { AppInfoDto } from "@/lib/ipc/types"
import {
  calcUpdatePercent,
  canInstallUpdate,
  canUseOta,
  getGithubFallbackUrl,
  getInstallButtonLabel,
  getPlatformInstallSummary,
  hasPlatformPackage,
  resolveInstallMode,
  shouldAutoInstallOnPrompt,
  usesGithubFallback,
} from "@/lib/update-engine"

const baseUpdate = (overrides: Partial<UpdateCheckResult> = {}): UpdateCheckResult => ({
  has_update: true,
  current_version: "0.1.4",
  latest_version: "0.1.7",
  platform: "windows-x86_64",
  platform_download_url: "https://example.com/setup.exe",
  has_platform_download: true,
  can_install_in_app: true,
  notes: null,
  publish_date: null,
  download_url: "https://example.com/setup.exe",
  releases_page_url: "https://ssh.devbool.com/admin/releases",
  github_releases_url: "https://github.com/prefnex/sshbool/releases/latest",
  sha256_hash: null,
  is_critical: false,
  is_force: false,
  changelog: [],
  ...overrides,
})

const packagedApp: AppInfoDto = {
  name: "SSHBool",
  version: "0.1.4",
  tauriVersion: "2",
  updatePlatform: "windows-x86_64",
  installDir: "C:\\Program Files\\SSHBool",
  exePath: "C:\\Program Files\\SSHBool\\sshbool.exe",
  isPackaged: true,
}

describe("calcUpdatePercent", () => {
  it("returns null when total bytes is zero", () => {
    expect(calcUpdatePercent(100, 0)).toBeNull()
  })

  it("calculates rounded percentage", () => {
    expect(calcUpdatePercent(512, 1024)).toBe(50)
    expect(calcUpdatePercent(1024, 1024)).toBe(100)
  })
})

describe("resolveInstallMode", () => {
  it("uses OTA when signed artifact and packaged build in prod", () => {
    expect(resolveInstallMode(baseUpdate(), packagedApp, true)).toBe("ota")
    expect(canUseOta(baseUpdate(), packagedApp, true)).toBe(true)
  })

  it("uses direct download in dev when platform package exists", () => {
    expect(resolveInstallMode(baseUpdate(), packagedApp, false)).toBe("direct")
  })

  it("falls back to GitHub without platform package", () => {
    expect(
      resolveInstallMode(
        baseUpdate({
          has_platform_download: false,
          platform_download_url: null,
          can_install_in_app: false,
        }),
        packagedApp,
        true,
      ),
    ).toBe("github")
  })
})

describe("canInstallUpdate", () => {
  it("allows install when platform package or GitHub fallback exists", () => {
    expect(canInstallUpdate(baseUpdate())).toBe(true)
    expect(canInstallUpdate(baseUpdate({ has_platform_download: false, platform_download_url: null }))).toBe(true)
  })

  it("returns false for null update", () => {
    expect(canInstallUpdate(null)).toBe(false)
  })
})

describe("usesGithubFallback", () => {
  it("is false when platform package exists", () => {
    expect(usesGithubFallback(baseUpdate())).toBe(false)
    expect(hasPlatformPackage(baseUpdate())).toBe(true)
  })

  it("is true when no platform package", () => {
    expect(
      usesGithubFallback(baseUpdate({ has_platform_download: false, platform_download_url: null })),
    ).toBe(true)
  })
})

describe("getGithubFallbackUrl", () => {
  it("prefers API github url", () => {
    expect(getGithubFallbackUrl(baseUpdate())).toBe(
      "https://github.com/prefnex/sshbool/releases/latest",
    )
  })
})

describe("getPlatformInstallSummary", () => {
  it("includes platform and install dir for packaged builds", () => {
    expect(getPlatformInstallSummary(baseUpdate(), packagedApp)).toContain("windows-x86_64")
    expect(getPlatformInstallSummary(baseUpdate(), packagedApp)).toContain("Program Files")
  })

  it("explains dev build limitations", () => {
    expect(
      getPlatformInstallSummary(baseUpdate(), { ...packagedApp, isPackaged: false }),
    ).toContain("dev build")
  })
})

describe("getInstallButtonLabel", () => {
  it("shows Install update when platform package exists", () => {
    expect(getInstallButtonLabel(baseUpdate())).toBe("Install update")
  })

  it("shows GitHub when no platform package", () => {
    expect(
      getInstallButtonLabel(baseUpdate({ has_platform_download: false, platform_download_url: null })),
    ).toBe("View on GitHub")
  })

  it("shows phase labels while installing", () => {
    expect(
      getInstallButtonLabel(baseUpdate(), { phase: "downloading", percent: 40 }, true),
    ).toBe("Downloading…")
    expect(
      getInstallButtonLabel(baseUpdate(), { phase: "installing", percent: 100 }, true),
    ).toBe("Installing…")
  })
})

describe("shouldAutoInstallOnPrompt", () => {
  it("auto-installs when auto update is enabled", () => {
    expect(shouldAutoInstallOnPrompt(true, false)).toBe(true)
  })

  it("does not auto-install when disabled and not forced", () => {
    expect(shouldAutoInstallOnPrompt(false, false)).toBe(false)
  })

  it("always auto-installs forced updates", () => {
    expect(shouldAutoInstallOnPrompt(false, true)).toBe(true)
    expect(shouldAutoInstallOnPrompt(true, true)).toBe(true)
  })
})
