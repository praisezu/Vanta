import { definePlugin, common, discord, onFlux, webpack, ui, cleanError } from "@api";

/** Member flag: this member finished the server's onboarding */
const COMPLETED_ONBOARDING = 1 << 1;

export default definePlugin({
    name: "SkipOnboarding",
    description: "Skips a server's onboarding questions when you join, so you go straight to the channels. Questions the server requires get their first answer (which can give you that answer's roles).",
    authors: ["Vanta"],
    category: "Utility",
    since: "0.6.8",
    needsWebpack: true,
    risky: "It finishes onboarding through Discord's API instead of you clicking through it, which the normal Discord app never does. Discord could see that as automation. Required questions are answered with their first option, which may give you roles or channels you didn't pick.",
    options: {
        notify: { type: "boolean", default: true, label: "Tell me when it skips", description: "A small message each time a server's onboarding is skipped." },
    },

    /** Finishes a server's onboarding: every question marked seen, required ones answered with their first option */
    async skip(guildId: string) {
        if (this.done.has(guildId)) return;
        this.done.add(guildId);
        const me = common.UserStore?.getCurrentUser?.()?.id;
        const member = webpack.findStore?.("GuildMemberStore")?.getMember?.(guildId, me);
        if (member && (member.flags & COMPLETED_ONBOARDING)) return;
        const api = discord.api();
        const ob = (await api.get({ url: `/guilds/${guildId}/onboarding` })).body;
        if (!ob?.enabled || !ob.prompts?.length) return;
        const now = Date.now();
        const responses: string[] = [];
        const promptsSeen: Record<string, number> = {};
        const responsesSeen: Record<string, number> = {};
        for (const p of ob.prompts) {
            promptsSeen[p.id] = now;
            for (const o of p.options ?? []) responsesSeen[o.id] = now;
            if (p.required && p.options?.length) responses.push(p.options[0].id);
        }
        await api.put({
            url: `/guilds/${guildId}/onboarding-responses`,
            body: { onboarding_responses: responses, onboarding_prompts_seen: promptsSeen, onboarding_responses_seen: responsesSeen },
        });
        const name = common.GuildStore?.getGuild?.(guildId)?.name ?? "this server";
        if (this.settings.notify) ui.toast(`Skipped onboarding in ${name}`, { type: "ok" });
        // If Discord is showing the onboarding screen, go to the server's channels instead
        if (location.pathname.startsWith(`/channels/${guildId}`) && /onboarding/i.test(location.pathname)) {
            const first = common.GuildChannelStore?.getDefaultChannel?.(guildId)?.id;
            if (first) discord.go(`/channels/${guildId}/${first}`);
        }
    },

    trySkip(guildId: string | undefined) {
        if (!guildId) return;
        const g = common.GuildStore?.getGuild?.(guildId);
        if (g && !(g.features?.has?.("GUILD_ONBOARDING") ?? [...(g.features ?? [])].includes("GUILD_ONBOARDING"))) return;
        this.skip(guildId).catch((e: unknown) => {
            this.done.delete(guildId);
            this.logger.warn("Couldn't skip onboarding", e);
            ui.toast("Couldn't skip onboarding: " + cleanError(e), { type: "danger" });
        });
    },

    start() {
        this.done = new Set<string>();
        // Joining a server, and opening one whose onboarding you haven't finished
        this.offs = [
            // Discord also sends GUILD_CREATE for servers you're already in (as they load): only act on fresh joins
            onFlux("GUILD_CREATE", (a: any) => {
                const joined = Date.parse(a.guild?.joined_at ?? a.guild?.joinedAt ?? "");
                if (joined && Date.now() - joined < 5 * 60_000) this.trySkip(a.guild?.id);
            }),
            onFlux("GUILD_JOIN", (a: any) => this.trySkip(a.guildId)),
            onFlux("CHANNEL_SELECT", (a: any) => { if (a.guildId && /onboarding/i.test(location.pathname)) this.trySkip(a.guildId); }),
        ];
        this.onNav = () => { const m = /^\/channels\/(\d+)\/onboarding/.exec(location.pathname); if (m) this.trySkip(m[1]); };
        this.navTimer = setInterval(this.onNav, 1500);
    },
    stop() {
        for (const off of this.offs ?? []) off();
        clearInterval(this.navTimer);
    },
});
