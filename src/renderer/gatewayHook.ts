/*
 * Keeps Discord from asking its servers to hide channels you can't see (HiddenChannels' "Show their real names").
 *
 * Discord's app says, in the first message on its connection (IDENTIFY), which features it supports, as a number
 * called capabilities. One bit of it (1 << 15) means "blank out channels I can't see": with it, hidden channels
 * arrive named "___hidden___" with their details removed. This clears that bit in that first message before it
 * leaves the PC. Installed before Discord's own code runs, so even its very first connection gets real names, with
 * no reconnect. (The same thing Vencord's ShowHiddenChannels does by switching off the experiment behind it.)
 *
 * The connection uses Discord's compact binary format (ETF); the capabilities entry there is the bytes of
 * "capabilities" followed by an integer: 97 + 1 byte, or 98 + 4 bytes big-endian.
 */
import { settings } from "./core/settings";

export const OBFUSCATION_CAPABILITY = 1 << 15;
const KEY = new TextEncoder().encode("capabilities");

const wanted = () => {
    const p = settings.plugins?.HiddenChannels;
    return !!p?.enabled && p.options?.realNames !== false;
};

function indexOf(hay: Uint8Array, needle: Uint8Array, from = 0) {
    outer: for (let i = from; i <= hay.length - needle.length; i++) {
        for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
        return i;
    }
    return -1;
}

/** Clears the hiding bit in an ETF-encoded IDENTIFY. Returns true if it changed something. Edits in place. */
export function stripEtf(bytes: Uint8Array): boolean {
    const at = indexOf(bytes, KEY);
    if (at < 0) return false;
    const v = at + KEY.length;
    if (bytes[v] === 98 && v + 4 < bytes.length) { // INTEGER_EXT
        const view = new DataView(bytes.buffer, bytes.byteOffset + v + 1, 4);
        const n = view.getInt32(0);
        if (!(n & OBFUSCATION_CAPABILITY)) return false;
        view.setInt32(0, n & ~OBFUSCATION_CAPABILITY);
        return true;
    }
    return false; // SMALL_INTEGER_EXT (97) can't hold bit 15, so it's never set there
}

/** Same for the text (JSON) form of the connection, used by some Discord builds */
export function stripJson(text: string): string {
    if (!text.includes("\"capabilities\"")) return text;
    try {
        const msg = JSON.parse(text);
        if (msg?.op !== 2 || typeof msg.d?.capabilities !== "number" || !(msg.d.capabilities & OBFUSCATION_CAPABILITY)) return text;
        msg.d.capabilities &= ~OBFUSCATION_CAPABILITY;
        return JSON.stringify(msg);
    } catch { return text; }
}

export function installGatewayHook() {
    const proto = WebSocket.prototype;
    const send = proto.send;
    proto.send = function (this: WebSocket, data: any) {
        try {
            if (wanted() && /gateway[\w.-]*\.discord\.gg/.test(this.url)) {
                if (typeof data === "string") data = stripJson(data);
                else if (data instanceof ArrayBuffer) stripEtf(new Uint8Array(data));
                else if (ArrayBuffer.isView(data)) stripEtf(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
            }
        } catch { /* never break Discord's connection */ }
        return send.call(this, data);
    };
}
