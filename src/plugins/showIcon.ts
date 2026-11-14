import { definePlugin, native, ui, h, cleanError, managedStyle } from "@api";
import { fullImageUrl } from "./viewFullImages";

/** Profile pictures, server icons and banners (not message images or emoji) */
const KINDS: [RegExp, string][] = [
    [/^\/banners\/|\/users\/\d+\/banners\//, "banner"],
    [/^\/icons\//, "server-icon"],
    [/^\/avatars\/|\/users\/\d+\/avatars\/|^\/embed\/avatars\//, "avatar"],
    [/^\/app-icons\//, "app-icon"],
    [/^\/role-icons\//, "role-icon"],
    [/^\/splashes\/|^\/discovery-splashes\//, "server-splash"],
];

function kindOf(url: string) {
    try {
        const u = new URL(url);
        if (!/^(cdn\.discordapp\.com|media\.discordapp\.net)$/.test(u.hostname)) return null;
        return KINDS.find(([re]) => re.test(u.pathname))?.[1] ?? null;
    } catch { return null; }
}

/** The image under the pointer: an <img> (avatars are often inside an svg) or a background image (banners) */
function imageAt(target: Element): string | null {
    const img = target.closest?.("img") ?? target.querySelector?.(":scope img");
    if (img && (img as HTMLImageElement).src) return (img as HTMLImageElement).src;
    for (let el: Element | null = target; el && el !== document.body; el = el.parentElement) {
        const bg = (el as HTMLElement).style?.backgroundImage;
        const m = bg && /url\(["']?(.*?)["']?\)/.exec(bg);
        if (m) return m[1];
    }
    return null;
}

/** A PNG copy of an image (the clipboard only takes PNG; a GIF gives its first frame) */
async function asPng(blob: Blob): Promise<Blob> {
    if (blob.type === "image/png") return blob;
    const bmp = await createImageBitmap(blob);
    const c = document.createElement("canvas");
    c.width = bmp.width; c.height = bmp.height;
    c.getContext("2d")!.drawImage(bmp, 0, 0);
    return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error("Couldn't convert the image")), "image/png"));
}

export default definePlugin({
    name: "ShowIcon",
    description: "Double-click a profile picture, banner or server icon to see it up close, then copy or save it.",
    authors: ["Vanta"],
    category: "Utility",
    since: "0.6.8",

    show(src: string, kind: string) {
        const url = /\/embed\/avatars\//.test(src) ? src.replace(/\?.*$/, "") : fullImageUrl(src) ?? src;
        const file = (new URL(url).pathname.split("/").pop() || "image.png").replace(/^a_/, "");
        const name = `${kind}-${file}`;
        const status = h("span", { class: "vanta-showicon-status" });
        const say = (t: string) => { status.textContent = t; };
        const img = h("img", { class: "vanta-showicon-img" + (kind === "banner" || kind === "server-splash" ? " wide" : ""), src: url, alt: kind.replace("-", " ") }) as HTMLImageElement;
        const size = h("span", { class: "vanta-showicon-size" });
        img.onload = () => { size.textContent = `${img.naturalWidth} × ${img.naturalHeight}`; };
        img.onerror = () => { if (img.src !== src) img.src = src; }; // full size not available: the one on screen
        const act = (label: string, fn: () => Promise<void> | void) => ui.button(label, { variant: "ghost", onClick: async () => { try { await fn(); } catch (e) { say(cleanError(e)); } } });
        ui.modal({
            title: kind === "server-icon" ? "Server icon" : kind === "banner" ? "Banner" : kind === "avatar" ? "Profile picture" : "Image",
            body: h("div", { class: "vanta-showicon" },
                h("div", { class: "vanta-showicon-stage" }, img),
                h("div", { class: "vanta-showicon-bar" },
                    size,
                    act("Copy image", async () => {
                        const blob = await (await fetch(img.src)).blob();
                        // Discord's own image copier (the one behind its "Copy Image" menu item): the page can't write images itself
                        const copier = (window as any).DiscordNative?.clipboard?.copyImage;
                        if (typeof copier !== "function") throw new Error("Copying images isn't available here. Use Save or Copy link.");
                        await copier(new Uint8Array(await (await asPng(blob)).arrayBuffer()), img.src);
                        say(/\.gif/.test(img.src) ? "Copied (a still frame: the clipboard can't hold animations)" : "Copied!");
                    }),
                    act("Copy link", async () => { await navigator.clipboard.writeText(img.src); say("Link copied!"); }),
                    act("Save", async () => { const n = await native.saveFiles([{ url: img.src, name }]); say(n ? "Saved!" : ""); }),
                    act("Open in browser", () => native.openUrl(img.src))),
                status),
            buttons: [{ text: "Close", variant: "primary" }],
        });
    },

    start() {
        this.css = managedStyle("vanta-showicon-css");
        this.css.set(`
.vanta-showicon { display: flex; flex-direction: column; gap: 12px; align-items: center; }
.vanta-showicon-stage { display: grid; place-items: center; min-height: 160px; width: 100%; padding: 12px; box-sizing: border-box; border-radius: 8px;
  background: repeating-conic-gradient(rgba(255,255,255,.05) 0 25%, transparent 0 50%) 0 0 / 16px 16px; }
.vanta-showicon-img { max-width: min(440px, 70vw); max-height: 48vh; border-radius: 12px; }
.vanta-showicon-img.wide { max-width: min(760px, 80vw); }
.vanta-showicon-bar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; justify-content: center; }
.vanta-showicon-size { font-size: 12px; color: var(--text-muted); margin-right: 6px; }
.vanta-showicon-status { font-size: 13px; color: var(--text-positive, #23a55a); min-height: 18px; }
.vanta-scope .vanta-modal:has(.vanta-showicon) { width: auto; max-width: 92vw; }`);
        this.onDbl = (e: MouseEvent) => {
            const src = e.target instanceof Element ? imageAt(e.target) : null;
            const kind = src && kindOf(src);
            if (!kind) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            this.show(src!, kind);
        };
        document.addEventListener("dblclick", this.onDbl, true);
    },
    stop() {
        document.removeEventListener("dblclick", this.onDbl, true);
        this.css?.remove();
    },
});
