"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  FileSpreadsheet,
  ImagePlus,
  Loader2,
  PauseCircle,
  Rocket,
  XCircle,
  Copy,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { parseAdSheet, adSheetTemplate, SHEET_COLUMNS, type SheetAd } from "@/lib/adBulkSheet";
import { formatCurrency, cn } from "@/lib/utils";

interface Option { id: string; name: string }
interface Account extends Option { currency: string; active: boolean; business: string | null }
interface Form extends Option { status: string }

type Status = "pending" | "running" | "done" | "error" | "skipped";
interface Step {
  key: string;
  level: 0 | 1 | 2; // campaign / ad set / ad
  label: string;
  status: Status;
  detail?: string;
  url?: string;
  id?: string;
}
interface MediaResult { imageHash?: string; videoId?: string; thumbnailUrl?: string; error?: string }

// Serverless requests cap out around 4.5 MB, and base64 adds a third, so keep
// each image under ~3 MB on the wire. Bigger images are re-encoded in the browser.
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const VIDEO_POLL_MS = 5000;
const VIDEO_TIMEOUT_MS = 10 * 60 * 1000;

async function api<T = any>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

function post<T = any>(url: string, body: unknown): Promise<T> {
  return api<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** Base64 of the image, shrunk to a JPEG if it's over the request-size budget. */
async function imageBase64(file: File): Promise<string> {
  if (file.size <= MAX_IMAGE_BYTES) return (await readAsDataUrl(file)).split(",")[1];
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  for (const q of [0.9, 0.8, 0.7, 0.6]) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", q));
    if (blob && blob.size <= MAX_IMAGE_BYTES) return (await readAsDataUrl(blob)).split(",")[1];
  }
  throw new Error(`${file.name} is too large even after compressing. Use an image under 3 MB.`);
}

function mediaKey(ad: SheetAd) {
  return ad.mediaIsUrl ? ad.media : ad.media.toLowerCase();
}

function downloadText(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function AdBulkUploader() {
  // ── Client account ──
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [pages, setPages] = useState<Option[]>([]);
  const [pixels, setPixels] = useState<Option[]>([]);
  const [forms, setForms] = useState<Form[] | null>(null);
  const [formsError, setFormsError] = useState<string | null>(null);
  const [accountId, setAccountId] = useState("");
  const [pageId, setPageId] = useState("");
  const [pixelId, setPixelId] = useState("none");
  const [financial, setFinancial] = useState(true);

  // ── Sheet & creatives ──
  const [csv, setCsv] = useState("");
  const [csvName, setCsvName] = useState("");
  const [files, setFiles] = useState<Map<string, File>>(new Map());

  // ── Launch ──
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [mediaLog, setMediaLog] = useState<{ name: string; status: Status; detail?: string }[]>([]);

  useEffect(() => {
    api<{ configured: boolean; accounts?: Account[]; pages?: Option[] }>("/api/admin/ad-uploader/options")
      .then((d) => {
        setConfigured(d.configured);
        setAccounts(d.accounts ?? []);
        setPages(d.pages ?? []);
      })
      .catch((e) => {
        setConfigured(true);
        setLoadError(e.message);
      });
  }, []);

  useEffect(() => {
    setPixels([]);
    setPixelId("none");
    if (!accountId) return;
    api<{ pixels: Option[] }>(`/api/admin/ad-uploader/options?accountId=${encodeURIComponent(accountId)}`)
      .then((d) => setPixels(d.pixels))
      .catch(() => setPixels([]));
  }, [accountId]);

  useEffect(() => {
    setForms(null);
    setFormsError(null);
    if (!pageId) return;
    api<{ forms: Form[] }>(`/api/admin/ad-uploader/options?pageId=${encodeURIComponent(pageId)}`)
      .then((d) => setForms(d.forms))
      .catch((e) => setFormsError(e.message));
  }, [pageId]);

  const parsed = useMemo(
    () => (csv ? parseAdSheet(csv, { financialCategory: financial, uploadedFiles: new Set(files.keys()) }) : null),
    [csv, files, financial],
  );
  const errors = parsed?.issues.filter((i) => i.level === "error") ?? [];
  const warnings = parsed?.issues.filter((i) => i.level === "warning") ?? [];
  const needsPixel = parsed?.campaigns.some((c) => c.objective === "LEADS" && c.adsets.some((s) => s.destination === "WEBSITE"));
  const account = accounts.find((a) => a.id === accountId);
  const canLaunch =
    !!parsed && parsed.adCount > 0 && errors.length === 0 && !!accountId && !!pageId && (!needsPixel || pixelId !== "none") && !running;

  async function onCsv(file: File | undefined) {
    if (!file) return;
    setCsvName(file.name);
    setCsv(await file.text());
    setSteps([]);
    setMediaLog([]);
  }

  function onImages(list: FileList | null) {
    if (!list) return;
    setFiles((prev) => {
      const next = new Map(prev);
      for (const f of Array.from(list)) next.set(f.name.toLowerCase(), f);
      return next;
    });
  }

  async function launch() {
    if (!parsed || !canLaunch) return;
    setConfirming(false);
    setRunning(true);
    const base = { csv, accountId, pageId, pixelId: pixelId === "none" ? undefined : pixelId, financialCategory: financial };

    // 1. Media — each distinct file or link once.
    const allAds = parsed.campaigns.flatMap((c) => c.adsets.flatMap((s) => s.ads));
    const distinct = new Map<string, SheetAd>();
    for (const ad of allAds) if (!distinct.has(mediaKey(ad))) distinct.set(mediaKey(ad), ad);
    const media = new Map<string, MediaResult>();
    const log = [...distinct.values()].map((ad) => ({ name: ad.media, status: "pending" as Status, detail: undefined as string | undefined }));
    setMediaLog([...log]);
    const setLog = (i: number, status: Status, detail?: string) => {
      log[i] = { ...log[i], status, detail };
      setMediaLog([...log]);
    };

    const videos: { key: string; i: number }[] = [];
    let i = 0;
    for (const [key, ad] of distinct) {
      setLog(i, "running", ad.mediaType === "video" ? "Sending link to Meta…" : "Uploading…");
      try {
        if (ad.mediaType === "video") {
          const r = await post<{ videoId: string }>("/api/admin/ad-uploader/media", { accountId, kind: "video-url", url: ad.media, name: ad.name });
          media.set(key, { videoId: r.videoId });
          videos.push({ key, i });
          setLog(i, "running", "Meta is processing the video…");
        } else if (ad.mediaIsUrl) {
          const r = await post<{ imageHash: string }>("/api/admin/ad-uploader/media", { accountId, kind: "image-url", url: ad.media });
          media.set(key, { imageHash: r.imageHash });
          setLog(i, "done");
        } else {
          const file = files.get(key)!;
          const base64 = await imageBase64(file);
          const r = await post<{ imageHash: string }>("/api/admin/ad-uploader/media", { accountId, kind: "image-file", name: file.name, base64 });
          media.set(key, { imageHash: r.imageHash });
          setLog(i, "done");
        }
      } catch (e) {
        media.set(key, { error: (e as Error).message });
        setLog(i, "error", (e as Error).message);
      }
      i++;
    }

    // Videos need processing (and a thumbnail) before an ad can use them.
    const started = Date.now();
    let waiting = videos.slice();
    while (waiting.length && Date.now() - started < VIDEO_TIMEOUT_MS) {
      await sleep(VIDEO_POLL_MS);
      const still: typeof waiting = [];
      for (const v of waiting) {
        const m = media.get(v.key)!;
        try {
          const s = await api<{ state: string; thumbnailUrl: string | null; error?: string }>(
            `/api/admin/ad-uploader/media?videoId=${encodeURIComponent(m.videoId!)}`,
          );
          if (s.state === "ready") {
            media.set(v.key, { ...m, thumbnailUrl: s.thumbnailUrl ?? undefined });
            setLog(v.i, "done");
          } else if (s.state === "error") {
            media.set(v.key, { error: s.error ?? "Meta couldn't process this video." });
            setLog(v.i, "error", s.error);
          } else still.push(v);
        } catch {
          still.push(v); // transient — try again next round
        }
      }
      waiting = still;
    }
    for (const v of waiting) {
      media.set(v.key, { error: "Timed out waiting for Meta to process the video." });
      setLog(v.i, "error", "Timed out after 10 minutes. Re-run once it finishes processing.");
    }

    // 2. Campaign → ad sets → ads, in sheet order.
    const plan: Step[] = [];
    parsed.campaigns.forEach((c, ci) => {
      plan.push({ key: `c${ci}`, level: 0, label: c.name, status: "pending" });
      c.adsets.forEach((s, si) => {
        plan.push({ key: `c${ci}s${si}`, level: 1, label: s.name, status: "pending" });
        s.ads.forEach((a, ai) => plan.push({ key: `c${ci}s${si}a${ai}`, level: 2, label: a.name, status: "pending" }));
      });
    });
    setSteps([...plan]);
    const update = (key: string, patch: Partial<Step>) => {
      const idx = plan.findIndex((p) => p.key === key);
      plan[idx] = { ...plan[idx], ...patch };
      setSteps([...plan]);
    };
    const skipUnder = (prefix: string, why: string) =>
      plan.forEach((p) => p.key.startsWith(prefix) && p.key !== prefix && update(p.key, { status: "skipped", detail: why }));

    for (const [ci, c] of parsed.campaigns.entries()) {
      update(`c${ci}`, { status: "running" });
      let campaignId: string;
      try {
        const r = await post<{ id: string; url: string }>("/api/admin/ad-uploader/launch", { ...base, step: "campaign", c: ci });
        campaignId = r.id;
        update(`c${ci}`, { status: "done", id: r.id, url: r.url });
      } catch (e) {
        update(`c${ci}`, { status: "error", detail: (e as Error).message });
        skipUnder(`c${ci}s`, "Campaign wasn't created");
        continue;
      }

      for (const [si, s] of c.adsets.entries()) {
        const sk = `c${ci}s${si}`;
        update(sk, { status: "running" });
        let adsetId: string;
        try {
          adsetId = (await post<{ id: string }>("/api/admin/ad-uploader/launch", { ...base, step: "adset", c: ci, s: si, campaignId })).id;
          update(sk, { status: "done", id: adsetId });
        } catch (e) {
          update(sk, { status: "error", detail: (e as Error).message });
          skipUnder(`${sk}a`, "Ad set wasn't created");
          continue;
        }

        for (const [ai, ad] of s.ads.entries()) {
          const ak = `${sk}a${ai}`;
          const m = media.get(mediaKey(ad));
          if (!m || m.error) {
            update(ak, { status: "error", detail: `Media failed: ${m?.error ?? "not uploaded"}` });
            continue;
          }
          update(ak, { status: "running" });
          try {
            const r = await post<{ id: string }>("/api/admin/ad-uploader/launch", { ...base, step: "ad", c: ci, s: si, a: ai, adsetId, media: m });
            update(ak, { status: "done", id: r.id });
          } catch (e) {
            update(ak, { status: "error", detail: (e as Error).message });
          }
        }
      }
    }
    setRunning(false);
  }

  function downloadResults() {
    const rows = [["level", "name", "status", "meta_id", "detail"]];
    for (const s of steps) rows.push([["campaign", "ad set", "ad"][s.level], s.label, s.status, s.id ?? "", s.detail ?? ""]);
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    downloadText(`ad-upload-results-${new Date().toISOString().slice(0, 10)}.csv`, rows.map((r) => r.map(esc).join(",")).join("\n"));
  }

  const done = steps.filter((s) => s.level === 2 && s.status === "done").length;
  const failed = steps.filter((s) => s.level === 2 && (s.status === "error" || s.status === "skipped")).length;
  const finished = steps.length > 0 && !running;

  if (configured === false) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Connect Meta first</CardTitle>
          <CardDescription>
            Set <code>META_ADS_MANAGE_TOKEN</code> to a System User token from Advertisely&apos;s Business Manager with
            ads_management, pages_show_list, pages_read_engagement, pages_manage_ads and leads_retrieval. Then assign each
            client&apos;s ad account, Page and pixel to that System User.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* 1. Client account */}
      <Card>
        <CardHeader>
          <CardTitle>1. Client account</CardTitle>
          <CardDescription>
            Accounts, Pages and pixels shared to Advertisely&apos;s Business Manager and assigned to the System User.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {configured === null && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading accounts…</div>
          )}
          {loadError && <div className="text-sm text-rose-600">Couldn&apos;t load from Meta: {loadError}</div>}
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Ad account</Label>
              <Select value={accountId} onValueChange={setAccountId} disabled={running}>
                <SelectTrigger><SelectValue placeholder="Choose a client ad account" /></SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}{a.business ? ` · ${a.business}` : ""}{a.active ? "" : " (inactive)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {account && !account.active && <p className="text-xs text-amber-700">This ad account isn&apos;t active in Meta.</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Facebook Page</Label>
              <Select value={pageId} onValueChange={setPageId} disabled={running}>
                <SelectTrigger><SelectValue placeholder="Page the ads run from" /></SelectTrigger>
                <SelectContent>
                  {pages.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Pixel {needsPixel ? <span className="text-rose-600">(required for website leads)</span> : <span className="text-muted-foreground">(website lead ads only)</span>}</Label>
              <Select value={pixelId} onValueChange={setPixelId} disabled={running || !accountId}>
                <SelectTrigger><SelectValue placeholder="No pixel" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No pixel</SelectItem>
                  {pixels.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <label className="flex items-start gap-3 text-sm">
            <Checkbox checked={financial} onCheckedChange={(v) => setFinancial(v === true)} disabled={running} className="mt-0.5" />
            <span>
              <span className="font-medium">Financial products &amp; services special ad category</span>
              <span className="block text-muted-foreground">
                Required by Meta for insurance and other financial products in the US. Locks age targeting to 18–65+.
              </span>
            </span>
          </label>

          {pageId && (
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">Instant forms on this Page</div>
              {formsError && <p className="text-sm text-amber-700">{formsError}</p>}
              {!forms && !formsError && <p className="text-sm text-muted-foreground">Loading…</p>}
              {forms?.length === 0 && <p className="text-sm text-muted-foreground">No instant forms on this Page.</p>}
              {forms && forms.length > 0 && (
                <ul className="max-h-40 overflow-y-auto divide-y divide-slate-100 text-sm">
                  {forms.map((f) => (
                    <li key={f.id} className="flex items-center justify-between gap-3 py-1.5">
                      <span className="truncate">{f.name} {f.status && f.status !== "ACTIVE" && <Badge variant="muted" className="ml-1">{f.status.toLowerCase()}</Badge>}</span>
                      <button
                        type="button"
                        className="inline-flex shrink-0 items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => navigator.clipboard?.writeText(f.id)}
                        title="Copy form ID for the lead_form_id column"
                      >
                        {f.id} <Copy className="h-3 w-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 2. Sheet & creatives */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle>2. Sheet &amp; creatives</CardTitle>
            <CardDescription>One row per ad. Campaign and ad set columns repeat down the sheet to group ads.</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => downloadText("advertisely-ad-bulk-template.csv", adSheetTemplate())}>
            <Download className="h-4 w-4" /> Template
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <label className={cn("flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 p-6 text-center hover:border-slate-400", running && "pointer-events-none opacity-60")}>
              <FileSpreadsheet className="h-6 w-6 text-brand-red" />
              <span className="text-sm font-medium">{csvName || "Choose the CSV sheet"}</span>
              <span className="text-xs text-muted-foreground">Export from Google Sheets or Excel as .csv</span>
              <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => { onCsv(e.target.files?.[0]); e.target.value = ""; }} />
            </label>
            <label className={cn("flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 p-6 text-center hover:border-slate-400", running && "pointer-events-none opacity-60")}>
              <ImagePlus className="h-6 w-6 text-brand-red" />
              <span className="text-sm font-medium">{files.size ? `${files.size} image${files.size === 1 ? "" : "s"} added` : "Add image files"}</span>
              <span className="text-xs text-muted-foreground">File names must match the sheet&apos;s media column. Videos go in as https:// links.</span>
              <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => { onImages(e.target.files); e.target.value = ""; }} />
            </label>
          </div>
          {files.size > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {[...files.values()].map((f) => (
                <Badge key={f.name} variant="muted" className="gap-1">
                  {f.name}
                  <button
                    type="button"
                    aria-label={`Remove ${f.name}`}
                    disabled={running}
                    onClick={() => setFiles((prev) => { const n = new Map(prev); n.delete(f.name.toLowerCase()); return n; })}
                  >
                    <XCircle className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Sheet columns</summary>
            <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-[max-content_1fr]">
              {SHEET_COLUMNS.map((c) => (
                <div key={c.key} className="contents">
                  <dt className="font-mono text-xs pt-0.5">{c.key}{c.required && <span className="text-brand-red">*</span>}</dt>
                  <dd className="text-muted-foreground">{c.help}</dd>
                </div>
              ))}
            </dl>
          </details>
        </CardContent>
      </Card>

      {/* 3. Review */}
      {parsed && (
        <Card>
          <CardHeader>
            <CardTitle>3. Review</CardTitle>
            <CardDescription>
              {parsed.campaigns.length} campaign{parsed.campaigns.length === 1 ? "" : "s"} · {parsed.adsetCount} ad set{parsed.adsetCount === 1 ? "" : "s"} · {parsed.adCount} ad{parsed.adCount === 1 ? "" : "s"} ready
              {errors.length > 0 && ` · ${errors.length} problem${errors.length === 1 ? "" : "s"} to fix`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {parsed.issues.length > 0 && (
              <ul className="space-y-1 rounded-lg border border-slate-200 p-3 text-sm max-h-56 overflow-y-auto">
                {[...errors, ...warnings].map((iss, k) => (
                  <li key={k} className="flex gap-2">
                    {iss.level === "error" ? <XCircle className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" /> : <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />}
                    <span><span className="text-muted-foreground">{iss.row ? `Row ${iss.row}: ` : ""}</span>{iss.message}</span>
                  </li>
                ))}
              </ul>
            )}

            {parsed.campaigns.map((c) => (
              <div key={c.name} className="rounded-xl border border-slate-200">
                <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3">
                  <span className="font-medium">{c.name}</span>
                  <Badge variant="outline">{c.objective === "LEADS" ? "Leads" : "Traffic"}</Badge>
                  <Badge variant="muted" className="gap-1"><PauseCircle className="h-3 w-3" /> Paused</Badge>
                </div>
                {c.adsets.map((s) => (
                  <div key={s.name} className="border-b border-slate-100 last:border-0 px-4 py-3">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                      <span className="font-medium">{s.name}</span>
                      <span className="text-muted-foreground">
                        {formatCurrency(s.dailyBudgetCents / 100)}/day · {s.destination === "FORM" ? `Instant form ${s.leadFormId}` : "Website"} ·{" "}
                        {s.states.length ? s.states.join(", ") : "All US"} · Ages {s.ageMin}–{s.ageMax === 65 ? "65+" : s.ageMax}
                        {s.startDate && ` · Starts ${s.startDate}`}
                      </span>
                    </div>
                    <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {s.ads.map((a) => (
                        <li key={a.row} className="rounded-lg bg-slate-50 p-3 text-sm">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium truncate">{a.name}</span>
                            <Badge variant={a.mediaType === "video" ? "purple" : "info"}>{a.mediaType}</Badge>
                          </div>
                          <p className="mt-1 line-clamp-2 text-muted-foreground">{a.primaryText}</p>
                          <p className="mt-1 text-xs text-muted-foreground truncate">
                            {a.headline && <span className="text-foreground">{a.headline} · </span>}
                            {a.cta.replace(/_/g, " ").toLowerCase()} · {a.media}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ))}

            <div className="flex flex-wrap items-center gap-3 pt-2">
              {!confirming ? (
                <Button onClick={() => setConfirming(true)} disabled={!canLaunch}>
                  <Rocket className="h-4 w-4" /> Create in Meta (paused)
                </Button>
              ) : (
                <>
                  <span className="text-sm">
                    Create {parsed.adCount} paused ad{parsed.adCount === 1 ? "" : "s"} in <span className="font-medium">{account?.name}</span>?
                  </span>
                  <Button onClick={launch}>Yes, create them</Button>
                  <Button variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
                </>
              )}
              {!canLaunch && !running && (
                <span className="text-xs text-muted-foreground">
                  {!accountId || !pageId ? "Pick an ad account and Page first." : errors.length ? "Fix the problems above first." : needsPixel && pixelId === "none" ? "Pick a pixel for the website lead ad sets." : ""}
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 4. Progress & results */}
      {(mediaLog.length > 0 || steps.length > 0) && (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle>{running ? "Creating in Meta…" : "Results"}</CardTitle>
              <CardDescription>
                {finished
                  ? `${done} ad${done === 1 ? "" : "s"} created paused${failed ? `, ${failed} not created` : ""}. Review and turn them on in Ads Manager.`
                  : "Keep this tab open until it finishes."}
              </CardDescription>
            </div>
            {finished && (
              <Button variant="outline" size="sm" onClick={downloadResults}><Download className="h-4 w-4" /> Results CSV</Button>
            )}
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {mediaLog.length > 0 && (
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Creatives</div>
                <ul className="space-y-1">
                  {mediaLog.map((m, k) => (
                    <li key={k} className="flex gap-2"><StatusIcon status={m.status} /><span className="truncate">{m.name}</span>{m.detail && <span className="text-muted-foreground">— {m.detail}</span>}</li>
                  ))}
                </ul>
              </div>
            )}
            {steps.length > 0 && (
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Campaigns, ad sets &amp; ads</div>
                <ul className="space-y-1">
                  {steps.map((s) => (
                    <li key={s.key} className={cn("flex gap-2", s.level === 1 && "pl-5", s.level === 2 && "pl-10")}>
                      <StatusIcon status={s.status} />
                      <span className={cn(s.level === 0 && "font-medium")}>{s.label}</span>
                      {s.url && (
                        <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand-red hover:underline">
                          Ads Manager <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                      {s.detail && <span className={s.status === "error" ? "text-rose-600" : "text-muted-foreground"}>— {s.detail}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: Status }) {
  if (status === "running") return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground mt-0.5" />;
  if (status === "done") return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" />;
  if (status === "error") return <XCircle className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" />;
  if (status === "skipped") return <XCircle className="h-4 w-4 shrink-0 text-slate-400 mt-0.5" />;
  return <span className="h-4 w-4 shrink-0 mt-0.5 rounded-full border border-slate-300" />;
}
