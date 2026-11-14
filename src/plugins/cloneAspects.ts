import { definePlugin, common, discord, webpack, ui, h, cleanError, managedStyle } from "@api";

/** Discord's permission bits for adding emoji and stickers: "Create Expressions" (newer) and "Manage Expressions" */
const CREATE_EXPRESSIONS = 1n << 43n;
const MANAGE_EXPRESSIONS = 1n << 30n;
/** Emoji slots (static and animated each) and sticker slots, by server boost level */
const EMOJI_SLOTS = [50, 100, 150, 250];
const STICKER_SLOTS = [5, 15, 30, 60];
/** Channel types a new server can have: text, voice, category, announcement→text, stage→voice, forum, media */
const CHANNEL_TYPE: Record<number, number> = { 0: 0, 2: 2, 4: 4, 5: 0, 13: 2, 15: 15, 16: 16 };

interface Emoji { id: string; name: string; animated: boolean }
interface Sticker { id: string; ext: string }
type Target = { kind: "emoji"; emoji: Emoji } | { kind: "sticker"; sticker: Sticker } | { kind: "server"; guildId: string };

/** The custom emoji under the pointer (in messages, reactions, the picker, profiles…), or null */
export function emojiAt(target: Element | null): Emoji | null {
    const img = target?.closest?.("img") ?? target?.querySelector?.(":scope img");
    const m = img && /\/emojis\/(\d+)\.(\w+)/.exec((img as HTMLImageElement).src || "");
    if (!m) return null;
    const raw = img!.getAttribute("data-name") || img!.getAttribute("alt") || img!.getAttribute("aria-label") || "emoji";
    const name = raw.replace(/^:|:$/g, "").replace(/[^\w]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").slice(0, 32) || "emoji";
    const animated = m[2] === "gif" || /animated=true/.test((img as HTMLImageElement).src);
    return { id: m[1], name: name.length < 2 ? name + "_" : name, animated };
}

/** The sticker under the pointer (in messages or the sticker picker), or null */
export function stickerAt(target: Element | null): Sticker | null {
    const img = target?.closest?.("img") ?? target?.querySelector?.(":scope img");
    const m = img && /\/stickers\/(\d+)\.(\w+)/.exec((img as HTMLImageElement).src || "");
    return m ? { id: m[1], ext: m[2] } : null;
}

/** The server icon under the pointer in the server list, or null */
export function serverAt(target: Element | null): string | null {
    const item = target?.closest?.('[data-list-item-id^="guildsnav___"]');
    const m = item && /^guildsnav___(\d+)$/.exec(item.getAttribute("data-list-item-id") || "");
    return m ? m[1] : null;
}

/** A valid emoji name: 2-32 letters, numbers and underscores */
export const cleanName = (s: string) => s.trim().replace(/[^\w]/g, "_").slice(0, 32);

const bit = (perms: any, flag: bigint) => { try { return (BigInt(perms) & flag) === flag; } catch { return false; } };

const toDataUrl = (blob: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });

/** A readable message from a failed Discord API call */
function apiError(e: any, full: string): Error {
    const code = e?.body?.code;
    if (e?.status === 429) return new Error(`Discord says slow down: try again in ${Math.ceil(Number(e?.body?.retry_after) || 60)} seconds.`);
    if (code === 30008 || code === 30039) return new Error(full);
    if (code === 50013) return new Error("You're not allowed to do that in that server.");
    if (code === 30001) return new Error("You're in the most servers Discord allows (100), so you can't make another.");
    const firstNested = (o: any): string | undefined => o && typeof o === "object" ? (o._errors?.[0]?.message ?? Object.values(o).map(firstNested).find(Boolean)) : undefined;
    return new Error(firstNested(e?.body?.errors) ?? e?.body?.message ?? cleanError(e));
}

export default definePlugin({
    name: "CloneAspects",
    formerNames: ["CloneEmojis"],
    description: "Right-click a custom emoji, a sticker or a server icon to clone it: emoji and stickers into a server where you're allowed to add them, and servers into a new server of your own (roles, channels, categories, permissions and icon, no messages or members).",
    authors: ["Vanta"],
    category: "Utility",
    since: "0.6.8",
    needsWebpack: true,
    risky: "Somewhat risky. Cloning a server makes a whole new server with one big request, and cloning stickers and emoji uploads them through Discord's API; the normal app doesn't copy other servers' things this way. Fine for occasional use; cloning lots in a row could look like automation to Discord.",

    /** Servers where you can add emoji or stickers, with how many slots are free */
    servers(what: "emoji" | "sticker", animated = false) {
        const me = common.UserStore?.getCurrentUser?.()?.id;
        const perms = webpack.findStore?.("PermissionStore");
        const emojis = webpack.findStore?.("EmojiStore");
        const stickers = webpack.findStore?.("StickersStore");
        const guilds = Object.values(common.GuildStore?.getGuilds?.() ?? {}) as any[];
        return guilds.filter(g => {
            if (g.ownerId === me) return true;
            try { if (perms?.can?.(CREATE_EXPRESSIONS, g) || perms?.can?.(MANAGE_EXPRESSIONS, g)) return true; } catch { }
            const p = perms?.getGuildPermissions?.(g);
            return p != null && (bit(p, CREATE_EXPRESSIONS) || bit(p, MANAGE_EXPRESSIONS) || bit(p, 8n /* Administrator */));
        }).map(g => {
            const tier = g.premiumTier ?? 0;
            let limit: number, used: number | null = null;
            if (what === "emoji") {
                limit = Math.max(EMOJI_SLOTS[tier] ?? 50, g.features?.has?.("MORE_EMOJI") ? 200 : 0);
                const list: any[] | undefined = emojis?.getGuildEmoji?.(g.id);
                if (list) used = list.filter(e => !!e.animated === animated).length;
            } else {
                limit = Math.max(STICKER_SLOTS[tier] ?? 5, g.features?.has?.("MORE_STICKERS") ? 60 : 0);
                const list: any[] | undefined = stickers?.getStickersByGuildId?.(g.id);
                if (list) used = list.length;
            }
            return { id: g.id, name: g.name as string, free: used == null ? null : limit - used, limit };
        }).sort((a, b) => a.name.localeCompare(b.name));
    },

    /** The server picker shared by the emoji and sticker windows */
    serverPicker(list: ReturnType<any>) {
        const pick = h("select", { class: "vanta-input", "aria-label": "Server" }, list.map((s: any) =>
            h("option", { value: s.id, disabled: s.free === 0 }, s.name + (s.free == null ? "" : s.free === 0 ? " (full)" : ` (${s.free} of ${s.limit} free)`)))) as HTMLSelectElement;
        const firstFree = list.find((s: any) => s.free !== 0);
        if (firstFree) pick.value = firstFree.id;
        return pick;
    },

    // ---------- emoji ----------
    async uploadEmoji(guildId: string, emoji: Emoji, name: string) {
        // Discord takes up to 256 KB: try a big copy first, smaller if it's too heavy
        let blob: Blob | null = null;
        for (const size of [128, 96, 64]) {
            const res = await fetch(`https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? "gif" : "png"}?size=${size}&quality=lossless`);
            if (!res.ok) throw new Error(`Couldn't download the emoji (HTTP ${res.status})`);
            blob = await res.blob();
            if (blob.size <= 256_000) break;
        }
        if (!blob || blob.size > 256_000) throw new Error("This emoji is too big for Discord's 256 KB limit.");
        try {
            return (await discord.api().post({ url: `/guilds/${guildId}/emojis`, body: { name, image: await toDataUrl(blob), roles: [] } })).body;
        } catch (e) { throw apiError(e, "That server has no free emoji slots."); }
    },

    cloneEmoji(emoji: Emoji) {
        const servers = this.servers("emoji", emoji.animated);
        if (!servers.length) { ui.toast("You can't add emoji in any of your servers.", { type: "danger" }); return; }
        const nameIn = h("input", { class: "vanta-input", value: emoji.name, maxlength: 32, "aria-label": "Emoji name" }) as HTMLInputElement;
        const pick = this.serverPicker(servers);
        const err = h("div", { class: "vanta-clone-err" });
        nameIn.addEventListener("input", () => { nameIn.value = cleanName(nameIn.value); });
        ui.modal({
            title: "Clone emoji",
            body: h("div", { class: "vanta-clone" },
                h("img", { src: `https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? "gif" : "webp"}?size=96`, alt: "", class: "vanta-clone-img" }),
                h("label", {}, h("span", {}, "Name"), nameIn),
                h("label", {}, h("span", {}, emoji.animated ? "Server (animated emoji slots)" : "Server"), pick),
                err),
            buttons: [
                { text: "Cancel", variant: "ghost" },
                {
                    text: "Clone", variant: "primary", onClick: async () => {
                        const name = cleanName(nameIn.value);
                        if (name.length < 2) { err.textContent = "The name needs at least 2 letters, numbers or underscores."; return false; }
                        err.textContent = "";
                        try {
                            await this.uploadEmoji(pick.value, emoji, name);
                            ui.toast(`Added :${name}: to ${servers.find(s => s.id === pick.value)?.name}`, { type: "ok" });
                        } catch (e) { err.textContent = cleanError(e); return false; }
                    },
                },
            ],
        });
    },

    // ---------- stickers ----------
    async cloneSticker(st: Sticker) {
        let info: any;
        try { info = (await discord.api().get({ url: `/stickers/${st.id}` })).body; }
        catch (e) { ui.toast("Couldn't read that sticker: " + cleanError(e), { type: "danger" }); return; }
        if (info.format_type === 3) { ui.toast("That's an animated Lottie sticker (Discord's own kind); those can't be uploaded to servers.", { type: "danger" }); return; }
        const servers = this.servers("sticker");
        if (!servers.length) { ui.toast("You can't add stickers in any of your servers.", { type: "danger" }); return; }
        const ext = info.format_type === 4 ? "gif" : "png";
        const src = `https://media.discordapp.net/stickers/${st.id}.${ext}?size=320`;
        const nameIn = h("input", { class: "vanta-input", value: String(info.name ?? "sticker").slice(0, 30), maxlength: 30, "aria-label": "Sticker name" }) as HTMLInputElement;
        const tagIn = h("input", { class: "vanta-input", value: String(info.tags ?? "").split(",")[0]?.trim() || "⭐", maxlength: 50, "aria-label": "Related emoji" }) as HTMLInputElement;
        const pick = this.serverPicker(servers);
        const err = h("div", { class: "vanta-clone-err" });
        ui.modal({
            title: "Clone sticker",
            body: h("div", { class: "vanta-clone" },
                h("img", { src, alt: "", class: "vanta-clone-img sticker" }),
                h("label", {}, h("span", {}, "Name"), nameIn),
                h("label", {}, h("span", {}, "Related emoji (or a word)"), tagIn),
                h("label", {}, h("span", {}, "Server"), pick),
                err),
            buttons: [
                { text: "Cancel", variant: "ghost" },
                {
                    text: "Clone", variant: "primary", onClick: async () => {
                        const name = nameIn.value.trim();
                        if (name.length < 2) { err.textContent = "The name needs 2 to 30 characters."; return false; }
                        err.textContent = "";
                        try {
                            const res = await fetch(src.replace(/\?size=\d+/, ""));
                            if (!res.ok) throw new Error(`Couldn't download the sticker (HTTP ${res.status})`);
                            const blob = await res.blob();
                            if (blob.size > 512_000) throw new Error("This sticker is bigger than Discord's 512 KB limit.");
                            const file = new File([blob], `${name}.${ext}`, { type: blob.type || `image/${ext}` });
                            try {
                                await discord.api().post({
                                    url: `/guilds/${pick.value}/stickers`,
                                    fields: [{ name: "name", value: name }, { name: "tags", value: tagIn.value.trim() || "⭐" }, { name: "description", value: String(info.description ?? "") }],
                                    attachments: [{ name: "file", file, filename: file.name }],
                                });
                            } catch (e) { throw apiError(e, "That server has no free sticker slots."); }
                            ui.toast(`Added the ${name} sticker to ${servers.find(s => s.id === pick.value)?.name}`, { type: "ok" });
                        } catch (e) { err.textContent = cleanError(e); return false; }
                    },
                },
            ],
        });
    },

    // ---------- servers ----------
    /** A new server's create request copied from an existing one: roles, categories, channels, permissions and icon */
    async serverTemplate(guildId: string, opts: { roles: boolean; channels: boolean; icon: boolean }) {
        const api = discord.api();
        const g = common.GuildStore?.getGuild?.(guildId);
        const roles: any[] = opts.roles || opts.channels ? (await api.get({ url: `/guilds/${guildId}/roles` })).body : [];
        const channels: any[] = opts.channels ? (await api.get({ url: `/guilds/${guildId}/channels` })).body : [];
        // New servers take placeholder ids (small numbers) that link roles to overwrites and channels to categories
        const ids = new Map<string, number>();
        let next = 1;
        const everyone = roles.find(r => r.id === guildId);
        const outRoles: any[] = [];
        ids.set(guildId, 0);
        outRoles.push({ id: 0, permissions: everyone?.permissions ?? "0" });
        if (opts.roles) {
            // A new server stacks roles in the order given, from the bottom up: lowest first, so the top role stays on top
            for (const r of [...roles].filter(r => r.id !== guildId && !r.managed).sort((a, b) => a.position - b.position || (BigInt(b.id) > BigInt(a.id) ? 1 : -1))) {
                ids.set(r.id, next);
                outRoles.push({ id: next++, name: r.name, color: r.color, hoist: r.hoist, mentionable: r.mentionable, permissions: r.permissions });
            }
        }
        const outChannels: any[] = [];
        if (opts.channels) {
            const cats = channels.filter(c => c.type === 4).sort((a, b) => a.position - b.position);
            const rest = channels.filter(c => c.type !== 4 && c.type in CHANNEL_TYPE).sort((a, b) => a.position - b.position);
            for (const c of [...cats, ...rest]) {
                ids.set(c.id, next);
                outChannels.push({
                    id: next++,
                    name: c.name,
                    type: CHANNEL_TYPE[c.type],
                    parent_id: c.parent_id && ids.has(c.parent_id) ? ids.get(c.parent_id) : undefined,
                    topic: c.topic ?? undefined,
                    nsfw: c.nsfw || undefined,
                    rate_limit_per_user: c.rate_limit_per_user || undefined,
                    bitrate: c.type === 2 ? Math.min(c.bitrate ?? 64000, 96000) : undefined,
                    user_limit: c.type === 2 && c.user_limit ? Math.min(99, c.user_limit) : undefined, // stage channels become voice, which allows at most 99
                    permission_overwrites: (c.permission_overwrites ?? [])
                        .filter((o: any) => o.type === 0 && ids.has(o.id)) // role overwrites only; people aren't copied
                        .map((o: any) => ({ id: ids.get(o.id), type: 0, allow: o.allow, deny: o.deny })),
                });
            }
        }
        let icon: string | undefined;
        if (opts.icon && g?.icon) {
            const res = await fetch(`https://cdn.discordapp.com/icons/${guildId}/${g.icon}.png?size=512`);
            if (res.ok) icon = await toDataUrl(await res.blob());
        }
        return { roles: outRoles, channels: outChannels, icon, counts: { roles: outRoles.length - 1, channels: outChannels.length } };
    },

    cloneServer(guildId: string) {
        const g = common.GuildStore?.getGuild?.(guildId);
        if (!g) return;
        const nameIn = h("input", { class: "vanta-input", value: `${g.name} (copy)`.slice(0, 100), maxlength: 100, "aria-label": "New server name" }) as HTMLInputElement;
        const check = (label: string, on = true) => {
            const box = h("input", { type: "checkbox", checked: on }) as HTMLInputElement;
            return { box, row: h("label", { class: "vanta-clone-check" }, box, h("span", {}, label)) };
        };
        const roles = check("Roles and their permissions"), channels = check("Categories, channels and their permissions"), icon = check("Server icon");
        const err = h("div", { class: "vanta-clone-err" });
        ui.modal({
            title: "Clone server",
            body: h("div", { class: "vanta-clone" },
                g.icon ? h("img", { src: `https://cdn.discordapp.com/icons/${guildId}/${g.icon}.webp?size=96`, alt: "", class: "vanta-clone-img round" }) : null,
                h("p", { class: "vanta-clone-note" }, `Makes a new server owned by you, copied from ${g.name}. Messages, members, emoji, bots and webhooks aren't copied.`),
                h("label", {}, h("span", {}, "New server name"), nameIn),
                roles.row, channels.row, icon.row,
                err),
            buttons: [
                { text: "Cancel", variant: "ghost" },
                {
                    text: "Create server", variant: "primary", onClick: async () => {
                        const name = nameIn.value.trim();
                        if (name.length < 2) { err.textContent = "The name needs at least 2 characters."; return false; }
                        err.textContent = "Copying…";
                        try {
                            const t = await this.serverTemplate(guildId, { roles: roles.box.checked, channels: channels.box.checked, icon: icon.box.checked });
                            let made: any;
                            try {
                                made = (await discord.api().post({ url: "/guilds", body: { name, icon: t.icon, roles: t.roles, channels: t.channels, system_channel_id: undefined } })).body;
                            } catch (e) { throw apiError(e, ""); }
                            ui.toast(`Made ${name}: ${t.counts.roles} roles, ${t.counts.channels} channels`, { type: "ok" });
                            if (made?.id) setTimeout(() => discord.go(`/channels/${made.id}`), 800);
                        } catch (e) { err.textContent = cleanError(e); return false; }
                    },
                },
            ],
        });
    },

    // ---------- the right-click menu ----------
    /**
     * Adds an item to the menu Discord opens (watching for it for up to 1.5 s: the first menu after startup can be
     * slow while Discord loads its menu code), and keeps it there if Discord redraws the menu. If Discord opens no
     * menu at all here, a small one of our own appears.
     */
    addMenuItem(label: string, run: () => void, x: number, y: number) {
        this.cleanupMenu?.();
        const before = new Set(document.querySelectorAll('[role="menu"]'));
        const go = () => { this.cleanupMenu?.(); run(); };
        let menu: HTMLElement | null = null;
        const makeItem = (template: HTMLElement) => {
            const item = template.cloneNode(true) as HTMLElement;
            item.removeAttribute("id");
            // Never look greyed out, even if the item it was copied from was (like "Mark As Read" with nothing unread)
            item.removeAttribute("aria-disabled");
            for (const el of [item, ...item.querySelectorAll<HTMLElement>("*")]) {
                for (const c of [...el.classList]) if (/^disabled_|^disabled$/i.test(c)) el.classList.remove(c);
            }
            item.classList.add("vanta-clone-item");
            item.setAttribute("aria-label", label);
            const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT, { acceptNode: n => n.textContent!.trim() ? 1 : 3 });
            const first = walker.nextNode();
            if (first) first.textContent = label;
            for (let n = walker.nextNode(); n; n = walker.nextNode()) n.textContent = "";
            item.querySelectorAll("svg").forEach(s => s.remove());
            item.addEventListener("click", e => {
                e.preventDefault(); e.stopPropagation();
                document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }));
                go();
            }, true);
            return item;
        };
        const inject = () => {
            if (!menu?.isConnected || menu.querySelector(".vanta-clone-item")) return;
            const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')];
            // Copy the look of a normal, enabled item: not a disabled one, a red one (Leave Server) or a checkbox
            const template = items.find(i => i.getAttribute("aria-disabled") !== "true" && ![...i.classList].some(c => /^(disabled|colorDanger|danger)/i.test(c)) && !i.querySelector('[role="checkbox"], input')) ?? items[0];
            if (!template) return;
            (menu.querySelector('[role="group"]') ?? template.parentElement)?.prepend(makeItem(template));
        };
        const own = () => {
            const el = h("div", { class: "vanta-clone-menu vanta-scope", role: "menu", style: { left: x + "px", top: y + "px" } },
                h("button", { type: "button", role: "menuitem", onclick: go }, label)) as HTMLElement;
            document.body.append(el);
            this.menuEl = el;
            const away = (e: Event) => { if (!el.contains(e.target as Node)) { el.remove(); document.removeEventListener("mousedown", away, true); } };
            setTimeout(() => document.addEventListener("mousedown", away, true));
        };
        const obs = new MutationObserver(() => {
            if (!menu || !menu.isConnected) menu = [...document.querySelectorAll<HTMLElement>('[role="menu"]')].find(m => !before.has(m) && !m.classList.contains("vanta-clone-menu")) ?? null;
            if (menu) { this.menuEl?.remove(); inject(); }
        });
        obs.observe(document.body, { childList: true, subtree: true });
        const fallback = setTimeout(() => { if (!menu) own(); }, 350);
        const stop = setTimeout(() => this.cleanupMenu?.(), 1500 + 30_000); // keep the item while the menu stays open
        const giveUp = setTimeout(() => { if (!menu) { obs.disconnect(); } }, 1500);
        this.cleanupMenu = () => { obs.disconnect(); clearTimeout(fallback); clearTimeout(stop); clearTimeout(giveUp); this.menuEl?.remove(); this.cleanupMenu = null; };
    },

    targetAt(el: Element | null): Target | null {
        const emoji = emojiAt(el);
        if (emoji) return { kind: "emoji", emoji };
        const sticker = stickerAt(el);
        if (sticker) return { kind: "sticker", sticker };
        const guildId = serverAt(el);
        return guildId ? { kind: "server", guildId } : null;
    },

    start() {
        this.css = managedStyle("vanta-clone-css");
        this.css.set(`
.vanta-clone-item:hover { background: var(--menu-item-default-hover-bg, var(--brand-500, #5865f2)); color: #fff; }
.vanta-clone { display: flex; flex-direction: column; gap: 12px; }
.vanta-clone-img { width: 64px; height: 64px; object-fit: contain; align-self: center; }
.vanta-clone-img.sticker { width: 120px; height: 120px; }
.vanta-clone-img.round { border-radius: 50%; }
.vanta-clone-note { margin: 0; font-size: 13px; color: var(--text-muted); text-align: center; }
.vanta-clone label { display: flex; flex-direction: column; gap: 6px; font-size: 12px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; }
.vanta-clone label.vanta-clone-check { flex-direction: row; align-items: center; gap: 8px; text-transform: none; font-size: 14px; font-weight: 500; color: var(--text-normal); cursor: pointer; }
.vanta-clone select.vanta-input { text-transform: none; }
.vanta-clone-err { color: var(--text-danger, #f23f43); font-size: 13px; min-height: 18px; }
.vanta-clone-menu { position: fixed; z-index: 10000; padding: 6px; border-radius: 8px; background: var(--background-floating, #111214); box-shadow: 0 8px 24px rgba(0,0,0,.4); }
.vanta-clone-menu button { all: unset; display: block; padding: 6px 10px; border-radius: 4px; cursor: pointer; color: var(--interactive-normal, #dbdee1); font-size: 14px; }
.vanta-clone-menu button:hover { background: var(--brand-500, #5865f2); color: #fff; }`);
        this.onContext = (e: MouseEvent) => {
            let t = this.targetAt(e.target as Element);
            for (const el of t ? [] : document.elementsFromPoint(e.clientX, e.clientY).slice(0, 6)) { t = this.targetAt(el); if (t) break; }
            if (!t) return;
            if (t.kind === "emoji") this.addMenuItem("Clone emoji", () => this.cloneEmoji(t.emoji), e.clientX, e.clientY);
            else if (t.kind === "sticker") this.addMenuItem("Clone sticker", () => this.cloneSticker(t.sticker), e.clientX, e.clientY);
            else this.addMenuItem("Clone server", () => this.cloneServer(t.guildId), e.clientX, e.clientY);
        };
        document.addEventListener("contextmenu", this.onContext, true);
    },
    stop() {
        document.removeEventListener("contextmenu", this.onContext, true);
        this.cleanupMenu?.();
        this.menuEl?.remove();
        this.css?.remove();
    },
});
