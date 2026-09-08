"use strict";

const app = document.querySelector("#app");

const esc = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const mxn = (amount) => new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0
}).format(amount);

const two = (number) => String(number).padStart(2, "0");

function scoreCard(label, item) {
  return `<div class="score-row"><span>${esc(label)}</span><strong>+${esc(item.points)}</strong></div>`;
}

function precisionCard(stage, isSuperBowl = false) {
  const stageLabel = isSuperBowl ? "SUPER BOWL" : "WC · DIV · CONFERENCIA";
  return `
    <article class="precision-card${isSuperBowl ? " super-bowl-card" : ""}">
      <div class="precision-card-head">
        <span>${stageLabel}</span>
        <strong>Hasta +${esc(stage.maximum_modifier_points_per_match)}</strong>
      </div>
      <div class="precision-lines">
        <div><span>Marcador visitante exacto</span><strong>+${esc(stage.away_score_exact_points)}</strong></div>
        <div><span>Marcador local exacto</span><strong>+${esc(stage.home_score_exact_points)}</strong></div>
        <div class="precision-total"><span>Ambos exactos</span><strong>+${esc(stage.exact_scoreline_bonus_points)} extra</strong></div>
      </div>
      ${isSuperBowl ? `<p class="super-note">Máximo de modificadores por partido: <strong>+${esc(stage.maximum_modifier_points_per_match)}</strong>.</p>` : ""}
    </article>`;
}

function sampleGroup(group, winner) {
  const wins = group.label === winner;
  return `
    <div class="sample-group${wins ? " winner" : ""}">
      <div class="sample-group-head">
        <h4>${esc(group.label)}</h4>
        ${wins ? "<span>GRUPO ALEATORIO GANADOR</span>" : ""}
      </div>
      <div class="member-points" aria-label="Puntos de los integrantes">
        ${group.member_points.map((points) => `<span>${esc(points)}</span>`).join("")}
      </div>
      <div class="average-line">
        <span>${esc(group.total_points)} pts ÷ ${esc(group.active_members)} activos</span>
        <strong>Promedio ${esc(group.average.toFixed(1))}</strong>
      </div>
    </div>`;
}

function render(rules) {
  const regular = rules.scoring.execution_plan.filter((item) => item.sequence <= 4);
  const [playoffs, superBowl] = rules.scoring.postseason_score_precision.stages;
  const randomGroup = rules.scoring.random_group;
  const payout = rules.confirmed_payout;
  const regularExample = rules.examples.find((example) => example.example_id === "regular_season");
  const wrongPick = rules.examples.find((example) => example.example_id === "playoff_wrong_pick_partial_score");
  const superExample = rules.examples.find((example) => example.example_id === "super_bowl_exact_scoreline");

  document.title = rules.title;
  app.innerHTML = `
    <section class="hero shell" aria-labelledby="page-title">
      <div>
        <p class="eyebrow">REGLAS · ${esc(rules.competition_id)}</p>
        <h1 id="page-title">Entiende el juego<span> en 30 segundos.</span></h1>
        <p class="hero-intro">Elige ganadores, fija tu partido clave y acumula puntos durante toda la temporada.</p>
        <nav class="anchor-nav" aria-label="Contenido de las reglas">
          <a href="#esencial">Lo esencial</a>
          <a href="#puntos">Puntos</a>
          <a href="#playoffs">Playoffs</a>
          <a href="#desempates">Desempates</a>
          <a href="#premios">Premios</a>
        </nav>
      </div>
      <aside class="scoreboard" aria-label="Resumen de puntuación">
        <div class="scoreboard-top"><span>RESUMEN</span><span>REGULAR</span></div>
        ${scoreCard("Acierto", regular[0])}
        ${scoreCard("Partido fijado", regular[1])}
        ${scoreCard("Grupo aleatorio", regular[2])}
        ${scoreCard("Semana perfecta", regular[3])}
        <p>Los puntos se acumulan durante toda la temporada.</p>
      </aside>
    </section>

    <section class="content-section shell" id="premios">
      <div class="section-heading"><p class="eyebrow">PREMIOS CONFIRMADOS · MXN</p><h2>${mxn(payout.prize_pool)} en juego</h2><p>17 participantes. Un reparto definido, sin montos estimados.</p></div>
      <article class="payout-example">
        <div class="payout-breakdown">
          <section class="weekly-payout"><span>TEMPORADA REGULAR · 18 SEMANAS</span><strong>${mxn(payout.weekly_prizes.amount_each)}</strong><p>Por semana, para el ganador o los ganadores empatados después del desempate semanal.</p><small>Total semanal: ${mxn(payout.weekly_prizes.total)}</small><p><strong>En postemporada no hay premio semanal.</strong></p></section>
          <section class="season-payout"><div class="season-payout-head"><span>CLASIFICACIÓN FINAL</span><small>Temporada regular + postemporada</small></div><ol>${payout.season_prizes.placements.map(prize => `<li><span>${esc(prize.place)}º lugar</span><strong>${mxn(prize.amount)}</strong></li>`).join("")}</ol><p>Total final: ${mxn(payout.season_prizes.total)}</p></section>
        </div>
        <footer class="payout-example-foot"><strong>Todo el pozo se reparte: $18,000 + $27,000 = $45,000 MXN.</strong><p>Los premios corresponden a resultados definitivos; las posiciones actuales no representan premios ganados ni pagos realizados.</p></footer>
      </article>
      <details class="payout-example"><summary>De dónde sale el pozo y cómo se reparten los empates</summary>
        <div class="payout-example-foot"><h3>Cuentas claras</h3><p>17 inscripciones: <strong>$51,000</strong> recaudados. Administración: <strong>$6,000</strong>. Pozo neto: <strong>$45,000 MXN</strong>, destinado íntegramente a los premios publicados arriba.</p>
        <h3>Empates finales: golf-split</h3><p>Se suman los premios de los lugares ocupados por los empatados y se dividen por igual. El siguiente jugador salta esos lugares. Las posiciones posteriores al cuarto aportan $0.</p><p><strong>Ejemplo:</strong> dos empatados en segundo ocupan 2.º y 3.º: ($7,000 + $3,000) ÷ 2 = <strong>$5,000 cada uno</strong>. El siguiente queda cuarto y recibe $3,000.</p><p>Dos empatados en cuarto comparten $3,000: $1,500 cada uno.</p>
        <h3>Empates semanales</h3><p>Primero se aplican los <a href="#desempates">criterios del Partido fijado</a>. Si continúa el empate, los ganadores comparten por igual los $1,000 de esa semana; el pozo no aumenta.</p></div>
      </details>
    </section>

    <section class="content-section shell" id="esencial">
      <div class="section-heading">
        <p class="eyebrow">PRIMERO ESTO</p>
        <h2>Lo esencial</h2>
        <p>Seis reglas. Eso es suficiente para empezar.</p>
      </div>
      <div class="rules-grid">
        ${rules.quick_rules.map((rule, index) => `
          <article class="rule-card">
            <span class="rule-number">${two(index + 1)}</span>
            <h3>${esc(rule.title)}</h3>
            <p>${esc(rule.body)}</p>
          </article>`).join("")}
      </div>
    </section>

    <section class="content-section shell" id="puntos">
      <div class="section-heading split-heading">
        <div><p class="eyebrow">TEMPORADA REGULAR</p><h2>Cómo sumas puntos</h2></div>
        <p class="heading-note">Tu marcador del Partido fijado sirve para desempatar. En temporada regular no da puntos por precisión.</p>
      </div>
      <div class="scoring-list">
        ${regular.map((item) => `
          <article class="scoring-item">
            <span class="scoring-sequence">${two(item.sequence)}</span>
            <div><h3>${esc(item.label)}</h3><p>${esc(item.explanation)}</p></div>
            <strong>+${esc(item.points)}</strong>
          </article>`).join("")}
      </div>

      <article class="group-explainer">
        <div class="group-heading">
          <div><p class="eyebrow">GRUPOS ALEATORIOS</p><h3>Tu grupo aleatorio cambia cada semana.</h3></div>
          <p>No eliges el grupo. BETZ hace el sorteo y congela la asignación antes de calcular resultados.</p>
        </div>
        <div class="group-steps">
          ${randomGroup.steps.map((step) => `
            <div class="group-step"><span>${two(step.sequence)}</span><h4>${esc(step.title)}</h4><p>${esc(step.body)}</p></div>`).join("")}
        </div>
        <div class="group-example">
          <div class="group-example-label">EJEMPLO DE UNA JORNADA</div>
          <div class="group-comparison">
            ${sampleGroup(randomGroup.example.group_a, randomGroup.example.winner)}
            ${sampleGroup(randomGroup.example.group_b, randomGroup.example.winner)}
          </div>
          <div class="group-award"><span>${esc(randomGroup.example.winner)}</span><strong>+${esc(randomGroup.award_points_per_active_member)} para cada integrante activo</strong></div>
        </div>
        <p class="group-footnote">Si alguien no participa en la jornada, no baja el promedio: queda fuera del cálculo y tampoco recibe el punto del grupo.</p>
      </article>

      <article class="example-card">
        <div class="example-label">EJEMPLO RÁPIDO</div>
        <div class="example-content">
          <div>${regularExample.facts.map((fact) => `<p>${esc(fact)}</p>`).join("")}</div>
          <div class="example-math"><strong>= ${esc(regularExample.total_points)} pts</strong></div>
        </div>
      </article>
    </section>

    <section class="content-section playoffs-section" id="playoffs">
      <div class="shell">
        <div class="section-heading split-heading">
          <div><p class="eyebrow">PLAYOFFS</p><h2>El marcador también juega</h2></div>
          <p class="heading-note">Capturas marcador local y visitante en cada partido. Debe ser coherente con tu pick, pero estos puntos no dependen de acertar al ganador.</p>
        </div>
        <div class="precision-grid">
          ${precisionCard(playoffs)}
          ${precisionCard(superBowl, true)}
        </div>
        <article class="wrong-pick-example">
          <div><p class="eyebrow">${esc(wrongPick.eyebrow)}</p><h3>${esc(wrongPick.title)}</h3><p>${esc(wrongPick.facts.join(" · "))}</p></div>
          <div class="result-badge">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>
            <span>El marcador exacto conserva su modificador</span>
            <strong>+${esc(playoffs.home_score_exact_points)}</strong>
          </div>
        </article>
        <p class="super-note">Con marcador exacto del Super Bowl: +${esc(superExample.modifier_points)} en modificadores; máximo total del partido incluyendo el scoring existente: <strong>${esc(superExample.maximum_total_points_including_existing_scoring)} puntos</strong>.</p>
      </div>
    </section>

    <section class="content-section shell" id="desempates">
      <div class="section-heading"><p class="eyebrow">SI TERMINAN IGUALES</p><h2>Desempate semanal</h2><p>Se aplican estos criterios, en este orden.</p></div>
      <ol class="tie-list">
        ${rules.weekly_winner_resolution.tie_break_plan.map((criterion) => `<li><span>${two(criterion.sequence)}</span><p>${esc(criterion.label)}</p></li>`).join("")}
      </ol>
    </section>

    <section class="trust-section">
      <div class="shell trust-inner">
        <div><p class="eyebrow">TRANSPARENCIA TOTAL</p><h2>Cada punto se puede explicar.</h2><p>${esc(rules.auditability.principle)} BETZ publica el pronóstico congelado, el resultado oficial y el detalle del cálculo.</p></div>
        <img class="trust-mark" src="assets/betz-mark-z.svg" alt="" width="145" height="228">
      </div>
    </section>

    <footer class="site-footer shell">
      <div><a href="https://betz-app.github.io/" aria-label="Ir al inicio de BETZ"><img src="assets/betz-wordmark.svg" alt="BETZ" width="88" height="42"></a><p>Ten la razón. Cóbrasela a todos.</p></div>
      <div class="footer-meta"><span>${esc(rules.title)}</span><span>${esc(rules.ruleset_id)}</span></div>
    </footer>`;

  queueMicrotask(() => {
    const eventName = rules.telemetry?.view_event || "rules_viewed";
    window.dispatchEvent(new CustomEvent("betz:analytics", { detail: { event: eventName, source: "public_rules" } }));
    if (typeof window.clarity === "function") window.clarity("event", eventName);
  });
}

fetch("data/rules.json", { cache: "no-store" })
  .then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  })
  .then(render)
  .catch((error) => {
    console.error("No se pudieron cargar las reglas", error);
    app.innerHTML = '<p class="fatal">No pudimos cargar las reglas. Intenta actualizar la página en unos segundos.</p>';
  });
