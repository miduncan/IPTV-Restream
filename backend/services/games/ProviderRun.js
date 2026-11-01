const REQUEST_BUDGET = 6;
class ProviderRun {
    constructor({ now = () => Date.now(), requestBudget = REQUEST_BUDGET, timeoutMs = 300000 } = {}) {
        this.now = now;
        this.startedAt = now();
        this.controller = new AbortController();
        this.signal = this.controller.signal;
        this.cancelled = false;
        this.progress = { phase: 'sports', requestsUsed: 0, requestBudget, decodedBytes: 0, programmesParsed: 0, programmesKept: 0 };
        this.timeout = setTimeout(() => this.controller.abort(new Error('Matching time limit exceeded')), timeoutMs);
        this.timeout.unref?.();
    }
    status() { return { ...this.progress, elapsedMs: Math.max(0, this.now() - this.startedAt) }; }
    phase(phase) { this.signal.throwIfAborted(); this.progress.phase = phase; }
    cancel() { this.cancelled = true; this.progress.phase = 'cancelling'; this.controller.abort(new DOMException('Matching cancelled', 'AbortError')); }
    close() { clearTimeout(this.timeout); if (!this.signal.aborted) this.controller.abort(new Error('Matching finished')); }
    async wait(promise) {
        this.signal.throwIfAborted();
        let listener;
        const interrupted = new Promise((_, reject) => { listener = () => reject(this.signal.reason); this.signal.addEventListener('abort', listener, { once: true }); });
        try { return await Promise.race([promise, interrupted]); }
        finally { this.signal.removeEventListener('abort', listener); }
    }
    async fetch(url) {
        let current = new URL(url);
        for (let redirects = 0; ; redirects += 1) {
            this.signal.throwIfAborted();
            if (this.progress.requestsUsed >= this.progress.requestBudget) throw new Error('Provider request budget exhausted');
            if (!['http:', 'https:'].includes(current.protocol)) throw new Error('Unsupported provider redirect');
            this.progress.requestsUsed += 1;
            let response;
            try { response = await fetch(current, { signal: this.signal, redirect: 'manual' }); }
            catch { this.signal.throwIfAborted(); throw new Error('Provider request failed'); }
            if (![301, 302, 303, 307, 308].includes(response.status)) return response;
            await response.body?.cancel();
            const location = response.headers.get('location');
            if (!location || redirects >= 3) throw new Error('Provider redirect limit exceeded');
            current = new URL(location, current);
        }
    }
    async fetchJson(url) {
        const response = await this.fetch(url);
        if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}`);
        try { return await this.wait(response.json()); }
        catch { this.signal.throwIfAborted(); throw new Error('Invalid provider response'); }
    }
}
module.exports = { ProviderRun, REQUEST_BUDGET };
