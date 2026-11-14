// Tests for the logic that broke before. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { compareVersions } from "../src/main/util";
import { fixClasses } from "../src/renderer/themeFixer";
import { isDiscordApi } from "../src/renderer/core/discord";
import { rank } from "../src/renderer/smartSearch";

test("versions compare as numbers (0.5.10 is newer than 0.5.9)", () => {
    assert.equal(compareVersions("0.5.10", "0.5.9"), 1);
    assert.equal(compareVersions("v0.6.0", "0.5.10"), 1);
    assert.equal(compareVersions("0.5.9", "0.5.9"), 0);
    assert.equal(compareVersions("0.5.8", "v0.5.9"), -1);
});

test("Discord's API client is told apart from the web-request library", () => {
    const fn = () => { };
    const discordApi = { get: fn, post: fn, put: fn, patch: fn, del: fn };
    const superagent = { Request: fn, getXHR: fn, get: fn, post: fn, put: fn, patch: fn, del: fn, agent: fn };
    assert.equal(isDiscordApi(discordApi), true);
    assert.equal(isDiscordApi(superagent), false, "the generic library sent requests to the website, not the API");
    assert.equal(isDiscordApi(null), false);
});

test("theme fixer only rewrites retired dash-style classes", () => {
    const known = { full: new Set(["title_3zSH5d", "icon_abc123"]), names: new Set(["title", "icon", "wrapper"]) };
    const css = `.title-3FQ39e { color: red } .title_3zSH5d { color: blue } .icon_Zz9Yy8 { x: 1 } .theme-dark { y: 2 } .app-mount { z: 3 }
.wrapper-1x2Y3z:hover { a: b } .bg { background: url("img/a-Bc12De.png") }`;
    const { css: out, fixed } = fixClasses(css, known);
    assert.equal(fixed, 2);
    assert.ok(out.includes(':is([class^="title_"],[class*=" title_"])'), "old dash class rewritten to a prefix match");
    assert.ok(out.includes(".title_3zSH5d"), "current classes are never touched");
    assert.ok(out.includes(".icon_Zz9Yy8"), "unknown current-style classes are left alone (they may load later)");
    assert.ok(out.includes(".theme-dark") && out.includes(".app-mount"), "ordinary words aren't treated as hashes");
    assert.ok(out.includes('url("img/a-Bc12De.png")'), "urls are left alone");
});

test("smart search finds plugins by what they do", () => {
    const p = (name: string, description: string, category = "Chat") => ({ name, description, category, options: {} }) as any;
    const list = [
        p("MessageLogger", "Keeps deleted messages in chat and shows edit history."),
        p("CopyMessageLink", "Copies a link to a message."),
        p("HideStatuses", "Hides custom statuses and bios in member lists.", "Appearance"),
        p("Translate", "Translates messages."),
    ];
    assert.equal(rank(list, "see who deleted a message")[0]?.name, "MessageLogger");
    assert.equal(rank(list, "hide people's bios")[0]?.name, "HideStatuses");
});

// HiddenChannels' real names: the hiding bit is cleared from Discord's first connection message
import { stripEtf, stripJson, OBFUSCATION_CAPABILITY } from "../src/renderer/gatewayHook";
test("the channel-hiding capability is cleared from IDENTIFY", () => {
    // ETF: ...<key "capabilities"><INTEGER_EXT 98><int32 BE>...
    const key = new TextEncoder().encode("capabilities");
    const mk = (n: number) => { const b = new Uint8Array(3 + key.length + 5 + 3); b.set([131, 116, 0], 0); b.set(key, 3); b[3 + key.length] = 98; new DataView(b.buffer).setInt32(4 + key.length, n); return b; };
    const read = (b: Uint8Array) => new DataView(b.buffer).getInt32(4 + key.length);
    const on = mk(1767421), off = mk(1734653);
    assert.equal(stripEtf(on), true);
    assert.equal(read(on), 1734653);
    assert.equal(1767421 & ~OBFUSCATION_CAPABILITY, 1734653);
    assert.equal(stripEtf(off), false, "already off: untouched");
    assert.equal(read(off), 1734653);
    assert.equal(stripEtf(new TextEncoder().encode("heartbeat")), false, "other messages untouched");
    // JSON form
    assert.equal(JSON.parse(stripJson(JSON.stringify({ op: 2, d: { capabilities: 1767421, token: "t" } }))).d.capabilities, 1734653);
    assert.equal(stripJson('{"op":1,"d":5}'), '{"op":1,"d":5}');
});
