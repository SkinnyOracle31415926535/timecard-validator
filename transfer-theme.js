/* Uses the Timecard Validator's classic teal Windows chrome for migration controls. */
(() => {
  "use strict";

  const styleMarkers = [
    ".ryan-transfer-open{",
    ".ryan-semantic-sync-open{",
    ".ryan-v3-recovery-open{",
  ];
  const dialogs = ".ryan-transfer-dialog, .ryan-semantic-sync-dialog, .ryan-v3-recovery-dialog";
  const cards = ".ryan-transfer-card, .ryan-semantic-sync-card, .ryan-v3-recovery-card";
  const headerSelectors = [
    ".ryan-transfer-card > header",
    ".ryan-semantic-sync-card > header",
    ".ryan-v3-recovery-card > header",
  ];
  const headers = headerSelectors.join(", ");
  const headerDescendants = (suffix) => headerSelectors.map((header) => `${header}${suffix}`).join(", ");
  const headerSmall = headerDescendants(" small");
  const headerContent = headerDescendants(" > div");
  const headerTitles = headerDescendants(" h2");
  const headerButtons = headerDescendants(" > button");
  const statusPanels = [
    ".ryan-transfer-status", ".ryan-transfer-preview", ".ryan-transfer-sync",
    ".ryan-semantic-sync-status", ".ryan-semantic-sync-card section",
    ".ryan-v3-recovery-card [data-status]",
  ].join(", ");

  function addClass(selector, className) {
    document.querySelectorAll(selector).forEach((element) => element.classList.add(className));
  }

  function applyTheme() {
    if (document.querySelector('style[data-ryan-transfer-theme="timecard-validator"]')) return;
    document.querySelectorAll("style").forEach((style) => {
      if (styleMarkers.some((marker) => style.textContent.includes(marker))) style.remove();
    });
    addClass(dialogs, "window");
    addClass(headers, "titlebar");

    const style = document.createElement("style");
    style.dataset.ryanTransferTheme = "timecard-validator";
    style.textContent = `
      .ryan-transfer-open{position:fixed!important;right:16px!important;bottom:16px!important;z-index:2147483000!important}
      .ryan-semantic-sync-open{position:fixed!important;left:16px!important;bottom:16px!important;z-index:2147482998!important}
      .ryan-v3-recovery-open{position:fixed!important;left:16px!important;bottom:60px!important;z-index:2147482996!important}
      ${dialogs}{width:min(760px,calc(100vw - 24px))!important;max-width:calc(100vw - 24px)!important;max-height:calc(100vh - 24px)!important;margin:auto!important;overflow:auto!important}
      .ryan-transfer-dialog{z-index:2147483001!important}
      .ryan-semantic-sync-dialog{z-index:2147482999!important}
      .ryan-v3-recovery-dialog{z-index:2147482997!important}
      ${cards}{padding:14px!important}
      ${headers}{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:8px!important}
      ${headerSmall}{display:none!important}
      ${headerContent}{display:block!important;min-width:0!important;overflow:hidden!important}
      ${headerTitles}{display:block!important;min-width:0!important;margin:0!important;padding:0!important;position:static!important;inset:auto!important;transform:none!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;font:inherit!important;font-size:14px!important;line-height:18px!important;font-weight:bold!important}
      ${headerButtons}{flex:0 0 auto!important;min-width:18px!important;min-height:18px!important;width:18px!important;height:18px!important;padding:0!important;line-height:14px!important}
      .ryan-transfer-actions,.ryan-semantic-sync-actions,.ryan-v3-recovery-actions,.ryan-semantic-conflict-actions,.ryan-transfer-conflict-actions{display:flex!important;flex-wrap:wrap!important;gap:10px!important;margin-top:12px!important}
      ${statusPanels}{margin-top:14px!important;padding:12px!important;border:2px groove var(--light)!important;background:var(--face)!important}
      .ryan-transfer-preview h3,.ryan-transfer-sync h3,.ryan-semantic-sync-card h3{margin-top:0!important}
      .ryan-transfer-conflict,.ryan-semantic-conflict{display:grid!important;gap:8px!important;margin-top:10px!important}
      @media(max-width:520px){.ryan-transfer-open{right:8px!important;bottom:8px!important}.ryan-semantic-sync-open{left:8px!important;bottom:8px!important}.ryan-v3-recovery-open{left:8px!important;bottom:54px!important}}
    `;
    document.head.append(style);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", applyTheme, { once: true });
  else applyTheme();
})();
