/* =============================================================================
 * betz_bootstrap.js — Secure environment/token bootstrap for the capture page.
 *
 * SINGLE functional implementation, shared by:
 *   - the browser (predict.html loads it as a classic <script src>), and
 *   - Node tests (require()).
 *
 * Security model (Milestone 1):
 *   1. Read ?k in memory only, then strip k & name from the URL immediately.
 *   2. NEVER trust the legacy global token (sh_token): ignore and delete it.
 *   3. Load betz-runtime.json and validate it.
 *   4. Perform a TOKEN-LESS handshake (receiver_info) and require an EXACT match
 *      of environment / competition_id / period_id / deployment_id.
 *   5. Only AFTER an exact match may a token be persisted (namespaced by
 *      deployment_id + competition_id) or a previously stored token recovered.
 *   6. On ANY failure: no token is persisted, no stored token is recovered or
 *      transmitted, and capture stays BLOCKED (fail-closed).
 * ========================================================================== */
(function (root, factory) {
    "use strict";
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.BetzBootstrap = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    var LEGACY_KEYS = ["sh_token", "sh_name"];
    var REQUIRED_RUNTIME_FIELDS = ["environment", "apps_script_url", "competition_id", "period_id", "deployment_id"];

    function safeStorage(storage, method, key, value) {
        try {
            if (method === "get") return storage.getItem(key) || "";
            if (method === "set") return storage.setItem(key, value);
            if (method === "remove") return storage.removeItem(key);
        } catch (error) {
            return "";
        }
        return "";
    }

    // Read ?k / ?name into memory and strip them from the URL right away.
    // If stripping cannot be completed, `sanitized` is false and the caller
    // must fail closed (URL_SANITIZATION_FAILED) — never persist/transmit.
    function readAndStripKey(locationHref, replaceState) {
        var url = new URL(locationHref);
        var token = url.searchParams.get("k") || "";
        var name = url.searchParams.get("name") || "";
        var sanitized = true;
        if (url.searchParams.has("k") || url.searchParams.has("name")) {
            url.searchParams.delete("k");
            url.searchParams.delete("name");
            try {
                if (typeof replaceState === "function") replaceState(url.toString());
                else sanitized = false;
            } catch (error) {
                sanitized = false;
            }
        }
        return { token: token, name: name, sanitized: sanitized };
    }

    // The legacy global token has unverifiable environment provenance: drop it.
    function purgeLegacyToken(storage) {
        LEGACY_KEYS.forEach(function (key) { safeStorage(storage, "remove", key); });
    }

    function validateRuntime(runtime) {
        if (!runtime || typeof runtime !== "object") return "RUNTIME_MISSING";
        for (var i = 0; i < REQUIRED_RUNTIME_FIELDS.length; i++) {
            var field = REQUIRED_RUNTIME_FIELDS[i];
            if (typeof runtime[field] !== "string" || !runtime[field]) return "RUNTIME_FIELD_INVALID:" + field;
        }
        return null;
    }

    // Exact-match handshake. Any divergence blocks before any token is used.
    function evaluateHandshake(runtime, info) {
        if (!info || info.ok !== true) return { ok: false, reason: "HANDSHAKE_UNAVAILABLE" };
        if (info.environment !== runtime.environment) return { ok: false, reason: "ENVIRONMENT_MISMATCH" };
        if (info.competition_id !== runtime.competition_id) return { ok: false, reason: "COMPETITION_MISMATCH" };
        if (info.deployment_id !== runtime.deployment_id) return { ok: false, reason: "DEPLOYMENT_MISMATCH" };
        var periods = Array.isArray(info.supported_periods) ? info.supported_periods : [];
        if (periods.indexOf(runtime.period_id) === -1) return { ok: false, reason: "PERIOD_UNSUPPORTED" };
        return { ok: true, reason: null };
    }

    function tokenStorageKey(runtime) {
        return "betz_token:" + runtime.deployment_id + ":" + runtime.competition_id;
    }

    function blocked(reason, incoming) {
        // Fail-closed: never persist or transmit a token on failure.
        return { status: "BLOCKED", reason: reason, token: "", display_name: incoming.name || "" };
    }

    // deps: { locationHref, replaceState, storage, loadRuntime(), fetchReceiverInfo(url) }
    function runBootstrap(deps) {
        var incoming = readAndStripKey(deps.locationHref, deps.replaceState);
        purgeLegacyToken(deps.storage);

        // Fail closed if the token could not be removed from the URL.
        if (incoming.sanitized === false) {
            return Promise.resolve(blocked("URL_SANITIZATION_FAILED", incoming));
        }

        return Promise.resolve()
            .then(function () { return deps.loadRuntime(); })
            .catch(function () { return null; })
            .then(function (runtime) {
                var runtimeError = validateRuntime(runtime);
                if (runtimeError) throw { blockReason: runtimeError };
                return Promise.resolve()
                    .then(function () { return deps.fetchReceiverInfo(runtime.apps_script_url); })
                    .catch(function () { return null; })
                    .then(function (info) {
                        var verdict = evaluateHandshake(runtime, info);
                        if (!verdict.ok) throw { blockReason: verdict.reason };

                        var key = tokenStorageKey(runtime);
                        var token = "";
                        if (incoming.token) {
                            safeStorage(deps.storage, "set", key, incoming.token);
                            token = incoming.token;
                        } else {
                            token = safeStorage(deps.storage, "get", key);
                        }
                        return {
                            status: token ? "READY" : "NEEDS_LINK",
                            reason: token ? null : "NO_STORED_TOKEN",
                            environment: runtime.environment,
                            competition_id: runtime.competition_id,
                            period_id: runtime.period_id,
                            apps_script_url: runtime.apps_script_url,
                            token: token,
                            display_name: incoming.name || "",
                            token_storage_key: key
                        };
                    });
            })
            .catch(function (error) {
                if (error && error.blockReason) return blocked(error.blockReason, incoming);
                return blocked("BOOTSTRAP_ERROR", incoming);
            });
    }

    return {
        readAndStripKey: readAndStripKey,
        purgeLegacyToken: purgeLegacyToken,
        validateRuntime: validateRuntime,
        evaluateHandshake: evaluateHandshake,
        tokenStorageKey: tokenStorageKey,
        runBootstrap: runBootstrap
    };
});
