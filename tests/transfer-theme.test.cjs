const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");

const source = readFileSync(new URL("../transfer-theme.js", `file://${__filename}`), "utf8");

test("Timecard Validator transfer theme replaces only the generic utility chrome", () => {
  assert.match(source, /styleMarkers/);
  assert.match(source, /style\.remove\(\)/);
  assert.doesNotMatch(source, /Tahoma/);
  assert.match(source, /titlebar/);
});

test("Timecard transfer titlebars hide their kicker and constrain titles to one line", () => {
  const expectedRules = [
    "${headers} small{display:none!important}",
    "${headers} > div{display:block!important;min-width:0!important;overflow:hidden!important}",
    "${headers} h2{display:block!important;min-width:0!important;margin:0!important;padding:0!important;position:static!important;inset:auto!important;transform:none!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;font:inherit!important;font-size:14px!important;line-height:18px!important;font-weight:bold!important}",
  ];

  expectedRules.forEach((rule) => {
    assert.ok(source.includes(rule), `Missing titlebar rule: ${rule}`);
  });
});
