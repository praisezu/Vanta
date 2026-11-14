import { definePlugin, common, onFlux, every, managedStyle, webpack } from "@api";

const STATUS_COLOR: Record<string, string> = { online: "#23a55a", idle: "#f0b232", dnd: "#f23f43", streaming: "#593695", offline: "#80848e", unknown: "#5865f2" };

/** A message's time in ms (Discord gives a moment object, a Date or a string) */
const msgTime = (m: any) => Number(m?.timestamp?.valueOf?.() ?? Date.parse(m?.timestamp)) || 0;

function ago(ms: number) {
    const m = Math.round(ms / 60000);
    return m < 1 ? "just now" : m === 1 ? "1 min ago" : `${m} min ago`;
}

export default definePlugin({
    name: "WhosHere",
    description: "Shows who's active in the channel you're in right now, under the message box: people typing, and people who just sent a message. Hover a face for their name. (Discord never shares who only has a channel open, so silent readers can't be shown.)",
    authors: ["Vanta"],
    category: "Chat",
    since: "0.6.8",
    needsWebpack: true,
    options: {
        minutes: { type: "number", default: 2, label: "Count people who sent a message in the last … minutes", description: "1 to 60. Lower means only people who are definitely here right now." },
        max: { type: "number", default: 8, label: "Most faces to show", description: "1 to 20." },
        offline: { type: "boolean", default: false, label: "Include people who are offline", description: "Off: only people online, idle or on Do Not Disturb." },
    },

    /** Who's around in a channel, typing first, then the most recent chatters */
    people(channelId: string) {
        const me = common.UserStore?.getCurrentUser?.()?.id;
        const now = Date.now();
        const windowMs = Math.max(1, Math.min(60, Number(this.settings.minutes) || 2)) * 60_000;
        const found = new Map<string, { id: string; typing: boolean; at: number }>();
        for (const id of Object.keys(common.TypingStore?.getTypingUsers?.(channelId) ?? {})) {
            if (id !== me) found.set(id, { id, typing: true, at: now });
        }
        const msgs = common.MessageStore?.getMessages?.(channelId);
        const list: any[] = msgs?._array ?? msgs?.toArray?.() ?? [];
        for (let i = list.length - 1; i >= 0; i--) {
            const m = list[i];
            const at = msgTime(m);
            if (now - at > windowMs) break;
            const id = m?.author?.id;
            if (!id || id === me || m.author.bot || found.has(id)) continue;
            found.set(id, { id, typing: false, at });
        }
        const out: { id: string; typing: boolean; at: number; status: string }[] = [];
        // In big servers Discord only loads statuses for some members: no status known isn't the same as offline
        const known = common.PresenceStore?.getState?.()?.statuses;
        for (const p of found.values()) {
            const status = known && !(p.id in known) ? "unknown" : common.PresenceStore?.getStatus?.(p.id) ?? "unknown";
            if (status === "offline" && !p.typing && !this.settings.offline) continue;
            out.push({ ...p, status });
        }
        return out.slice(0, Math.max(1, Math.min(20, Number(this.settings.max) || 8)));
    },

    render() {
        this.queued = false;
        const box = document.querySelector('[role="textbox"][data-slate-editor="true"]');
        const form = box?.closest("form") as HTMLElement | null;
        const channelId = common.SelectedChannelStore?.getChannelId?.();
        if (!form || !channelId) { this.el?.remove(); return; }
        if (!this.el) {
            this.el = document.createElement("div");
            this.el.className = "vanta-whos-here";
            this.el.setAttribute("aria-label", "Who's here");
        }
        if (this.el.parentElement !== form) {
            if (getComputedStyle(form).position === "static") form.style.position = "relative";
            form.append(this.el);
        }
        const guildId = common.ChannelStore?.getChannel?.(channelId)?.guild_id;
        const people = this.people(channelId);
        this.el.hidden = !people.length;
        const now = Date.now();
        this.cards.clear();
        this.el.replaceChildren(...people.map(p => {
            const u = common.UserStore?.getUser?.(p.id);
            const img = document.createElement("img");
            img.src = u?.getAvatarURL?.(guildId, 32) ?? "https://cdn.discordapp.com/embed/avatars/0.png";
            img.alt = "";
            const face = document.createElement("span");
            face.className = "vanta-whos-face" + (p.typing ? " typing" : "");
            face.style.setProperty("--ring", STATUS_COLOR[p.status] ?? STATUS_COLOR.offline);
            face.dataset.uid = p.id;
            // What the hover card shows
            const nick = guildId ? webpack.findStore?.("GuildMemberStore")?.getNick?.(guildId, p.id) : null;
            const status = p.status === "offline" ? "offline" : p.status === "idle" ? "idle" : p.status === "dnd" ? "do not disturb" : p.status === "online" ? "online" : "";
            this.cards.set(p.id, {
                avatar: u?.getAvatarURL?.(guildId, 64) ?? img.src,
                display: nick || u?.globalName || u?.username || "Someone",
                username: u ? (u.discriminator && u.discriminator !== "0" ? `${u.username}#${u.discriminator}` : `@${u.username}`) : "",
                doing: (p.typing ? "typing…" : "chatted " + ago(now - p.at)) + (status ? " · " + status : ""),
                ring: STATUS_COLOR[p.status] ?? STATUS_COLOR.offline,
            });
            face.setAttribute("aria-label", this.cards.get(p.id).display);
            face.append(img);
            return face;
        }));
        // Keep an open hover card pointing at the same person after a redraw
        if (this.hovered) {
            const again = this.el.querySelector(`[data-uid="${this.hovered}"]`);
            again ? this.showCard(again as HTMLElement) : this.hideCard();
        }
    },

    /** The hover card: profile picture, display name and @username */
    showCard(face: HTMLElement) {
        const info = this.cards.get(face.dataset.uid);
        if (!info) return;
        this.hovered = face.dataset.uid;
        if (!this.card) {
            this.card = document.createElement("div");
            this.card.className = "vanta-whos-card";
            document.body.append(this.card);
        }
        const img = document.createElement("img");
        img.src = info.avatar;
        img.alt = "";
        img.style.setProperty("--ring", info.ring);
        const text = document.createElement("div");
        const d = document.createElement("b"); d.textContent = info.display;
        const n = document.createElement("span"); n.textContent = info.username;
        const s = document.createElement("small"); s.textContent = info.doing;
        text.append(d, n, s);
        this.card.replaceChildren(img, text);
        this.card.hidden = false;
        const r = face.getBoundingClientRect();
        const w = this.card.offsetWidth;
        this.card.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + "px";
        this.card.style.top = (r.top - this.card.offsetHeight - 8) + "px";
    },
    hideCard() {
        this.hovered = null;
        if (this.card) this.card.hidden = true;
    },

    start() {
        this.css = managedStyle("vanta-whos-css");
        this.css.set(`
.vanta-whos-here { position: absolute; right: 16px; bottom: 1px; height: 22px; display: flex; align-items: center; gap: 3px; z-index: 1; }
.vanta-whos-here[hidden] { display: none; }
.vanta-whos-face { width: 18px; height: 18px; border-radius: 50%; box-shadow: 0 0 0 2px var(--ring); overflow: hidden; flex: none; cursor: default; }
.vanta-whos-face img { width: 100%; height: 100%; display: block; }
.vanta-whos-face.typing { animation: vanta-whos-pulse 1.2s ease-in-out infinite; }
.vanta-whos-card { position: fixed; z-index: 1000; display: flex; align-items: center; gap: 10px; padding: 8px 12px 8px 8px; border-radius: 8px; pointer-events: none;
  background: var(--background-floating, #111214); color: var(--text-normal, #dbdee1); box-shadow: 0 8px 16px rgba(0,0,0,.35); max-width: 280px; }
.vanta-whos-card[hidden] { display: none; }
.vanta-whos-card img { width: 36px; height: 36px; border-radius: 50%; box-shadow: 0 0 0 2px var(--ring); flex: none; }
.vanta-whos-card div { display: flex; flex-direction: column; min-width: 0; }
.vanta-whos-card b { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vanta-whos-card span { font-size: 12px; color: var(--text-muted, #949ba4); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vanta-whos-card small { font-size: 11px; color: var(--text-muted, #949ba4); margin-top: 2px; }
@keyframes vanta-whos-pulse { 50% { box-shadow: 0 0 0 3px var(--ring); transform: translateY(-1px); } }`);
        this.cards = new Map();
        this.onOver = (e: MouseEvent) => {
            const face = (e.target as Element)?.closest?.(".vanta-whos-face") as HTMLElement | null;
            if (face && this.el?.contains(face)) this.showCard(face);
            else if (this.hovered) this.hideCard();
        };
        document.addEventListener("mouseover", this.onOver, true);
        const soon = () => { if (!this.queued) { this.queued = true; requestAnimationFrame(() => this.render()); } };
        this.offs = ["TYPING_START", "TYPING_STOP", "MESSAGE_CREATE", "PRESENCE_UPDATES", "LOAD_MESSAGES_SUCCESS"].map(t => onFlux(t, soon));
        this.offs.push(onFlux("CHANNEL_SELECT", () => setTimeout(soon, 400))); // after Discord draws the new channel
        this.timer = every(soon, 15_000); // ages people out, and puts the bar back after Discord redraws the chat
        soon();
    },
    stop() {
        for (const off of this.offs ?? []) off();
        clearInterval(this.timer);
        document.removeEventListener("mouseover", this.onOver, true);
        this.el?.remove();
        this.el = null;
        this.card?.remove();
        this.card = null;
        this.css?.remove();
    },
});
