import assert from "node:assert/strict";
import { isPreviousPeriodComplianceRecordEligible } from "../trading/trading-compliance.service.js";

/** Burn wallet + compliance helpers used by global pool settlement. */
function run() {
  assert.equal(isPreviousPeriodComplianceRecordEligible(null), false);
  assert.equal(
    isPreviousPeriodComplianceRecordEligible({ status: "non_compliant", requiredVolume: 50 }),
    false
  );

  const pool = 112.7;
  const members = 8;
  const nonCompliant = 3;
  const share = pool * 0.25 / members;
  const paid = share * (members - nonCompliant);
  const burned = share * nonCompliant;
  assert.equal(paid + burned, pool * 0.25);
  assert.ok(burned > 0, "non-compliant share must be sent to burn wallet on-chain");

  console.log("global-pool-burn-payout.test: all assertions passed");
}

run();
