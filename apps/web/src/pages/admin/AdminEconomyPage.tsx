import { useEffect, useMemo, useState } from "react";
import { adminService } from "../../services/adminService";
import { getApiErrorMessage } from "../../lib/getApiErrorMessage";

type Row = { id: string; key: string; value: string };
type UnlockRule = { minDirect: number; maxLevels: number };
type Field = { label: string; key: string; description?: string };

const GROUPS: Array<{ title: string; fields: Field[] }> = [
  {
    title: "Activation Distribution Settings",
    fields: [
      { label: "Burn Percentage", key: "activation.burnPct", description: "% of amount burned" },
      { label: "Creator Reward", key: "activation.creatorPct", description: "% to creator" },
      { label: "Direct Sponsor Reward", key: "activation.directSponsorPct", description: "Referral bonus" },
      { label: "Network Distribution", key: "activation.networkPct", description: "MLM network share" },
      { label: "Global Pool Contribution", key: "activation.globalPct", description: "Goes to global pool" },
      { label: "Liquidity Allocation", key: "activation.liquidityPct", description: "Liquidity reserve" }
    ]
  }
];

export function AdminEconomyPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [unlockRules, setUnlockRules] = useState<UnlockRule[]>([
    { minDirect: 0, maxLevels: 1 },
    { minDirect: 1, maxLevels: 2 },
    { minDirect: 10, maxLevels: 20 }
  ]);

  const rowMap = useMemo(() => new Map(rows.map((r) => [r.key, r.value])), [rows]);

  const load = async () => {
    try {
      const res = await adminService.rewardSettings();
      const data = res.data as Row[];
      setRows(data);
      const m: Record<string, string> = {};
      for (const r of data) m[r.key] = r.value;
      setEdit(m);
      const unlockRaw = data.find((r) => r.key === "referral.levelUnlock")?.value;
      if (unlockRaw) {
        try {
          const parsed = JSON.parse(unlockRaw) as UnlockRule[];
          if (Array.isArray(parsed) && parsed.length) setUnlockRules(parsed);
        } catch {
          /* keep defaults */
        }
      }
    } catch (e) {
      setNotice(getApiErrorMessage(e, "Load failed."));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const saveKey = async (key: string) => {
    setNotice(null);
    try {
      await adminService.patchRewardSetting(key, edit[key] ?? "");
      setNotice(`Saved ${key}.`);
      await load();
    } catch (e) {
      setNotice(getApiErrorMessage(e, "Save failed."));
    }
  };

  const saveUnlockRules = async () => {
    setNotice(null);
    try {
      await adminService.patchRewardSetting("referral.levelUnlock", JSON.stringify(unlockRules));
      setNotice("Saved referral level rules.");
      await load();
    } catch (e) {
      setNotice(getApiErrorMessage(e, "Save failed."));
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#8b9bb4]">Business-friendly controls for reward, income, referral, NFT, and tokenomics settings.</p>
      {notice ? <p className="rounded-xl border border-amber-400/35 bg-amber-950/40 px-3 py-2 text-sm text-amber-100">{notice}</p> : null}

      {GROUPS.map((group) => (
        <div key={group.title} className="neon-card p-4">
          <p className="label-caps mb-3">{group.title}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {group.fields.map((f) => (
              <div key={f.key} className="rounded-xl border border-white/10 bg-black/20 p-3">
                <p className="text-sm font-semibold text-white" title={f.description ?? f.key}>
                  {f.label}
                </p>
                <p className="mt-0.5 text-[11px] font-mono text-[#8b9bb4]">{f.key}</p>
                <input
                  value={edit[f.key] ?? rowMap.get(f.key) ?? ""}
                  onChange={(e) => setEdit((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  className="mt-2 w-full rounded-lg border border-white/15 bg-black/40 px-2 py-2 font-mono text-xs text-white"
                />
                <button type="button" className="mt-2 rounded-lg bg-[#22E6A0]/20 px-3 py-1.5 text-xs font-semibold text-[#22E6A0]" onClick={() => void saveKey(f.key)}>
                  Save
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="neon-card p-4">
        <p className="label-caps mb-3">Referral level depth</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[360px] text-left text-xs">
            <thead>
              <tr className="text-[#8b9bb4]">
                <th className="p-2">Direct Referrals</th>
                <th className="p-2">Max depth</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {unlockRules.map((r, i) => (
                <tr key={i} className="border-t border-white/5">
                  <td className="p-2">
                    <input
                      type="number"
                      value={r.minDirect}
                      onChange={(e) =>
                        setUnlockRules((prev) => prev.map((x, idx) => (idx === i ? { ...x, minDirect: Number(e.target.value || 0) } : x)))
                      }
                      className="w-full rounded-lg border border-white/15 bg-black/40 px-2 py-1 font-mono text-xs text-white"
                    />
                  </td>
                  <td className="p-2">
                    <input
                      type="number"
                      value={r.maxLevels}
                      onChange={(e) =>
                        setUnlockRules((prev) => prev.map((x, idx) => (idx === i ? { ...x, maxLevels: Number(e.target.value || 0) } : x)))
                      }
                      className="w-full rounded-lg border border-white/15 bg-black/40 px-2 py-1 font-mono text-xs text-white"
                    />
                  </td>
                  <td className="p-2">
                    <button type="button" className="rounded border border-red-400/40 px-2 py-1 text-[11px] text-red-200" onClick={() => setUnlockRules((prev) => prev.filter((_, idx) => idx !== i))}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="rounded border border-white/20 px-3 py-1.5 text-xs" onClick={() => setUnlockRules((prev) => [...prev, { minDirect: 0, maxLevels: 1 }])}>
            Add Row
          </button>
          <button type="button" className="rounded bg-[#22E6A0]/20 px-3 py-1.5 text-xs font-semibold text-[#22E6A0]" onClick={() => void saveUnlockRules()}>
            Save level rules
          </button>
        </div>
      </div>
    </div>
  );
}
