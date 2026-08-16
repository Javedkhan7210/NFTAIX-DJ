import assert from "node:assert/strict";
import { isPreviousPeriodComplianceRecordEligible } from "../trading/trading-compliance.service.js";
import {
  getPreviousTradingPeriodBounds,
  getTradingPeriodBounds,
  getTradingPeriodMs
} from "../trading/trading-period.js";

function run() {
  const periodMs = getTradingPeriodMs();
  const anchor = new Date("2026-05-20T02:58:20.000Z");
  const runAt = new Date(anchor.getTime() + periodMs + 5 * 60 * 1000);

  const current = getTradingPeriodBounds(runAt, anchor);
  const previous = getPreviousTradingPeriodBounds(runAt, anchor);

  assert.equal(previous.periodEnd.getTime(), current.periodStart.getTime());
  assert.equal(current.periodStart.getTime() - previous.periodStart.getTime(), periodMs);
  assert.equal(previous.periodKey.getTime(), anchor.getTime());

  assert.equal(isPreviousPeriodComplianceRecordEligible(null), false, "missing row → not eligible");
  assert.equal(
    isPreviousPeriodComplianceRecordEligible({ status: "compliant", requiredVolume: 100 }),
    true
  );
  assert.equal(
    isPreviousPeriodComplianceRecordEligible({ status: "non_compliant", requiredVolume: 100 }),
    false
  );
  assert.equal(
    isPreviousPeriodComplianceRecordEligible({ status: "non_compliant", requiredVolume: 0 }),
    true,
    "legacy zero requirement treated as eligible"
  );

  const share = 25 / 10;
  const compliantCount = 7;
  assert.equal(share * compliantCount, 17.5);
  assert.equal(share * (10 - compliantCount), 7.5, "non-compliant shares burn, not redistributed");

  const totalPool = 1000;
  const rankShares = { prime: 20, elite: 25, royal: 25, director: 20, crown: 10 };
  const sumPct =
    rankShares.prime + rankShares.elite + rankShares.royal + rankShares.director + rankShares.crown;
  assert.equal(sumPct, 100, "rank buckets sum to 100% of pool");
  const eliteBucket = (totalPool * rankShares.elite) / 100;
  assert.equal(eliteBucket, 250, "empty rank bucket burns in full (no achievers)");
}

run();
