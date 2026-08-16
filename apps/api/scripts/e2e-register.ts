/**
 * End-to-end: mint MockUSDT → register → activate → API wallet register.
 * Usage: cd apps/api && npx tsx scripts/e2e-register.ts
 */
import { createWalletClient, http, parseAbi, parseUnits, publicActions } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { defineChain } from "viem";
import { env } from "../src/shared/config/env.js";

const opbnbTestnet = defineChain({
  id: 5611,
  name: "opBNB Testnet",
  nativeCurrency: { name: "tBNB", symbol: "tBNB", decimals: 18 },
  rpcUrls: { default: { http: [env.CHAIN_RPC_URL] } }
});

const registrationAbi = parseAbi([
  "function register(address sponsor)",
  "function activate(uint8 packageId)",
  "function rootSponsor() view returns (address)",
  "function users(address) view returns (bool,bool,bool,address,uint8,uint256,uint256,uint256,uint256)"
]);
const erc20Abi = parseAbi([
  "function mint(address to, uint256 amount)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)"
]);

async function main() {
  const funderPk = (env.CHAIN_PRIVATE_KEY.startsWith("0x")
    ? env.CHAIN_PRIVATE_KEY
    : `0x${env.CHAIN_PRIVATE_KEY}`) as `0x${string}`;
  const funder = privateKeyToAccount(funderPk);
  const userPk = generatePrivateKey();
  const user = privateKeyToAccount(userPk);

  const reg = env.REGISTRATION_CONTRACT_ADDRESS as `0x${string}`;
  const usdt = env.USDT_CONTRACT_ADDRESS as `0x${string}`;
  if (!reg || !usdt) throw new Error("Missing REGISTRATION/USDT in env");

  const funderClient = createWalletClient({
    account: funder,
    chain: opbnbTestnet,
    transport: http(env.CHAIN_RPC_URL)
  }).extend(publicActions);

  const userClient = createWalletClient({
    account: user,
    chain: opbnbTestnet,
    transport: http(env.CHAIN_RPC_URL)
  }).extend(publicActions);

  console.log("user", user.address);
  console.log("usdt", usdt, "reg", reg);

  // Fund gas
  const gasTx = await funderClient.sendTransaction({
    to: user.address,
    value: parseUnits("0.005", 18)
  });
  await funderClient.waitForTransactionReceipt({ hash: gasTx });
  console.log("gas funded", gasTx);

  // Mint USDT to user (MockUSDT)
  const mintTx = await userClient.writeContract({
    address: usdt,
    abi: erc20Abi,
    functionName: "mint",
    args: [user.address, parseUnits("100", 18)]
  });
  await userClient.waitForTransactionReceipt({ hash: mintTx });
  console.log("minted", mintTx);

  const root = await userClient.readContract({
    address: reg,
    abi: registrationAbi,
    functionName: "rootSponsor"
  });

  const regTx = await userClient.writeContract({
    address: reg,
    abi: registrationAbi,
    functionName: "register",
    args: [root]
  });
  await userClient.waitForTransactionReceipt({ hash: regTx });
  console.log("register", regTx);

  const approveTx = await userClient.writeContract({
    address: usdt,
    abi: erc20Abi,
    functionName: "approve",
    args: [reg, parseUnits("5", 18)]
  });
  await userClient.waitForTransactionReceipt({ hash: approveTx });

  const actTx = await userClient.writeContract({
    address: reg,
    abi: registrationAbi,
    functionName: "activate",
    args: [1]
  });
  await userClient.waitForTransactionReceipt({ hash: actTx });
  console.log("activate", actTx);

  const u = await userClient.readContract({
    address: reg,
    abi: registrationAbi,
    functionName: "users",
    args: [user.address]
  });
  console.log("on-chain registered/activated", u[0], u[1], "sponsor", u[3]);

  // API signup
  const nonceRes = await fetch(`http://localhost:4000/api/auth/wallet/nonce?address=${user.address}`);
  const { message } = (await nonceRes.json()) as { message: string };
  const signature = await user.signMessage({ message });
  const apiRes = await fetch("http://localhost:4000/api/auth/register/wallet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      walletAddress: user.address,
      message,
      signature,
      registrationTxHash: actTx
    })
  });
  const apiBody = await apiRes.text();
  console.log("api status", apiRes.status, apiBody.slice(0, 300));
  if (!apiRes.ok) process.exit(1);
  console.log("E2E OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
