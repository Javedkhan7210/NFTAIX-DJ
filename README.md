# NFTAIX — Smart Contracts (6 modules)

opBNB + USDT. Users pay via **USDT approve** (no deposit vault).

## Contracts

| # | Contract | Role |
|---|----------|------|
| 1 | `Registration` | Register, packages, activation, volume/compliance |
| 2 | `NFTMarketplace` | FIFO NFT + bot buy (allowance) |
| 3 | `Rewards` | Daily MLM income claim / burn |
| 4 | `GlobalPool` | Global % collect + next-day rank distribute |
| 5 | `Treasury` | Burn wallet + NFT burn accounting |
| 6 | `LiquidityManager` | LP funds receive / forward to LP wallet |

## Commands

```bash
npm run compile
npm test
npm run manual-test
npx hardhat run scripts/deploy.js
```

## Apps ↔ contracts (new stack only)

**Do not use** legacy matrix / `buyNft` / `placeOrder` / AutoTradeModule.

| App flow | Contract call |
|----------|----------------|
| Register | `register` → approve → `activate(1)` |
| Upgrade | `upgrade(packageId)` |
| Market buy | `NFTMarketplace.buy()` (auto-enqueues into FIFO at +10%) |
| Manual list (rare holds) | `listHeld()` |
| Bot | `setUserBot` + keeper `runBot` / `botBuy` |

```env
REGISTRATION_CONTRACT_ADDRESS=0x...
MARKETPLACE_CONTRACT_ADDRESS=0x...
USDT_CONTRACT_ADDRESS=0x...
REWARDS_CONTRACT_ADDRESS=0x...
GLOBAL_POOL_CONTRACT_ADDRESS=0x...
TREASURY_CONTRACT_ADDRESS=0x...
LIQUIDITY_MANAGER_CONTRACT_ADDRESS=0x...
```

Deploy: `npx hardhat run scripts/deploy.js --network <network>`
