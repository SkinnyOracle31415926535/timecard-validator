/* Uses the Timecard Validator's classic teal Windows chrome for private sync. */
(() => {
  "use strict";

  const styleMarkers = [".ryan-semantic-sync-open{"];
  const dialogs = ".ryan-semantic-sync-dialog";
  const cards = ".ryan-semantic-sync-card";
  const headerSelectors = [
    ".ryan-semantic-sync-card > header",
  ];
  const headers = headerSelectors.join(", ");
  const headerDescendants = (suffix) => headerSelectors.map((header) => `${header}${suffix}`).join(", ");
  const headerSmall = headerDescendants(" small");
  const headerContent = headerDescendants(" > div");
  const headerTitles = headerDescendants(" h2");
  const headerButtons = headerDescendants(" > button");
  const statusPanels = [
    ".ryan-semantic-sync-status", ".ryan-semantic-sync-card section",
  ].join(", ");

  function addClass(selector, className) {
    document.querySelectorAll(selector).forEach((element) => element.classList.add(className));
  }

  function applyTheme() {
    if (document.querySelector('style[data-ryan-semantic-sync-theme="timecard-validator"]')) return;
    document.querySelectorAll("style").forEach((style) => {
      if (styleMarkers.some((marker) => style.textContent.includes(marker))) style.remove();
    });
    addClass(dialogs, "window");
    addClass(headers, "titlebar");

    const style = document.createElement("style");
    style.dataset.ryanSemanticSyncTheme = "timecard-validator";
    style.textContent = `
      .ryan-semantic-sync-open{position:fixed!important;left:16px!important;bottom:16px!important;z-index:2147482998!important}
      ${dialogs}{width:min(760px,calc(100vw - 24px))!important;max-width:calc(100vw - 24px)!important;max-height:calc(100vh - 24px)!important;margin:auto!important;overflow:auto!important}
      .ryan-semantic-sync-dialog{z-index:2147482999!important}
      ${cards}{padding:14px!important}
      ${headers}{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:8px!important}
      ${headerSmall}{display:none!important}
      ${headerContent}{display:block!important;min-width:0!important;overflow:hidden!important}
      ${headerTitles}{display:block!important;min-width:0!important;margin:0!important;padding:0!important;position:static!important;inset:auto!important;transform:none!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;font:inherit!important;font-size:14px!important;line-height:18px!important;font-weight:bold!important}
      ${headerButtons}{flex:0 0 auto!important;min-width:18px!important;min-height:18px!important;width:18px!important;height:18px!important;padding:0!important;line-height:14px!important}
      .ryan-semantic-sync-actions,.ryan-semantic-conflict-actions{display:flex!important;flex-wrap:wrap!important;gap:10px!important;margin-top:12px!important}
      ${statusPanels}{margin-top:14px!important;padding:12px!important;border:2px groove var(--light)!important;background:var(--face)!important}
      .ryan-semantic-sync-card h3{margin-top:0!important}
      .ryan-semantic-conflict{display:grid!important;gap:8px!important;margin-top:10px!important}
      @media(max-width:520px){.ryan-semantic-sync-open{left:8px!important;bottom:8px!important}}
    `;
    document.head.append(style);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", applyTheme, { once: true });
  else applyTheme();
})();
