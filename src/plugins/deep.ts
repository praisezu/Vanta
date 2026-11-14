// Plugins that read Discord's stores more deeply.
import { definePlugin, every, common, webpack, patcher, onFlux, watchElements, managedStyle, messageFromElement, storage, ui, h } from "@api";

const VIEW_CHANNEL = 1n << 10n;
/**
 * Discord's channel hiding (its "2026-02-private-channel-hiding" experiment): when the app connects with this
 * capability bit, Discord's servers send channels you can't see as "___hidden___" with their details blanked.
 * The app saves the experiment's answer under FLAG_KEY so its fast startup connection can use it too.
 */
const OBFUSCATION_CAPABILITY = 1 << 15;
const OBFUSCATED_CHANNEL = 1 << 17;
const FLAG_KEY = "private_channel_obfuscation";
const IDENTIFY = 2;
const userName = (u: any) => u?.globalName || u?.global_name || u?.username || "Unknown";

/* ---------------------------------------------------------- platform icons */
const PLATFORM_ICONS: Record<string, string> = {
    desktop: "M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-6v2h3v2H7v-2h3v-2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm0 2v9h16V6H4Z",
    mobile: "M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm0 2v14h8V4H8Zm3 15h2v1h-2v-1Z",
    web: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm6.9 9h-3a15 15 0 0 0-1.4-5.7A8 8 0 0 1 18.9 11ZM12 4c.9 1.2 1.7 3.7 1.9 7h-3.8c.2-3.3 1-5.8 1.9-7ZM9.5 5.3A15 15 0 0 0 8.1 11h-3a8 8 0 0 1 4.4-5.7ZM5.1 13h3a15 15 0 0 0 1.4 5.7A8 8 0 0 1 5.1 13ZM12 20c-.9-1.2-1.7-3.7-1.9-7h3.8c-.2 3.3-1 5.8-1.9 7Zm2.5-1.3a15 15 0 0 0 1.4-5.7h3a8 8 0 0 1-4.4 5.7Z",
};
const STATUS_COLOR: Record<string, string> = {
    online: "var(--status-positive, #3ba55c)", idle: "var(--status-warning, #f0b232)", dnd: "var(--status-danger, #e5484d)",
};

export default [
    definePlugin({
        name: "PlatformIndicators",
        description: "Shows whether people are on desktop, phone or web, next to their names in chat, the member list and DMs.",
        authors: ["Vanta"], category: "Utility",
        needsWebpack: true,
        options: {
            chat: { type: "boolean", default: true, label: "In chat (message headers)" },
            members: { type: "boolean", default: true, label: "In the member list" },
            dms: { type: "boolean", default: true, label: "In the DM list" },
        },
        clientStatus(userId: string): Record<string, string> {
            const P = common.PresenceStore;
            return P?.getState?.()?.clientStatuses?.[userId] ?? P?.getClientStatus?.(userId) ?? {};
        },
        render(host: HTMLElement, userId: string) {
            let box = host.querySelector<HTMLElement>(":scope > .vanta-platforms");
            const st = this.clientStatus(userId);
            const entries = Object.entries(st).filter(([k, v]) => PLATFORM_ICONS[k] && v && v !== "offline");
            if (!entries.length) { box?.remove(); return; }
            if (!box) { box = document.createElement("span"); box.className = "vanta-platforms"; host.append(box); }
            box.dataset.userId = userId;
            box.replaceChildren(...entries.map(([platform, status]) => {
                const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
                svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("width", "14"); svg.setAttribute("height", "14");
                const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
                p.setAttribute("d", PLATFORM_ICONS[platform]); p.setAttribute("fill", STATUS_COLOR[status] ?? "currentColor"); p.setAttribute("fill-rule", "evenodd");
                svg.append(p);
                const s = document.createElement("span");
                s.title = `${platform[0].toUpperCase() + platform.slice(1)}: ${status === "dnd" ? "Do Not Disturb" : status}`;
                s.append(svg);
                return s;
            }));
        },
        start() {
            this.style = managedStyle("vanta-platforms");
            this.style.set(`.vanta-platforms { display:inline-flex; gap:2px; margin-left:6px; vertical-align:middle; align-items:center; }
.vanta-platforms span { display:inline-flex; }`);
            const unwatch: (() => void)[] = [];
            if (this.settings.chat) unwatch.push(watchElements('[id^="message-username-"]', el => {
                const id = messageFromElement(el)?.author?.id;
                if (id) this.render(el, id);
            }));
            const avatarId = (el: Element) => el.querySelector<HTMLImageElement>('img[src*="/avatars/"]')?.src.match(/\/avatars\/(\d+)\//)?.[1];
            if (this.settings.members) unwatch.push(watchElements('[class*="membersWrap_"] [class*="member_"]', el => {
                const id = avatarId(el);
                const name = el.querySelector<HTMLElement>('[class*="name_"]') ?? el;
                if (id) this.render(name, id);
            }));
            if (this.settings.dms) unwatch.push(watchElements('[class*="privateChannels_"] a[href^="/channels/@me/"]', el => {
                const ch = common.ChannelStore?.getChannel?.(el.getAttribute("href")!.split("/").pop());
                const id = ch?.recipients?.length === 1 ? ch.recipients[0] : null;
                const name = el.querySelector<HTMLElement>('[class*="name_"]') ?? el;
                if (id) this.render(name, id);
            }));
            this.unwatch = unwatch;
            let t: any;
            this.off = onFlux("PRESENCE_UPDATES", () => {
                clearTimeout(t);
                t = setTimeout(() => document.querySelectorAll<HTMLElement>(".vanta-platforms").forEach(b => this.render(b.parentElement!, b.dataset.userId!)), 1000);
            });
        },
        stop() { this.unwatch?.forEach((u: () => void) => u()); this.off?.(); this.style?.remove(); document.querySelectorAll(".vanta-platforms").forEach(e => e.remove()); },
    }),

    definePlugin({
        name: "HiddenChannels",
        description: "Shows the channels and categories in a server that you can't see, with their names and topics (you still can't read their messages). Turns off Discord's channel hiding, the way Vencord's ShowHiddenChannels does.",
        authors: ["Vanta"], category: "Utility",
        needsWebpack: true,
        options: {
            realNames: { type: "boolean", default: true, label: "Show their real names", description: "Asks Discord not to blank them out (it reconnects once, never during a voice call). Off: they show as \"Hidden text channel 1\" and so on." },
        },

        /** Is Discord blanking hidden channels in this session? */
        obfuscatedNow() {
            for (const gid of Object.keys(common.GuildStore?.getGuilds?.() ?? {})) {
                for (const c of Object.values<any>(common.ChannelStore?.getMutableGuildChannelsForGuild?.(gid) ?? {})) {
                    if (c.name === "___hidden___" || ((c.flags ?? c.flags_ ?? 0) & OBFUSCATED_CHANNEL)) return true;
                }
            }
            return false;
        },

        /** Connect without the hiding capability, and keep Discord from remembering it for the next start */
        unhide() {
            const offs: (() => void)[] = [];
            // The saved flag the fast startup connection reads
            const store = webpack.find((m: any) => typeof m?.w?.getAfterRefresh === "function" && typeof m?.w?.setRaw === "function")?.w;
            if (store) {
                try { store.remove(FLAG_KEY); } catch { }
                const set = store.set;
                store.set = function (key: string, ...rest: any[]) { return key === FLAG_KEY ? undefined : set.call(this, key, ...rest); };
                offs.push(() => { if (store.set !== set) store.set = set; });
            }
            // Every (re)connection from now on
            const sock = webpack.findStore("GatewayConnectionStore")?.getSocket?.();
            if (sock && typeof sock.send === "function") {
                const send = sock.send;
                sock.send = (op: number, payload: any, ...rest: any[]) => {
                    if (op === IDENTIFY && payload && typeof payload.capabilities === "number") {
                        payload = { ...payload, capabilities: payload.capabilities & ~OBFUSCATION_CAPABILITY };
                        // The one reconnect that swaps blanked channels for real ones: ask for every server in full
                        if (this.fullResync) { this.fullResync = false; payload.client_state = { ...payload.client_state, guild_versions: {} }; }
                    }
                    return send(op, payload, ...rest);
                };
                offs.push(() => { if (sock.send !== send) sock.send = send; });
            }
            this.undoUnhide = () => offs.forEach(f => f());
            // This session already came in blanked: reconnect once (Discord's normal reconnect, like after a network
            // blip), but never in the middle of a voice call
            this.resyncTimer = setInterval(() => {
                if (this.resynced || !this.obfuscatedNow()) { clearInterval(this.resyncTimer); return; }
                if (common.SelectedChannelStore?.getVoiceChannelId?.()) return;
                const s = webpack.findStore("GatewayConnectionStore")?.getSocket?.();
                if (!s?.isSessionEstablished?.()) return;
                this.resynced = true;
                this.fullResync = true;
                s.close();
            }, 5000);
        },
        /** Channels and categories your roles can't see, in the order they appear */
        hidden(guildId: string) {
            const all = common.ChannelStore?.getMutableGuildChannelsForGuild?.(guildId) ?? {};
            return Object.values<any>(all)
                .filter(c => [0, 2, 4, 5, 13, 15, 16].includes(c.type) && !this.Perms.can(VIEW_CHANNEL, c))
                .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
        },
        open(guildId: string) {
            const list = this.hidden(guildId);
            const all = common.ChannelStore?.getMutableGuildChannelsForGuild?.(guildId) ?? {};
            const kind: Record<number, string> = { 0: "text channel", 2: "voice channel", 4: "category", 5: "announcement channel", 13: "stage", 15: "forum", 16: "media channel" };
            const icon: Record<number, string> = { 0: "#", 2: "🔊", 4: "📁", 5: "📢", 13: "🎙", 15: "💬", 16: "🖼" };
            const realName = (c: any) => c?.name && c.name !== "___hidden___" ? c.name : null;
            // Grouped by category: visible categories by name, hidden ones numbered
            let hiddenCats = 0;
            const catLabel = new Map<string, string>();
            for (const c of list.filter(c => c.type === 4)) { hiddenCats++; catLabel.set(c.id, realName(c) ?? `Hidden category ${hiddenCats}`); }
            const groups = new Map<string, any[]>();
            for (const c of list.filter(c => c.type !== 4)) {
                const key = c.parent_id ?? "";
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key)!.push(c);
            }
            for (const cat of list.filter(c => c.type === 4)) if (!groups.has(cat.id)) groups.set(cat.id, []);
            const counter: Record<number, number> = {};
            const sections = [...groups.entries()]
                .sort(([a], [b]) => (all[a]?.position ?? -1) - (all[b]?.position ?? -1))
                .map(([catId, chans]) => {
                    const hiddenCat = !!catId && catLabel.has(catId);
                    const title = !catId ? "No category" : catLabel.get(catId) ?? realName(all[catId]) ?? "A category";
                    return h("div", { class: "vanta-hidden-group" },
                        h("div", { class: "vanta-hidden-cat" }, hiddenCat ? "🔒 " + title : title),
                        chans.length ? ui.card({ class: "vanta-rows" }, chans.map(c => {
                            counter[c.type] = (counter[c.type] ?? 0) + 1;
                            return ui.row({ title: `${icon[c.type] ?? "#"} ${realName(c) ?? `Hidden ${kind[c.type] ?? "channel"} ${counter[c.type]}`}`, description: realName(c) && c.topic ? c.topic : null });
                        })) : h("div", { class: "vanta-row-desc" }, "Nothing else hidden in here."));
                });
            const channels = list.filter(c => c.type !== 4).length;
            ui.modal({
                title: `Hidden in this server: ${channels} channel${channels === 1 ? "" : "s"}${hiddenCats ? `, ${hiddenCats} categor${hiddenCats === 1 ? "y" : "ies"}` : ""}`,
                body: [
                    this.obfuscatedNow()
                        ? ui.note("warn", this.settings.realNames
                            ? (common.SelectedChannelStore?.getVoiceChannelId?.() ? "Real names load after a quick reconnect once you leave your voice call." : "Loading the real names… (a quick reconnect)")
                            : "Discord is blanking these. Turn on \"Show their real names\" in this plugin's settings to see them.")
                        : null,
                    h("div", { class: "vanta-hidden-list" }, sections),
                ],
                buttons: [{ text: "Close", variant: "primary" }],
            });
        },
        onSettingChange(key: string) { if (key === "realNames") { this.stop(); this.start(); } },
        start() {
            this.Perms = webpack.findStore("PermissionStore");
            if (!this.Perms?.can) throw new Error("Discord's permission store wasn't found");
            if (this.settings.realNames) this.unhide();
            this.style = managedStyle("vanta-hidden-channels");
            this.style.set(`.vanta-hidden-pill { all:unset; cursor:pointer; display:block; margin:8px 8px 12px; padding:6px 10px; border-radius:6px; font:600 12px var(--font-primary, sans-serif);
  color:var(--text-muted); background:var(--background-mod-subtle, rgba(150,150,160,.1)); text-align:center; }
.vanta-hidden-pill:hover { color:var(--text-default); background:var(--background-mod-normal, rgba(150,150,160,.16)); }
.vanta-hidden-list { display:flex; flex-direction:column; gap:14px; max-height:440px; overflow:auto; margin-top:12px; }
.vanta-hidden-cat { font-size:12px; font-weight:700; text-transform:uppercase; color:var(--text-muted); margin:0 0 6px 2px; }
.vanta-hidden-cat span { text-transform:none; font-weight:500; }`);
            this.timer = every(() => {
                const gid = common.SelectedGuildStore?.getGuildId?.();
                const nav = document.querySelector<HTMLElement>('nav[aria-label$="(server)"]');
                if (!gid || !nav) { this.pill?.remove(); return; }
                const n = this.hidden(gid).filter((c: any) => c.type !== 4).length;
                if (!n) { this.pill?.remove(); return; }
                this.pill ??= h("button", { class: "vanta-hidden-pill", type: "button", onclick: () => this.open(common.SelectedGuildStore.getGuildId()) });
                this.pill.textContent = `🔒 ${n} hidden channel${n === 1 ? "" : "s"}`;
                const scroller = nav.querySelector('[class*="scroller_"]') ?? nav;
                if (this.pill.parentElement !== scroller) scroller.append(this.pill);
            }, 1500);
        },
        stop() { clearInterval(this.timer); clearInterval(this.resyncTimer); this.undoUnhide?.(); this.undoUnhide = null; this.pill?.remove(); this.pill = null; this.style?.remove(); },
    }),

    definePlugin({
        name: "NoBlockedMessages",
        description: "Messages from people you've blocked disappear completely, instead of showing as \"blocked message\".",
        authors: ["Vanta"], category: "Chat",
        needsWebpack: true,
        options: { ignored: { type: "boolean", default: true, label: "Also hide people you've ignored" } },
        hide(authorId?: string) {
            const R = common.RelationshipStore;
            if (!authorId || !R) return false;
            return !!R.isBlocked?.(authorId) || (this.settings.ignored && !!R.isIgnored?.(authorId));
        },
        start() {
            const D = common.FluxDispatcher;
            this.unpatch = patcher.instead(D, "dispatch", (args: any[], original: (...a: any[]) => any) => {
                const a = args[0];
                try {
                    if (a?.type === "MESSAGE_CREATE" && this.hide(a.message?.author?.id)) return Promise.resolve();
                    if ((a?.type === "LOAD_MESSAGES_SUCCESS" || a?.type === "LOAD_MESSAGES_AROUND_SUCCESS") && Array.isArray(a.messages)) {
                        const kept = a.messages.filter((m: any) => !this.hide(m?.author?.id));
                        if (kept.length !== a.messages.length) return original({ ...a, messages: kept });
                    }
                } catch (e) { this.logger.error(e); }
                return original(...args);
            });
        },
        stop() { this.unpatch?.(); },
    }),

    definePlugin({
        name: "FriendsSince",
        description: "Shows when you became friends with someone on their profile.",
        authors: ["Vanta"], category: "Utility",
        needsWebpack: true,
        start() {
            this.style = managedStyle("vanta-friends-since");
            this.style.set(`.vanta-friends-since { margin:8px 0 0; font:500 12px var(--font-primary, sans-serif); color:var(--text-muted); }
.vanta-friends-since b { color:var(--text-default); font-weight:600; }`);
            this.unwatch = watchElements('[role="dialog"]', dialog => {
                // Profile popouts/modals show the user's avatar; find the user id from it
                setTimeout(() => {
                    if (dialog.querySelector(".vanta-friends-since")) return;
                    const id = dialog.querySelector<HTMLImageElement>('img[src*="/avatars/"]')?.src.match(/\/avatars\/(\d+)\//)?.[1];
                    const since = id && common.RelationshipStore?.getSince?.(id);
                    if (!since || common.RelationshipStore?.getRelationshipType?.(id) !== 1) return;
                    const date = new Date(since);
                    if (isNaN(+date)) return;
                    const line = h("div", { class: "vanta-friends-since" }, "Friends since ", h("b", {}, date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })));
                    const anchor = dialog.querySelector('[class*="memberSince"], [class*="userProfileInner"] section, [class*="body_"], [class*="scroller_"]') ?? dialog;
                    anchor.append(line);
                }, 150);
            });
        },
        stop() { this.unwatch?.(); this.style?.remove(); document.querySelectorAll(".vanta-friends-since").forEach(e => e.remove()); },
    }),

    definePlugin({
        name: "PinDMs",
        description: "Pin your favourite DMs: hover a DM and click the pin, and it stays in a row at the top of your DM list.",
        authors: ["Vanta"], category: "Utility",
        needsWebpack: true,
        pinned: [] as string[],
        save() { storage.set("PinDMs", this.pinned); this.renderRow(); this.syncButtons(); },
        toggle(id: string) {
            this.pinned = this.pinned.includes(id) ? this.pinned.filter((x: string) => x !== id) : [...this.pinned, id];
            this.save();
        },
        go(id: string) {
            const link = document.querySelector<HTMLElement>(`[class*="privateChannels_"] a[href="/channels/@me/${id}"]`);
            if (link) return link.click();
            this.transitionTo?.(`/channels/@me/${id}`);
        },
        renderRow() {
            const list = document.querySelector('[class*="privateChannels_"]');
            const header = list?.querySelector('[class*="privateChannelsHeaderContainer_"]');
            if (!list || !header || !this.pinned.length) { this.row?.remove(); return; }
            this.row ??= h("div", { class: "vanta-pins" });
            this.row.replaceChildren(...this.pinned.map((id: string) => {
                const ch = common.ChannelStore?.getChannel?.(id);
                if (!ch) return null;
                const user = ch.recipients?.length === 1 ? common.UserStore?.getUser?.(ch.recipients[0]) : null;
                const name = ch.name || (user ? userName(user) : "DM");
                const avatar = user?.getAvatarURL?.(undefined, 64) ?? (ch.icon ? `https://cdn.discordapp.com/channel-icons/${id}/${ch.icon}.png?size=64` : null);
                return h("button", { class: "vanta-pin", type: "button", title: name, onclick: () => this.go(id) },
                    avatar ? h("img", { src: avatar, alt: "" }) : h("span", {}, name.slice(0, 1).toUpperCase()));
            }).filter(Boolean) as Node[]);
            if (this.row.nextElementSibling !== header) header.before(this.row);
        },
        syncButtons() {
            document.querySelectorAll<HTMLElement>(".vanta-pin-toggle").forEach(b => {
                const on = this.pinned.includes(b.dataset.id!);
                b.textContent = "📌";
                b.classList.toggle("on", on);
                b.title = on ? "Unpin" : "Pin to top";
            });
        },
        async start() {
            this.pinned = (await storage.get<string[]>("PinDMs")) ?? [];
            // Discord's navigation function (found by the log message it prints)
            this.transitionTo = webpack.findByCode("transitionTo -");
            this.style = managedStyle("vanta-pindms");
            this.style.set(`.vanta-pins { display:flex; flex-wrap:wrap; gap:6px; padding:8px 10px 4px; }
.vanta-pin { all:unset; cursor:pointer; width:36px; height:36px; border-radius:50%; overflow:hidden; display:grid; place-items:center;
  background:var(--background-surface-high, #2b2d31); color:var(--text-default); font:700 14px var(--font-primary, sans-serif); box-shadow:0 0 0 2px transparent; transition:box-shadow .12s; }
.vanta-pin:hover, .vanta-pin:focus-visible { box-shadow:0 0 0 2px #8b5cf6; }
.vanta-pin img { width:100%; height:100%; object-fit:cover; }
.vanta-pin-wrap { position:relative; }
.vanta-pin-toggle { all:unset; cursor:pointer; position:absolute; right:30px; top:50%; transform:translateY(-50%); font-size:12px; opacity:0; filter:grayscale(1); z-index:2; }
.vanta-pin-wrap:hover .vanta-pin-toggle, .vanta-pin-toggle.on { opacity:.9; }
.vanta-pin-toggle.on { filter:none; }`);
            this.unwatch = watchElements('[class*="privateChannels_"] a[href^="/channels/@me/"]', a => {
                const id = a.getAttribute("href")!.split("/").pop()!;
                const wrap = a.parentElement;
                if (!wrap || wrap.querySelector(".vanta-pin-toggle")) return;
                wrap.classList.add("vanta-pin-wrap");
                const btn = h("button", { class: "vanta-pin-toggle", type: "button", "data-id": id, "aria-label": "Pin DM" });
                btn.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); this.toggle(id); });
                wrap.append(btn);
                this.syncButtons();
                this.renderRow();
            });
            this.timer = every(() => this.renderRow(), 3000); // the DM list re-renders when you navigate
            this.renderRow();
        },
        stop() {
            this.unwatch?.(); clearInterval(this.timer); this.style?.remove(); this.row?.remove(); this.row = null;
            document.querySelectorAll(".vanta-pin-toggle").forEach(e => e.remove());
            document.querySelectorAll(".vanta-pin-wrap").forEach(e => e.classList.remove("vanta-pin-wrap"));
        },
    }),
];
