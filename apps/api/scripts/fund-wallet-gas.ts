/** Send remaining admin tBNB to a test wallet for registration gas. */
import { createWalletClient, formatEther, http, parseUnits, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { env } from "../src/shared/config/env.js";

const target = (process.argv[2] ?? "0x0623FeD6F6da9FCB04F9794d944c850c8fAB7Ba3") as `0x${string}`;

async function main() {
  const pk = (env.CHAIN_PRIVATE_KEY.startsWith("0x") ? env.CHAIN_PRIVATE_KEY : `0x${env.CHAIN_PRIVATE_KEY}`) as `0x${string}`;
  const funder = privateKeyToAccount(pk);
  const chain = {
    id: 5611,
    name: "opBNB Testnet",
    nativeCurrency: { name: "tBNB", symbol: "tBNB", decimals: 18 },
    rpcUrls: { default: { http: [env.CHAIN_RPC_URL] } }
  };
  const client = createWalletClient({
    account: funder,
    chain,
    transport: http(env.CHAIN_RPC_URL)
  }).extend(publicActions);

  const funderBal = await client.getBalance({ address: funder.address });
  const reserve = parseUnits("0.00003", 18);
  const send = funderBal > reserve ? funderBal - reserve : 0n;

  console.log("Admin", funder.address, "tBNB", formatEther(funderBal));
  if (send <= 0n) {
    console.log("Admin wallet empty. Top up at https://opbnb-testnet-faucet.bnbchain.org/");
    process.exit(1);
  }

  console.log("Sending", formatEther(send), "tBNB to", target);
  const hash = await client.sendTransaction({ to: target, value: send, chain, account: funder });
  await client.waitForTransactionReceipt({ hash });
  const after = await client.getBalance({ address: target });
  console.log("Done. User tBNB now", formatEther(after));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
