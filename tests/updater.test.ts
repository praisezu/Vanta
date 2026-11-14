// The updater goes straight to the newest release, whatever order GitHub lists them in. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { updaterCheck } from "../src/main/updater";

const release = (tag: string, body: string, asset = true) => ({
    tag_name: tag, name: tag, body, html_url: `https://github.com/x/releases/${tag}`, draft: false, prerelease: false,
    assets: asset ? [{ name: "vanta.tar.gz", browser_download_url: `https://example.invalid/${tag}/vanta.tar.gz` }] : [],
});

test("an install a few versions behind jumps to the newest, with notes for each version skipped", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vanta-upd-")); // not a git checkout: release mode
    const list = [
        release("v0.6.8.2", "Vanta 0.6.8.2\n\n- renamed"),
        release("v0.6.8.3", "Vanta 0.6.8.3\n\n- not greyed out"),
        release("v0.6.8", "Vanta 0.6.8\n\n- big one"),
        release("v0.6.9", "Vanta 0.6.9\n\n- not built yet", false), // no update file yet: ignored
        release("v0.6.8.1", "Vanta 0.6.8.1\n\n- roles fixed"),
    ];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify(list), { status: 200 })) as typeof fetch;
    try {
        const r = await updaterCheck(root, "0.6.8");
        assert.equal(r.release?.tag, "v0.6.8.3");
        const notes = r.release!.notes;
        assert.ok(notes.includes("roles fixed") && notes.includes("renamed") && notes.includes("not greyed out"), notes);
        assert.ok(!notes.includes("big one"), "the version already installed isn't repeated");
        assert.ok(notes.indexOf("0.6.8.3") < notes.indexOf("0.6.8.1"), "newest first");

        assert.equal((await updaterCheck(root, "0.6.8.3")).release, null, "up to date: nothing to do");
    } finally {
        globalThis.fetch = realFetch;
        fs.rmSync(root, { recursive: true, force: true });
    }
});
