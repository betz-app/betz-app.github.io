"use strict";

(function exposeFootballKnowledge(root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    root.BetzFootballKnowledge = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function buildFootballKnowledgePresenter() {
    //-----------------------------//
    // Presentation metadata
    //-----------------------------//

    const PERSPECTIVES = {
        "season:team": { title: "Equipos", type: "TEAM" },
        "season:conference": { title: "Conferencia", type: "CONFERENCE" },
        "season:division": { title: "Divisiones", type: "DIVISION" }
    };

    const TIER_LABELS = {
        initial: "Inicial",
        solid: "Sólido",
        high: "Alto",
        exclusive: "Exclusivo"
    };

    const STATUS_COPY = {
        INSUFFICIENT_ELIGIBLE_ENTITIES: {
            title: "Todavía estás construyendo la muestra",
            body: "Se activa cuando al menos dos opciones reúnen cuatro pronósticos evaluados."
        },
        NO_DIFFERENTIATED_KNOWLEDGE: {
            title: "Aún no hay una ventaja clara",
            body: "Tus mejores resultados siguen demasiado repartidos para declarar una fortaleza."
        }
    };

    //-----------------------------//
    // Label helpers
    //-----------------------------//

    function indexTeams(teamsContract) {
        const teams = teamsContract && Array.isArray(teamsContract.teams) ? teamsContract.teams : [];
        return new Map(teams.map(team => [team.team_id, team]));
    }

    function entityLabel(perspectiveId, entity, teamsById) {
        if (perspectiveId === "season:team") {
            const team = teamsById.get(entity.team_id);
            return team ? team.name : entity.team_id;
        }
        if (perspectiveId === "season:conference") return entity.conference;
        if (perspectiveId === "season:division") return `${entity.conference} ${entity.division}`;
        return "—";
    }

    function joinSpanish(labels) {
        if (labels.length < 2) return labels[0] || "—";
        if (labels.length === 2) return `${labels[0]} y ${labels[1]}`;
        return `${labels.slice(0, -1).join(", ")} y ${labels[labels.length - 1]}`;
    }

    function withArticle(type, label, preposition) {
        if (type === "TEAM") return preposition ? `${preposition} ${label}` : label;
        if (preposition === "a") return `a la ${label}`;
        if (preposition === "de") return `de la ${label}`;
        return `La ${label}`;
    }

    //-----------------------------//
    // Narrative
    //-----------------------------//

    function narrativeFor(insightCode, labels) {
        if (!insightCode || !labels.length) return null;
        const match = /^FOOTBALL_KNOWLEDGE_(TEAM|CONFERENCE|DIVISION)_(INITIAL|SOLID|HIGH|EXCLUSIVE)_(SINGLE|TIED)$/.exec(insightCode);
        if (!match) return null;

        const [, type, tier, cardinality] = match;
        const joined = joinSpanish(labels);

        if (cardinality === "TIED") {
            if (tier === "INITIAL") return `${joined} empiezan a darte la razón.`;
            if (tier === "SOLID") return `${joined} ya son tus viejos confiables.`;
            if (tier === "HIGH") return `${joined} comparten algo: les tienes tomada la medida.`;
            return `Tus pronósticos de ${joined} merecen una investigación.`;
        }

        const label = labels[0];
        if (tier === "INITIAL") return `${withArticle(type, label)} es tu fuerte.`;
        if (tier === "SOLID") return `${withArticle(type, label)} ya es terreno conocido.`;
        if (tier === "HIGH") return `Le tienes tomada la medida ${withArticle(type, label, "a")}.`;
        if (type === "TEAM") return `Predices a ${label} con precisión sospechosa.`;
        return `Tus pronósticos ${withArticle(type, label, "de")} ya merecen una investigación.`;
    }

    //-----------------------------//
    // View model
    //-----------------------------//

    function temporalLabel(asOf) {
        if (!asOf) return "Sin corte evaluado";
        const period = Number.isInteger(asOf.week) ? `Jornada ${asOf.week}` : asOf.match_id;
        if (!asOf.season_type || /^regular/i.test(asOf.season_type)) return `Hasta ${period}`;
        return `Hasta ${asOf.season_type} · ${period}`;
    }

    function formatPercent(value) {
        if (!Number.isFinite(value)) return "—";
        const percent = Math.round(value * 1000) / 10;
        return `${Number.isInteger(percent) ? percent.toFixed(0) : percent.toFixed(1)}%`;
    }

    function perspectiveView(perspective, teamsById) {
        const meta = PERSPECTIVES[perspective.perspective_id];
        if (!meta) return null;
        const result = perspective.result || {};
        const ranking = Array.isArray(result.ranking) ? result.ranking : [];
        const rows = ranking.map(entity => ({
            ...entity,
            label: entityLabel(perspective.perspective_id, entity, teamsById),
            efficiency_label: formatPercent(entity.efficiency),
            tier_label: TIER_LABELS[entity.tier_code] || entity.tier_code
        }));
        const firstLabels = rows.filter(entity => entity.rank === 1).map(entity => entity.label);
        const insightCode = result.primary_insight && result.primary_insight.insight_code;

        return {
            perspective_id: perspective.perspective_id,
            title: meta.title,
            status: result.status,
            status_copy: STATUS_COPY[result.status] || null,
            narrative: narrativeFor(insightCode, firstLabels),
            rows
        };
    }

    function buildView(contract, userId, teamsContract) {
        if (!contract || contract.contract_type !== "football_knowledge_player_indicator") return null;
        const player = Array.isArray(contract.players) ? contract.players.find(item => item.user_id === userId) : null;
        if (!player) return null;
        const teamsById = indexTeams(teamsContract);
        return {
            temporal_label: temporalLabel(contract.as_of),
            perspectives: (player.perspectives || []).map(item => perspectiveView(item, teamsById)).filter(Boolean)
        };
    }

    return {
        buildView,
        entityLabel,
        formatPercent,
        joinSpanish,
        narrativeFor,
        temporalLabel
    };
});
