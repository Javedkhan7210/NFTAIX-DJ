/**
 * Unit tests for sequential bot purchase selection (FIFO → cheapest → mint path helpers).
 */
import assert from "node:assert/strict";
import {
  affordableListingsCheapestFirst,
  isGlobalBuyerBlocker,
  isListingOnlyResaleDiag,
  isRetryablePurchaseFailure,
  pickFirstFifoAffordableListing,
  type QueueListing
} from "./resale-bot-keeper.service.js";

const buyer = "0xBuyer0000000000000000000000000000000001" as `0x${string}`;
const own = buyer;
const other = "0xSeller0000000000000000000000000000000002" as `0x${string}`;

function row(tokenId: number, pay: number, owner: `0x${string}`): QueueListing {
  const wei = BigInt(pay);
  return { tokenId: BigInt(tokenId), saleNftPrice: wei, effectivePay: wei, owner };
}

function run() {
  const queue = [
    row(1, 100, own),
    row(2, 500, other),
    row(3, 50, other),
    row(4, 200, other)
  ];

  const fifo = pickFirstFifoAffordableListing(queue, buyer, 300n);
  assert.equal(fifo?.tokenId, 3n, "FIFO skips own listing and expensive head; picks first affordable (50)");

  const cheapest = affordableListingsCheapestFirst(queue, buyer, 300n);
  assert.deepEqual(
    cheapest.map((r) => r.tokenId),
    [3n, 4n],
    "cheapest path sorted by effective pay"
  );

  assert.equal(pickFirstFifoAffordableListing(queue, buyer, 40n), null, "no affordable listing");
  assert.equal(affordableListingsCheapestFirst(queue, buyer, 40n).length, 0);

  assert.ok(isListingOnlyResaleDiag("USDT balance 10 < required 50"));
  assert.ok(isListingOnlyResaleDiag("plan/daily purchase cap: 1 + 2 > limit 3"));
  assert.ok(!isListingOnlyResaleDiag("marketplace paused"));

  assert.ok(isGlobalBuyerBlocker("marketplace paused"));
  assert.ok(isGlobalBuyerBlocker("Auto trade not enabled (enableAutoTrade + USDT approve to marketplace)"));
  assert.ok(!isGlobalBuyerBlocker("USDT balance 1 < required 2"));

  assert.equal(isRetryablePurchaseFailure("USDT balance 1 < required 2"), true);
  assert.equal(isRetryablePurchaseFailure("marketplace paused"), false);
  assert.equal(
    isRetryablePurchaseFailure("Primary mint: Auto trade not enabled on marketplace"),
    false
  );

  console.log("resale-bot-keeper.purchase-logic: all assertions passed");
}

run();
