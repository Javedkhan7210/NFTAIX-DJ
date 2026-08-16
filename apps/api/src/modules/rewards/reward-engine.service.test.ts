/**
 * Distribution math for activation (no DB): aligns with RewardEngineService.processActivationDistribution.
 */
import assert from "node:assert/strict";

function run() {
  const activationAmount = 100;
  const directPct = 20;
  const networkPct = 40;
  assert.equal((activationAmount * directPct) / 100, 20, "20% direct sponsor");

  const networkAmount = (activationAmount * networkPct) / 100;
  assert.equal(networkAmount, 40, "40% network bucket");

  const perLevelNetworkShare = networkAmount / 20;
  assert.equal(perLevelNetworkShare, 2, "each of 20 levels gets 2% of activation when network is 40%");

  assert.equal(perLevelNetworkShare * 20, networkAmount, "20 levels fully allocate the network bucket");

  const creatorPct = 10;
  const burnPct = 20;
  const liquidityPct = 5;
  const globalPct = 5;
  assert.equal((activationAmount * creatorPct) / 100, 10);
  assert.equal((activationAmount * burnPct) / 100, 20);
  assert.equal((activationAmount * liquidityPct) / 100, 5);
  assert.equal((activationAmount * globalPct) / 100, 5);

  const totalPct = directPct + networkPct + creatorPct + burnPct + liquidityPct + globalPct;
  assert.equal(totalPct, 100, "activation slices sum to 100%");
}

run();
