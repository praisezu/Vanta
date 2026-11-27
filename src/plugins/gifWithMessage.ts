import { definePlugin, webpack, patcher, common } from "@api";

/** Discord's GIF tab in the expression picker (GIFs and their categories) */
const GIF_PANEL = '#gif-picker-tab-panel, [class*="gifPicker"], [class*="gifs_"]';

export default definePlugin({
    name: "GifWithMessage",
    description: "Picking a GIF doesn't send it straight away: its link goes into your message box, so you can write something with it and send both together. Shift+click a GIF to send it right away like before.",
    authors: ["Vanta"],
    category: "Chat",
    since: "0.6.9",
    needsWebpack: true,
    options: {
        position: {
            type: "select", default: "end", label: "Where the GIF goes",
            options: [{ value: "end", label: "After what you've typed" }, { value: "start", label: "Before what you've typed" }],
        },
    },

    /** Puts the GIF link into the message box (Discord shows the GIF under your message when you send it) */
    insert(url: string) {
        const box = document.querySelector<HTMLElement>('[role="textbox"][data-slate-editor="true"]');
        if (!box) return false;
        box.focus();
        const typed = (box.textContent ?? "").replace(/﻿/g, "").trim();
        const sel = window.getSelection();
        if (sel) {
            const range = document.createRange();
            range.selectNodeContents(box);
            range.collapse(this.settings.position === "start");
            sel.removeAllRanges();
            sel.addRange(range);
        }
        const text = !typed ? url + " " : this.settings.position === "start" ? url + " " : " " + url;
        return document.execCommand("insertText", false, text);
    },

    start() {
        const actions = webpack.findByProps("sendMessage", "editMessage", "deleteMessage")
            ?? webpack.findByProps("sendMessage", "receiveMessage");
        if (!actions?.sendMessage) throw new Error("Discord's message sending wasn't found");

        // A click (or Enter) on a GIF arms us for a moment; the send Discord makes right after is the GIF's
        this.armedAt = 0;
        this.onPick = (e: MouseEvent | KeyboardEvent) => {
            const target = e.target as Element | null;
            if (!target?.closest?.(GIF_PANEL)) return;
            if (e instanceof KeyboardEvent && e.key !== "Enter") return;
            if (target.closest('input, [role="tab"], [class*="searchBar"], [class*="category"]')) return; // search box, tabs, category tiles
            this.armedAt = e.shiftKey ? 0 : Date.now();
        };
        document.addEventListener("click", this.onPick, true);
        document.addEventListener("keydown", this.onPick, true);

        this.unpatch = patcher.instead(actions, "sendMessage", (args: any[], original: (...a: any[]) => any) => {
            const [channelId, message] = args;
            const content = String(message?.content ?? "");
            const fresh = Date.now() - this.armedAt < 1500;
            const isGifLink = /^https?:\/\/\S+$/.test(content.trim());
            if (!fresh || !isGifLink || channelId !== common.SelectedChannelStore?.getChannelId?.()) return original(...args);
            this.armedAt = 0;
            if (!this.insert(content.trim())) return original(...args); // no message box: send it after all
            return Promise.resolve();
        });
    },
    stop() {
        document.removeEventListener("click", this.onPick, true);
        document.removeEventListener("keydown", this.onPick, true);
        this.unpatch?.();
    },
});
