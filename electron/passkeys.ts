import {
  app,
  dialog,
  session as electronSession,
  systemPreferences,
  webContents,
  type BrowserWindow,
  type MessageBoxOptions,
  type WebContents,
} from "electron"
import { existsSync } from "node:fs"
import { join } from "node:path"

// Passkeys with Touch ID. Electron keeps the credentials in the Secure
// Enclave under this keychain access group, which the signed app's
// keychain-access-groups entitlement lists (scripts/entitlements.app.mac.plist).
// They stay in Peck on this Mac: iCloud Keychain and phone passkeys are out
// of reach, so each site needs a passkey created in Peck.
export const WEBAUTHN_GROUP = "68PK3GTMDD.tw.zyx.peck.webauthn"

// Only the signed release embeds the provisioning profile that allows that
// entitlement. Other builds keep passkeys off. Without Touch ID (none
// enrolled, or the lid closed at launch) Chromium would sign without a
// prompt, so passkeys stay off then too.
export function passkeysAvailable() {
  return (
    process.platform === "darwin" &&
    app.isPackaged &&
    existsSync(
      join(process.resourcesPath, "..", "embedded.provisionprofile")
    ) &&
    systemPreferences.canPromptTouchID()
  )
}

export function setupPasskeys(
  windowOf: (contents: WebContents) => BrowserWindow | undefined
) {
  if (!passkeysAvailable()) return false
  app.configureWebAuthn({
    touchID: {
      keychainAccessGroup: WEBAUTHN_GROUP,
      promptReason: "use a passkey for $1",
    },
  })
  // Several passkeys for one site: the user picks one. The request waits
  // until the callback runs, so it runs exactly once.
  electronSession
    .fromPartition("persist:peck")
    .on("select-webauthn-account", (_event, details, callback) => {
      let answered = false
      const answer = (credentialId?: string) => {
        if (answered) return
        answered = true
        callback(credentialId)
      }
      try {
        const contents =
          (details.frame && webContents.fromFrame(details.frame)) || undefined
        // A sheet on a hidden window would stay out of sight.
        const window = contents && windowOf(contents)
        const shown = window && window.isVisible() ? window : undefined
        const { accounts } = details
        // The page leaving or closing closes the chooser.
        const leave = new AbortController()
        const close = () => leave.abort()
        contents?.once("did-navigate", close)
        contents?.once("destroyed", close)
        const options: MessageBoxOptions = {
          type: "question",
          message: `Choose a passkey for ${details.relyingPartyId}`,
          buttons: [
            ...accounts.map((a) => a.name || a.displayName || "Passkey"),
            "Cancel",
          ],
          defaultId: 0,
          cancelId: accounts.length,
          signal: leave.signal,
        }
        ;(shown
          ? dialog.showMessageBox(shown, options)
          : dialog.showMessageBox(options)
        )
          .then(
            ({ response }) => answer(accounts[response]?.credentialId),
            () => answer()
          )
          .finally(() => {
            if (contents && !contents.isDestroyed()) {
              contents.off("did-navigate", close)
              contents.off("destroyed", close)
            }
          })
      } catch {
        answer()
      }
    })
  return true
}
