/*
 * Lets themes load their CSS, fonts and images from other websites.
 *
 * Discord's Content-Security-Policy blocks stylesheets from other origins, so BetterDiscord-style
 * themes that `@import url(https://…)` their real CSS silently load nothing. We relax only the
 * style/font/image/media directives. script-src and everything else stay exactly as Discord sent them.
 *
 * Electron allows one onHeadersReceived listener per session; later calls replace earlier ones.
 * We register first and wrap whatever Discord (or another mod) registers after us, so theirs
 * still runs and ours post-processes its result.
 */
import { session, type OnHeadersReceivedListenerDetails, type HeadersReceivedResponse } from "electron";

type Listener = (details: OnHeadersReceivedListenerDetails, callback: (response: HeadersReceivedResponse) => void) => void;

const RELAX: Record<string, string> = {
    "style-src": "* 'unsafe-inline' data: blob:",
    "style-src-elem": "* 'unsafe-inline' data: blob:",
    "style-src-attr": "* 'unsafe-inline'",
    "font-src": "* data: blob:",
    "img-src": "* data: blob:",
    "media-src": "* data: blob:",
};

export function relaxPolicy(policy: string) {
    const directives = policy.split(";").map(d => d.trim()).filter(Boolean);
    const seen = new Set<string>();
    const out = directives.map(d => {
        const name = d.split(/\s+/)[0].toLowerCase();
        seen.add(name);
        return RELAX[name] ? `${name} ${RELAX[name]}` : d;
    });
    // If a directive wasn't present it falls back to default-src; add explicit relaxed ones.
    for (const [name, value] of Object.entries(RELAX)) if (!seen.has(name)) out.push(`${name} ${value}`);
    return out.join("; ");
}

const isCsp = (key: string) => /^content-security-policy(-report-only)?$/i.test(key);

/** Relaxes the CSP headers in place. Returns false (and changes nothing) when there's no CSP header. */
function relaxHeaders(headers: Record<string, string[] | string> | undefined) {
    if (!headers) return false;
    let found = false;
    for (const key of Object.keys(headers)) {
        if (!isCsp(key)) continue;
        found = true;
        const value = headers[key];
        headers[key] = Array.isArray(value) ? value.map(relaxPolicy) : relaxPolicy(String(value));
    }
    return found;
}

/** Simple Electron URL-pattern matcher ("*://*.discord.com/*" style) for wrapped listeners' filters. */
function matches(url: string, patterns?: string[]) {
    if (!patterns?.length) return true;
    return patterns.some(p => new RegExp("^" + p.split("*").map(s => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$").test(url));
}

export function installCspPatch() {
    const wr = session.defaultSession.webRequest;
    let wrapped: { listener: Listener; urls?: string[] } | null = null;

    const ours: Listener = (details, callback) => {
        // Only responses that carry a CSP (pages) are changed. Everything else, videos and their partial ("range")
        // downloads included, goes through exactly as Discord's servers sent it: rewriting media responses' headers
        // can make videos fail to play.
        const finish = (response: HeadersReceivedResponse = {}) => {
            if (response.cancel) return callback(response);
            if (response.responseHeaders) {
                relaxHeaders(response.responseHeaders as any);
                return callback(response);
            }
            const copy = details.responseHeaders ? { ...details.responseHeaders } : undefined;
            if (relaxHeaders(copy as any)) return callback({ ...response, responseHeaders: copy as any });
            callback(response); // nothing to relax: untouched
        };
        if (wrapped && matches(details.url, wrapped.urls)) {
            try { wrapped.listener(details, finish); } catch (e) { console.error("[Vanta] wrapped header listener threw", e); finish(); }
        } else finish();
    };

    const original = wr.onHeadersReceived.bind(wr) as (...a: any[]) => void;
    original(ours);
    // Anyone registering later gets composed with ours instead of replacing it.
    (wr as any).onHeadersReceived = (filterOrListener: any, maybeListener?: any) => {
        const listener = typeof filterOrListener === "function" ? filterOrListener : maybeListener;
        const urls = typeof filterOrListener === "function" ? undefined : filterOrListener?.urls;
        wrapped = listener ? { listener, urls } : null;
    };
}
