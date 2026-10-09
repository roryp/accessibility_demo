// Lab 1: see what models cost and confirm HydraFusion is enabled for your account. Free: no prompts are sent.
import { CopilotClient } from "@github/copilot-sdk";
import { HYDRAFUSION_SESSION, listPersonalMcpServers } from "./lib/hydrafusion.mjs";
import { USD_PER_CREDIT } from "./lib/cost-tracker.mjs";

const client = new CopilotClient({ logLevel: "error" });
await client.start();

try {
  const auth = await client.getAuthStatus();
  const status = await client.getStatus();
  console.log(`Signed in as ${auth.login ?? "(unknown)"} via ${auth.authType} · Copilot runtime ${status.version}\n`);

  // Prices come back in AI credits per batch of tokens; 1 AI credit = $0.01.
  const perMillionUsd = (price, batch) => (!price ? "-" : `$${((price * USD_PER_CREDIT * 1_000_000) / batch).toFixed(2)}`);
  const models = (await client.listModels()).filter((m) => m.billing?.tokenPrices);
  console.log("Model prices per 1M tokens (default context tier):");
  console.log(` ${"Model".padEnd(22)}${"Input".padStart(9)}${"Cached".padStart(9)}${"Cache write".padStart(13)}${"Output".padStart(9)}`);
  for (const m of models.sort((a, b) => (a.billing.tokenPrices.outputPrice ?? 0) - (b.billing.tokenPrices.outputPrice ?? 0))) {
    const p = m.billing.tokenPrices;
    const b = p.batchSize ?? 1_000_000;
    console.log(
      ` ${m.id.padEnd(22)}${perMillionUsd(p.inputPrice, b).padStart(9)}${perMillionUsd(p.cacheReadPrice ?? p.cachePrice, b).padStart(9)}` +
        `${perMillionUsd(p.cacheWritePrice, b).padStart(13)}${perMillionUsd(p.outputPrice, b).padStart(9)}`,
    );
  }

  console.log("\nHydraFusion has no price of its own: each model it orchestrates is billed at the rates above.");
  console.log("Checking that HydraFusion is available to this account (creates a session, sends nothing)…");
  try {
    const session = await client.createSession({
      ...HYDRAFUSION_SESSION,
      disabledMcpServers: await listPersonalMcpServers(client),
      enableSkills: false,
      onPermissionRequest: () => ({ kind: "reject" }),
    });
    const current = await session.rpc.model.getCurrent();
    console.log(`✅ HydraFusion is ready: session model = ${current.modelId}, context tier = ${current.contextTier}`);
    await session.disconnect();
  } catch (err) {
    console.log(`❌ HydraFusion is not available: ${err.message}`);
    console.log("   Check that your plan includes HydraFusion and that preview features are enabled for your organization.");
    process.exitCode = 1;
  }
} finally {
  await client.stop();
}
