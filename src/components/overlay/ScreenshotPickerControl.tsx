"use client";

import { useEffect, useRef, useState } from "react";
import type { AIPickerResponse } from "@/lib/ai-picker-types";

function fileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the image."));
    reader.readAsDataURL(file);
  });
}

export function ScreenshotPickerControl({ championId, level, currentEntityKeys, onResult }: { championId: number | string | null | undefined; level: number; currentEntityKeys: string[]; onResult: (result: AIPickerResponse) => void }) {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function analyzeImage(image: Blob): Promise<void> {
    if (!championId) throw new Error("Hover or lock a champion first.");
    if (!image.type.startsWith("image/")) throw new Error("The clipboard does not contain an image.");
    setBusy(true);
    setStatus("Reading three offers…");
    try {
      const response = await fetch("/api/ai-picker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ championId, level, currentEntityKeys, screenshotDataUrl: await fileAsDataUrl(image), opponent: "current Arena lobby", useAI: true }),
      });
      const payload = await response.json() as AIPickerResponse | { error: string };
      if (!response.ok || "error" in payload) throw new Error("error" in payload ? payload.error : "Screenshot analysis failed.");
      onResult(payload);
      setStatus(`Picked ${payload.recommendation.name}`);
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : String(caught));
    } finally { setBusy(false); }
  }

  async function readClipboard(): Promise<void> {
    try {
      if (!navigator.clipboard?.read) throw new Error("Clipboard image reading is unavailable here. Use the image button.");
      const items = await navigator.clipboard.read();
      const imageType = items.flatMap((item) => item.types).find((type) => type.startsWith("image/"));
      const item = items.find((candidate) => imageType && candidate.types.includes(imageType));
      if (!item || !imageType) throw new Error("Copy a snip first (Win+Shift+S), then try again.");
      await analyzeImage(await item.getType(imageType));
    } catch (caught) { setStatus(caught instanceof Error ? caught.message : String(caught)); }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "a") {
        event.preventDefault();
        void readClipboard();
      }
    };
    const onPaste = (event: ClipboardEvent) => {
      const image = [...(event.clipboardData?.files ?? [])].find((file) => file.type.startsWith("image/"));
      if (image) { event.preventDefault(); void analyzeImage(image); }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("paste", onPaste);
    return () => { window.removeEventListener("keydown", onKeyDown); window.removeEventListener("paste", onPaste); };
  });

  return <div className="screenshot-picker-control">
    <button type="button" title="Use Win+Shift+S, focus this overlay, then press Ctrl+Shift+A" disabled={busy || !championId} onClick={() => void readClipboard()}><span>⌁</span>{busy ? "Analyzing…" : "Paste augment snip"}<kbd>Ctrl Shift A</kbd></button>
    <button className="screenshot-file-button" type="button" disabled={busy || !championId} title="Choose screenshot file" onClick={() => inputRef.current?.click()}>Image</button>
    <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void analyzeImage(file); event.target.value = ""; }} />
    {status && <p>{status}</p>}
  </div>;
}
