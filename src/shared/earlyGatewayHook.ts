// HiddenChannels' real names, installed by the preload before Discord's page code runs. See renderer/gatewayHook.ts.
/**
 * The same hook as a self-contained function (no imports or outside names), so the preload can run it in Discord's
 * page before anything else: Discord's fast startup connection sends its first message about 3 seconds in, before
 * Vanta's main code has loaded. Marks itself on window so the later copy below doesn't install twice.
 */
export function earlyGatewayHook(enabled: boolean) {
    const w = window as any;
    if (w.__vantaGatewayHook) return;
    w.__vantaGatewayHook = { at: performance.now(), stripped: 0, enabled };
    if (!enabled) return;
    const BIT = 1 << 15;
    const key = new TextEncoder().encode("capabilities");
    const strip = (b: Uint8Array) => {
        outer: for (let i = 0; i <= b.length - key.length - 5; i++) {
            for (let j = 0; j < key.length; j++) if (b[i + j] !== key[j]) continue outer;
            const v = i + key.length;
            if (b[v] !== 98) return;
            const view = new DataView(b.buffer, b.byteOffset + v + 1, 4);
            const n = view.getInt32(0);
            if (n & BIT) { view.setInt32(0, n & ~BIT); w.__vantaGatewayHook.stripped++; }
            return;
        }
    };
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (this: WebSocket, data: any) {
        try {
            if (/gateway[\w.-]*\.discord\.gg/.test(this.url)) {
                if (typeof data === "string" && data.includes("\"capabilities\"")) {
                    const msg = JSON.parse(data);
                    if (msg?.op === 2 && typeof msg.d?.capabilities === "number" && msg.d.capabilities & BIT) { msg.d.capabilities &= ~BIT; data = JSON.stringify(msg); w.__vantaGatewayHook.stripped++; }
                } else if (data instanceof ArrayBuffer) strip(new Uint8Array(data));
                else if (ArrayBuffer.isView(data)) strip(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
            }
        } catch { /* never break Discord's connection */ }
        return send.call(this, data);
    };
}

