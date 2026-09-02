/* =============================================================================
 * social_groups_view.js — Grupos (Social Groups) view + private-receiver client.
 *
 * SINGLE functional implementation, shared by:
 *   - the browser (index.html loads it as a classic <script src>), and
 *   - Node tests (require()).
 *
 * This module owns ONLY pure, deterministic logic and dependency-injected
 * orchestration. It never touches the DOM, never opens a network connection and
 * never reads a global. The browser layer (index.html) provides the postMessage
 * transport and DOM; this module decides WHAT to send and HOW to project.
 *
 * Governance (social_groups_contract.md is the authority):
 *   - Ownership is resolved by the receiver from the personal capability; the
 *     client never chooses owner_user_id and never uses the public user_id
 *     (?u / state.player) as authentication.
 *   - The client filters the OFFICIAL leaderboard; it never recomputes points,
 *     runs a tie-break or invents an absent member.
 *   - Snapshots are local and carry no token, endpoint, receipt or request id.
 * ========================================================================== */
(function (root, factory) {
    "use strict";
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.SocialGroupsView = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    // --- Constants mirrored from the receiver (receiver remains the authority) --
    var NAME_MAX_CHARACTERS = 40;
    var MIN_MEMBERS = 2;
    var TOKEN_HEX_LENGTH = 64;
    var SHARE_PHRASE = "Ten la razón. ¡Cóbrasela a todos!";

    // The only actions this client may ever transmit. receiver_info is token-less;
    // the five operations are the contracted Social Group surface. Nothing else.
    var RECEIVER_INFO_ACTION = "receiver_info";
    var GROUP_ACTIONS = ["list_groups", "create_group", "rename_group", "replace_group_members", "delete_group"];
    var MUTATION_ACTIONS = ["create_group", "rename_group", "replace_group_members", "delete_group"];
    var ALLOWED_ACTIONS = [RECEIVER_INFO_ACTION].concat(GROUP_ACTIONS);

    function includes(list, value) { return list.indexOf(value) !== -1; }

    // Egress allowlist: refuse to build a request for any non-contracted action so
    // the bounded exception can never widen into general Apps Script access.
    function isAllowedAction(action) { return includes(ALLOWED_ACTIONS, String(action)); }
    function isGroupAction(action) { return includes(GROUP_ACTIONS, String(action)); }
    function isMutationAction(action) { return includes(MUTATION_ACTIONS, String(action)); }

    // --- Capability format (never logged, never rendered, never shared) ---------
    function isValidToken(token) {
        return typeof token === "string" && new RegExp("^[a-f0-9]{" + TOKEN_HEX_LENGTH + "}$").test(token.trim().toLowerCase());
    }

    // --- Name / member client-side pre-validation (fail fast; receiver re-checks)
    function normalizeName(raw) {
        var name = String(raw == null ? "" : raw).trim().replace(/\s+/g, " ");
        var hasVisible = /[^\s\u200B-\u200D\uFEFF]/.test(name);
        var formulaPrefix = /^[=+\-@]/.test(name);
        if (!hasVisible || formulaPrefix || Array.from(name).length > NAME_MAX_CHARACTERS) {
            return { ok: false, code: "INVALID_GROUP_NAME" };
        }
        return { ok: true, value: name };
    }

    function normalizeMemberIds(ids) {
        if (!Array.isArray(ids)) return { ok: false, code: "MIN_GROUP_MEMBERS" };
        var safe = /^[A-Za-z0-9_-]{1,80}$/;
        var cleaned = [];
        for (var i = 0; i < ids.length; i++) {
            var id = String(ids[i] == null ? "" : ids[i]).trim();
            if (!safe.test(id)) return { ok: false, code: "INVALID_MEMBER_USER_ID" };
            cleaned.push(id);
        }
        if (cleaned.length < MIN_MEMBERS) return { ok: false, code: "MIN_GROUP_MEMBERS" };
        var unique = cleaned.slice().sort();
        for (var j = 1; j < unique.length; j++) if (unique[j] === unique[j - 1]) return { ok: false, code: "DUPLICATE_GROUP_MEMBER" };
        return { ok: true, value: unique };
    }

    // --- Deterministic leaderboard projection (contract §Deterministic Projection)
    // leaderboardRows must arrive in OFFICIAL order (the app's sortedRows()).
    function projectGroup(group, leaderboardRows) {
        var memberIds = (group && Array.isArray(group.member_user_ids)) ? group.member_user_ids : [];
        var memberSet = {};
        memberIds.forEach(function (id) { memberSet[String(id)] = true; });
        var rows = Array.isArray(leaderboardRows) ? leaderboardRows : [];

        // 1-2. Select member rows preserving official relative order.
        var resolved = [];
        var seen = {};
        rows.forEach(function (r) {
            var id = String(r && r.user_id);
            if (memberSet[id] && !seen[id]) { seen[id] = true; resolved.push(r); }
        });

        // 4. group_rank via competition ranking over selected official points.
        var members = [];
        var lastPoints = null, lastGroupRank = 0;
        resolved.forEach(function (r, index) {
            var points = r.total_points;
            var groupRank;
            if (lastPoints !== null && points === lastPoints) {
                groupRank = lastGroupRank;                 // equal totals share rank → 1,1,3
            } else {
                groupRank = index + 1;
                lastGroupRank = groupRank;
                lastPoints = points;
            }
            members.push({
                user_id: r.user_id,
                display_name: r.display_name != null ? r.display_name : r.user_id,
                total_points: r.total_points,
                general_rank: (r.rank != null ? r.rank : null), // 3. preserve official rank
                group_rank: groupRank
            });
        });

        var unresolved = memberIds.filter(function (id) { return !seen[String(id)]; });
        return {
            members: members,
            resolved_count: members.length,
            configured_count: memberIds.length,
            unresolved_ids: unresolved,
            can_share: members.length >= MIN_MEMBERS
        };
    }

    // --- Snapshot format availability (contract §Shareable Snapshot Contract) ----
    function snapshotFormats(resolvedCount) {
        var n = Math.max(0, Number(resolvedCount) || 0);
        return [
            { format: "HIGHLIGHTS", available: n >= 2, rows: Math.min(4, n) },
            { format: "TOP_10", available: n >= 5, rows: Math.min(10, n) }
        ];
    }
    function snapshotFormat(format, resolvedCount) {
        return snapshotFormats(resolvedCount).filter(function (f) { return f.format === format; })[0] || null;
    }

    // Build the ONLY data a snapshot may present. No token, endpoint, receipt,
    // client_request_id, private JSON or public URL is ever included here.
    function buildSnapshotModel(group, projection, format, context) {
        var spec = snapshotFormat(format, projection.resolved_count);
        if (!spec || !spec.available) return { ok: false, code: "FORMAT_UNAVAILABLE" };
        var visible = projection.members.slice(0, spec.rows).map(function (m) {
            return {
                group_rank: m.group_rank,
                display_name: m.display_name,
                total_points: m.total_points,
                general_rank: m.general_rank
            };
        });
        return {
            ok: true,
            phrase: SHARE_PHRASE,
            group_name: (group && group.name) || "",
            format: format,
            rows: visible,
            competition_id: (context && context.competition_id) || "",
            period_label: (context && context.period_label) || "",
            generated_at: (context && context.generated_at) || ""
        };
    }

    // --- Idempotency identity -------------------------------------------------
    // A retry of the SAME mutation must reuse its client_request_id; the caller
    // holds this value across retries. Generated once per logical mutation.
    function newClientRequestId(rng) {
        var random = typeof rng === "function" ? rng : Math.random;
        function block() { return Math.floor(random() * 0x100000000).toString(16); }
        return "sgc-" + block() + block() + Date.now().toString(16);
    }

    // --- Request builders (envelope per contract §Transport Contract) ----------
    function buildRequest(action, context) {
        if (!isAllowedAction(action)) throw new Error("SOCIAL_GROUPS_ACTION_NOT_ALLOWED");
        context = context || {};
        if (action === RECEIVER_INFO_ACTION) return { action: RECEIVER_INFO_ACTION }; // token-less handshake
        if (!isValidToken(context.token)) throw new Error("SOCIAL_GROUPS_TOKEN_INVALID");
        var request = {
            action: action,
            token: context.token,
            competition_id: context.competition_id,
            payload: context.payload || {}
        };
        if (isMutationAction(action)) {
            if (!context.client_request_id) throw new Error("SOCIAL_GROUPS_CLIENT_REQUEST_ID_REQUIRED");
            request.client_request_id = context.client_request_id;
        }
        return request;
    }

    // --- Handshake (validate env / competition / deployment EXACTLY) -----------
    function runtimeReceiverConfigured(runtime) {
        return !!(runtime && runtime.apps_script_url && runtime.deployment_id &&
            runtime.environment && runtime.competition_id);
    }
    function evaluateHandshake(runtime, info) {
        if (!runtimeReceiverConfigured(runtime)) return { ok: false, reason: "RECEIVER_UNCONFIGURED" };
        if (!info || info.ok !== true) return { ok: false, reason: "HANDSHAKE_UNAVAILABLE" };
        if (info.environment !== runtime.environment) return { ok: false, reason: "ENVIRONMENT_MISMATCH" };
        if (info.competition_id !== runtime.competition_id) return { ok: false, reason: "COMPETITION_MISMATCH" };
        if (info.deployment_id !== runtime.deployment_id) return { ok: false, reason: "DEPLOYMENT_MISMATCH" };
        return { ok: true, reason: null };
    }

    // Same namespaced key scheme as the capture bootstrap, so a token stored by
    // the capture surface on the same origin is recoverable here (and vice versa).
    function tokenStorageKey(runtime) {
        return "betz_token:" + runtime.deployment_id + ":" + runtime.competition_id;
    }

    function safeStorage(storage, method, key, value) {
        try {
            if (method === "get") return (storage && storage.getItem(key)) || "";
            if (method === "set") return storage && storage.setItem(key, value);
            if (method === "remove") return storage && storage.removeItem(key);
        } catch (e) { return ""; }
        return "";
    }

    // deps: { runtime, incomingToken, storage, sendReceiverInfo() -> Promise<info> }
    // Only AFTER an exact handshake match may an incoming capability be stored, or a
    // stored one recovered. On any failure nothing is stored, transmitted or leaked.
    function runGroupsBootstrap(deps) {
        var runtime = deps && deps.runtime;
        if (!runtimeReceiverConfigured(runtime)) {
            return Promise.resolve({ status: "UNCONFIGURED", reason: "RECEIVER_UNCONFIGURED", token: "" });
        }
        return Promise.resolve()
            .then(function () { return deps.sendReceiverInfo(); })
            .catch(function () { return null; })
            .then(function (info) {
                var verdict = evaluateHandshake(runtime, info);
                if (!verdict.ok) return { status: "BLOCKED", reason: verdict.reason, token: "" };
                var key = tokenStorageKey(runtime);
                var token = "";
                if (isValidToken(deps.incomingToken)) {
                    token = String(deps.incomingToken).trim().toLowerCase();
                    safeStorage(deps.storage, "set", key, token);
                } else {
                    var stored = safeStorage(deps.storage, "get", key);
                    if (isValidToken(stored)) token = String(stored).trim().toLowerCase();
                }
                return {
                    status: token ? "READY" : "NEEDS_LINK",
                    reason: token ? null : "NO_STORED_TOKEN",
                    token: token,
                    apps_script_url: runtime.apps_script_url,
                    deployment_id: runtime.deployment_id,
                    competition_id: runtime.competition_id,
                    environment: runtime.environment,
                    token_storage_key: key
                };
            });
    }

    return {
        NAME_MAX_CHARACTERS: NAME_MAX_CHARACTERS,
        MIN_MEMBERS: MIN_MEMBERS,
        SHARE_PHRASE: SHARE_PHRASE,
        GROUP_ACTIONS: GROUP_ACTIONS,
        ALLOWED_ACTIONS: ALLOWED_ACTIONS,
        isAllowedAction: isAllowedAction,
        isGroupAction: isGroupAction,
        isMutationAction: isMutationAction,
        isValidToken: isValidToken,
        normalizeName: normalizeName,
        normalizeMemberIds: normalizeMemberIds,
        projectGroup: projectGroup,
        snapshotFormats: snapshotFormats,
        snapshotFormat: snapshotFormat,
        buildSnapshotModel: buildSnapshotModel,
        newClientRequestId: newClientRequestId,
        buildRequest: buildRequest,
        runtimeReceiverConfigured: runtimeReceiverConfigured,
        evaluateHandshake: evaluateHandshake,
        tokenStorageKey: tokenStorageKey,
        runGroupsBootstrap: runGroupsBootstrap
    };
});
