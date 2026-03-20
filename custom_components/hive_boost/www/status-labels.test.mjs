import test from "node:test";
import assert from "node:assert/strict";

import {
  formatBoostActionLabel,
  formatBoostStatusLabel,
  formatHeatingStatusLabel,
} from "./status-labels.mjs";

test("formatBoostStatusLabel includes target temperature when boosting", () => {
  assert.equal(
    formatBoostStatusLabel({ minutesRemaining: 30, targetTemperature: 22 }),
    "30m left · 22°",
  );
  assert.equal(
    formatBoostStatusLabel({ minutesRemaining: 0, targetTemperature: 21.5 }),
    "Boosting to 21.5°",
  );
});

test("formatBoostStatusLabel falls back when target temperature is missing", () => {
  assert.equal(
    formatBoostStatusLabel({ minutesRemaining: 30, targetTemperature: null }),
    "30m left",
  );
  assert.equal(
    formatBoostStatusLabel({ minutesRemaining: null, targetTemperature: null }),
    "Boosting",
  );
});

test("formatHeatingStatusLabel includes target temperature", () => {
  assert.equal(formatHeatingStatusLabel(20), "Heating to 20°");
  assert.equal(formatHeatingStatusLabel(undefined), "Heating");
});

test("formatBoostActionLabel includes target temperature", () => {
  assert.equal(formatBoostActionLabel(23), "Boosting to 23°");
  assert.equal(formatBoostActionLabel(undefined), "Boosting");
});
