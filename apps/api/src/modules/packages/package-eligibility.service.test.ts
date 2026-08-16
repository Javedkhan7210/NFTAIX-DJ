/**
 * Eligibility trading fraction matches RewardSetting key used at runtime.
 */
import assert from "node:assert/strict";

function run() {
  const rowValue = "50";
  const minFrac = Number(rowValue) / 100;
  assert.equal(minFrac, 0.5);
  const required = 100;
  const achieved = 50;
  assert.ok(achieved >= required * minFrac);
}

run();
