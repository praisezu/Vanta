/*
 * Videos Discord can't show. HEVC (H.265) videos, common from newer phones, game captures and screen recorders,
 * can only be decoded by the graphics card. With Discord's Hardware Acceleration off (or on a PC without HEVC
 * support) they play sound with no picture, or not at all. When that happens to a video in chat, this says why and
 * offers to open it in the browser, which can play it.
 */
import { native } from "./core/native";
import { managedStyle } from "./core/utils";

let hevc: boolean | null = null;
/** Can this Discord decode HEVC at all? (asked once) */
async function canPlayHevc() {
    if (hevc != null) return hevc;
    try {
        const r = await navigator.mediaCapabilities.decodingInfo({ type: "file", video: { contentType: 'video/mp4; codecs="hvc1.1.6.L93.B0"', width: 1920, height: 1080, bitrate: 8e6, framerate: 30 } });
        hevc = r.supported;
    } catch { hevc = document.createElement("video").canPlayType('video/mp4; codecs="hvc1"') !== ""; }
    return hevc;
}

const inChat = (v: HTMLVideoElement) => !!v.closest('[id^="message-accessories-"], [id^="chat-messages-"]');

async function explain(v: HTMLVideoElement) {
    if (v.dataset.vantaNoPicture || await canPlayHevc()) return;
    v.dataset.vantaNoPicture = "1";
    const host = v.parentElement;
    if (!host) return;
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    const url = (v.currentSrc || v.src).replace("media.discordapp.net", "cdn.discordapp.com");
    const box = document.createElement("div");
    box.className = "vanta-no-picture";
    const text = document.createElement("span");
    text.textContent = "Discord can't show this video's picture (it's HEVC). Turn on Hardware Acceleration in Settings › Advanced, or watch it in your browser.";
    const open = document.createElement("button");
    open.type = "button";
    open.textContent = "Open in browser";
    open.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); native.openUrl(url); });
    box.append(text, open);
    host.append(box);
}

export function startVideoFallback() {
    managedStyle("vanta-video-fallback").set(`
.vanta-no-picture { position: absolute; left: 8px; right: 8px; bottom: 44px; z-index: 2; display: flex; gap: 10px; align-items: center; padding: 8px 10px; border-radius: 8px;
  background: rgba(0,0,0,.78); color: #fff; font: 500 12.5px/1.35 var(--font-primary, sans-serif); }
.vanta-no-picture span { flex: 1; }
.vanta-no-picture button { all: unset; cursor: pointer; padding: 5px 10px; border-radius: 6px; background: var(--brand-500, #5865f2); color: #fff; font-weight: 600; white-space: nowrap; }`);
    // Media events don't bubble, but the document still sees them while capturing
    document.addEventListener("loadeddata", e => {
        const v = e.target;
        if (v instanceof HTMLVideoElement && inChat(v) && v.videoWidth === 0 && v.videoHeight === 0 && v.duration > 0) explain(v);
    }, true);
    document.addEventListener("error", e => {
        const v = e.target;
        if (v instanceof HTMLVideoElement && inChat(v) && v.error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) explain(v);
    }, true);
}
