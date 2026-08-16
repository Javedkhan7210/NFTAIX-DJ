/** Send tBNB from a test wallet to admin deployer for contract redeploy. */
import { createWalletClient, formatEther, http, parseUnits, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { env } from "../src/shared/config/env.js";

const TEST_PK = "0xfb38506cbd3137ba90bcbafdd36e0e1eb05d9c729feac7438efa6f78d593e8e1";
const ADMIN = "0x1F4Ee796287bd1d6c5336F18bFaE81d02aAa252f" as const;

async function main() {
  const account = privateKeyToAccount(TEST_PK);
  const chain = {
    id: 5611,
    name: "opBNB Testnet",
    nativeCurrency: { name: "tBNB", symbol: "tBNB", decimals: 18 },
    rpcUrls: { default: { http: [env.CHAIN_RPC_URL] } }
  };
  const client = createWalletClient({
    account,
    chain,
    transport: http(env.CHAIN_RPC_URL)
  }).extend(publicActions);

  const bal = await client.getBalance({ address: account.address });
  const reserve = parseUnits("0.00003", 18);
  const send = bal > reserve ? bal - reserve : 0n;
  console.log("From", account.address, "tBNB", formatEther(bal), "→ send", formatEther(send));
  if (send <= 0n) throw new Error("Test wallet has no tBNB to forward");
  const hash = await client.sendTransaction({ to: ADMIN, value: send, chain, account });
  await client.waitForTransactionReceipt({ hash });
  const adminBal = await client.getBalance({ address: ADMIN });
  console.log("Admin tBNB now", formatEther(adminBal));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
