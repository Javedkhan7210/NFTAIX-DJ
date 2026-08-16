import { useEffect, useMemo, useState } from "react";
import { adminService } from "../../services/adminService";
import type { DashboardContentPayload } from "../../services/publicContentService";
import { getApiErrorMessage } from "../../lib/getApiErrorMessage";
import { resolveApiAssetUrl } from "../../lib/apiAsset";

type Banner = DashboardContentPayload["banners"][number];
type Slide = DashboardContentPayload["slides"][number];
type Promo = DashboardContentPayload["promos"][number];

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ""));
    r.onerror = () => reject(new Error("Could not read file"));
    r.readAsDataURL(file);
  });
}

const EMPTY_PAYLOAD: DashboardContentPayload = {
  banners: [],
  slides: [],
  promos: [],
  comingSoon: { enabled: false, title: "", items: [] },
  socialLinks: { telegramUrl: "", whatsAppUrl: "" },
  notifications: []
};

export function AdminContentPage() {
  const [payload, setPayload] = useState<DashboardContentPayload | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let c = false;
    void (async () => {
      setLoading(true);
      try {
        const res = await adminService.dashboardContent();
        if (!c) setPayload(res.data.payload as DashboardContentPayload);
      } catch (e) {
        if (!c) setNotice(getApiErrorMessage(e, "Load failed."));
      } finally {
        if (!c) setLoading(false);
      }
    })();
    return () => {
      c = true;
    };
  }, []);

  const data = useMemo(() => payload ?? EMPTY_PAYLOAD, [payload]);
  const update = (next: Partial<DashboardContentPayload>) => setPayload({ ...data, ...next });

  const moveItem = <T extends { id: string }>(arr: T[], id: string, dir: -1 | 1): T[] => {
    const i = arr.findIndex((x) => x.id === id);
    if (i < 0) return arr;
    const j = i + dir;
    if (j < 0 || j >= arr.length) return arr;
    const cp = [...arr];
    const [row] = cp.splice(i, 1);
    cp.splice(j, 0, row);
    return cp;
  };

  const onUpload = async (kind: "banners" | "slides" | "promos", files: FileList | null) => {
    if (!files?.length) return;
    setNotice(null);
    try {
      const urls = await Promise.all(
        Array.from(files).map(async (f) => {
          const dataUrl = await fileToDataUrl(f);
          const up = await adminService.uploadDashboardAsset(f.name, dataUrl);
          return up.data.url;
        })
      );
      if (kind === "banners") {
        const append: Banner[] = urls.map((u) => ({ id: uid("banner"), title: "Banner", imageUrl: u, body: "", linkUrl: "" }));
        update({ banners: [...data.banners, ...append] });
      } else if (kind === "slides") {
        const append: Slide[] = urls.map((u) => ({ id: uid("slide"), title: "Slide", imageUrl: u, subtitle: "", linkUrl: "" }));
        update({ slides: [...data.slides, ...append] });
      } else {
        const append: Promo[] = urls.map((u) => ({
          id: uid("promo"),
          title: "Promo",
          imageUrl: u,
          description: "",
          ctaLabel: "",
          ctaUrl: ""
        }));
        update({ promos: [...data.promos, ...append] });
      }
      setNotice(`${files.length} image(s) added. Preview and save.`);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Image upload failed.");
    }
  };

  const onSave = async () => {
    if (!payload) return;
    if (saving) return;
    setNotice(null);
    setSaving(true);
    try {
      await adminService.patchDashboardContent(payload);
      setNotice("Saved.");
    } catch (e) {
      setNotice(getApiErrorMessage(e, "Save failed."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#8b9bb4]">
        Configure CMS blocks: upload single or multiple images, preview, reorder, delete, and save.
      </p>
      {notice ? (
        <p className="rounded-xl border border-amber-400/35 bg-amber-950/40 px-3 py-2 text-sm text-amber-100">{notice}</p>
      ) : null}
      {loading ? <p className="text-sm text-[#8b9bb4]">Loading...</p> : null}

      {!loading ? (
        <>
          <div className="neon-card space-y-3 p-4">
            <p className="label-caps">Coming soon mode</p>
            <label className="flex items-center gap-2 text-sm text-[#8b9bb4]">
              <input
                type="checkbox"
                checked={Boolean(data.comingSoon?.enabled)}
                onChange={(e) => update({ comingSoon: { ...data.comingSoon, enabled: e.target.checked } })}
              />
              Enable maintenance mode (users only see Coming Soon page)
            </label>
            <input
              value={data.comingSoon?.title ?? ""}
              onChange={(e) => update({ comingSoon: { ...data.comingSoon, title: e.target.value } })}
              className="w-full rounded-lg border border-white/15 bg-black/40 px-2 py-2 text-sm text-white"
              placeholder="Coming Soon title"
            />
            <textarea
              value={(data.comingSoon?.items ?? []).join("\n")}
              onChange={(e) =>
                update({
                  comingSoon: {
                    ...data.comingSoon,
                    items: e.target.value
                      .split("\n")
                      .map((x) => x.trim())
                      .filter(Boolean)
                  }
                })
              }
              rows={3}
              className="w-full rounded-lg border border-white/15 bg-black/40 px-2 py-2 text-sm text-white"
              placeholder="One item per line"
            />
          </div>

          <div className="neon-card space-y-3 p-4">
            <p className="label-caps">Social links</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                value={data.socialLinks?.telegramUrl ?? ""}
                onChange={(e) => update({ socialLinks: { ...data.socialLinks, telegramUrl: e.target.value } })}
                className="rounded-lg border border-white/15 bg-black/40 px-2 py-2 text-sm text-white"
                placeholder="Telegram URL"
              />
              <input
                value={data.socialLinks?.whatsAppUrl ?? ""}
                onChange={(e) => update({ socialLinks: { ...data.socialLinks, whatsAppUrl: e.target.value } })}
                className="rounded-lg border border-white/15 bg-black/40 px-2 py-2 text-sm text-white"
                placeholder="WhatsApp URL"
              />
            </div>
          </div>

          <div className="neon-card space-y-3 p-4">
            <p className="label-caps">Banners</p>
            <p className="text-sm text-[#8b9bb4]">Banners are disabled in the app UI (slider-only).</p>
          </div>

          <div className="neon-card space-y-3 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="label-caps">Header slider images</p>
              <input type="file" multiple accept="image/*" onChange={(e) => void onUpload("slides", e.target.files)} />
            </div>
            {data.slides.map((s, idx) => (
              <div key={s.id} className="rounded-xl border border-white/10 bg-black/20 p-3">
                {s.imageUrl ? <img src={resolveApiAssetUrl(s.imageUrl)} alt="" className="mb-2 h-24 w-full rounded-lg object-cover" /> : null}
                <input
                  value={s.title}
                  onChange={(e) => update({ slides: data.slides.map((x) => (x.id === s.id ? { ...x, title: e.target.value } : x)) })}
                  className="w-full rounded-lg border border-white/15 bg-black/40 px-2 py-2 text-sm text-white"
                  placeholder="Slide title"
                />
                <div className="mt-2 flex gap-2 text-xs">
                  <button type="button" className="rounded border border-white/20 px-2 py-1" onClick={() => update({ slides: moveItem(data.slides, s.id, -1) })} disabled={idx === 0}>Up</button>
                  <button type="button" className="rounded border border-white/20 px-2 py-1" onClick={() => update({ slides: moveItem(data.slides, s.id, 1) })} disabled={idx === data.slides.length - 1}>Down</button>
                  <button type="button" className="rounded border border-red-400/40 px-2 py-1 text-red-200" onClick={() => update({ slides: data.slides.filter((x) => x.id !== s.id) })}>Delete</button>
                </div>
              </div>
            ))}
          </div>

          <div className="neon-card space-y-3 p-4">
            <p className="label-caps">Promo cards</p>
            <p className="text-sm text-[#8b9bb4]">Promos are disabled in the app UI (slider-only).</p>
          </div>

          <div className="neon-card space-y-3 p-4">
            <p className="label-caps">Notifications</p>
            <button
              type="button"
              className="rounded-xl border border-white/20 px-3 py-1.5 text-xs"
              onClick={() =>
                update({
                  notifications: [...data.notifications, { id: uid("notif"), title: "Notice", body: "", severity: "info" }]
                })
              }
            >
              Add notification
            </button>
            {data.notifications.map((n) => (
              <div key={n.id} className="rounded-xl border border-white/10 bg-black/20 p-3">
                <input
                  value={n.title}
                  onChange={(e) =>
                    update({
                      notifications: data.notifications.map((x) => (x.id === n.id ? { ...x, title: e.target.value } : x))
                    })
                  }
                  className="w-full rounded-lg border border-white/15 bg-black/40 px-2 py-2 text-sm text-white"
                  placeholder="Notification title"
                />
                <textarea
                  value={n.body}
                  onChange={(e) =>
                    update({
                      notifications: data.notifications.map((x) => (x.id === n.id ? { ...x, body: e.target.value } : x))
                    })
                  }
                  rows={2}
                  className="mt-2 w-full rounded-lg border border-white/15 bg-black/40 px-2 py-2 text-sm text-white"
                  placeholder="Notification body"
                />
              </div>
            ))}
          </div>
        </>
      ) : null}

      <button
        type="button"
        className="btn-neon-fill px-6 py-2 text-sm font-semibold disabled:opacity-60"
        onClick={() => void onSave()}
        disabled={!payload || saving}
      >
        {saving ? "Saving…" : "Save dashboard content"}
      </button>
      <details className="text-xs text-[#8b9bb4]">
        <summary className="cursor-pointer">Show JSON preview</summary>
        <pre className="mt-2 max-h-80 overflow-auto rounded-xl border border-white/10 bg-black/30 p-3">{JSON.stringify(data, null, 2)}</pre>
      </details>
    </div>
  );
}
