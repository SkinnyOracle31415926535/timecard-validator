const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const vm = require("node:vm");

const source = readFileSync(new URL("../transfer-theme.js", `file://${__filename}`), "utf8");

test("Timecard Validator transfer theme replaces only the generic utility chrome", () => {
  assert.match(source, /styleMarkers/);
  assert.match(source, /style\.remove\(\)/);
  assert.doesNotMatch(source, /Tahoma/);
  assert.doesNotMatch(source, /ryan-semantic-sync/);
  assert.match(source, /titlebar/);
});

test("Timecard transfer titlebar descendants target every header after selector expansion", () => {
  let injectedStyle;
  const document = {
    readyState: "complete",
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ dataset: {}, textContent: "" }),
    head: { append: (style) => { injectedStyle = style; } },
  };

  vm.runInNewContext(source, { document });
  assert.ok(injectedStyle, "The theme should inject its generated stylesheet");

  const headerSelectors = [
    ".ryan-transfer-card > header",
    ".ryan-v3-recovery-card > header",
  ];
  const expectedRules = [
    [" small", "display:none!important"],
    [" > div", "display:block!important;min-width:0!important;overflow:hidden!important"],
    [" h2", "display:block!important;min-width:0!important;margin:0!important;padding:0!important;position:static!important;inset:auto!important;transform:none!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;font:inherit!important;font-size:14px!important;line-height:18px!important;font-weight:bold!important"],
    [" > button", "flex:0 0 auto!important;min-width:18px!important;min-height:18px!important;width:18px!important;height:18px!important;padding:0!important;line-height:14px!important"],
  ];

  expectedRules.forEach(([suffix, declarations]) => {
    const selector = headerSelectors.map((header) => `${header}${suffix}`).join(", ");
    const rule = `${selector}{${declarations}}`;
    assert.ok(injectedStyle.textContent.includes(rule), `Missing fully expanded titlebar rule: ${rule}`);
  });

  const malformedRule = ".ryan-transfer-card > header, .ryan-v3-recovery-card > header small{display:none!important}";
  assert.ok(!injectedStyle.textContent.includes(malformedRule), "A comma-list must not leave the first two titlebars unscoped");
});
