/* ============================================================
   IL COLORE DEI BIT — script.js
   Richiede: D3 v7 (caricato prima nello HTML)
   ============================================================ */
"use strict";
// ---- DATASET & STATO GLOBALE --------------------------------
const DATASET_URL = "https://raw.githubusercontent.com/davidesanturro13/progetto-esame-data/refs/heads/main/giochi_arricchiti.csv?v=18";
let dataset         = [];
let svg, innerWidth, innerHeight;
let xScaleAnno, yScaleColori, xScaleConsole, yScaleGenere;
let xAxisGroup, yAxisGroup;
let simulation;
let currentStep     = "0";
let hasStarted      = false;
let accessibilityMode = false;
let annotationTimer;
let activeConsoles  = [];
let activeGenres    = [];
// FIX 1 — variabile per debounce del cambio step e flag transizione in corso
let stepChangeTimer  = null;
let chartHideTimer   = null;
let isTransitioning  = false;
const STEP_DEBOUNCE_MS = 80;

// ---- AUDIO --------------------------------------------------
let audioCtx = null;
function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx.state === 'suspended' ? audioCtx.resume() : Promise.resolve();
}
function playSound(type) {
  initAudio().then(() => {
    const osc  = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    const t = audioCtx.currentTime;
    if (type === 'button') {
      osc.type = 'square';
      osc.frequency.setValueAtTime(280, t);
      osc.frequency.exponentialRampToValueAtTime(560, t + 0.09);
      gain.gain.setValueAtTime(0.05, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      osc.start(t); osc.stop(t + 0.09);
    } else if (type === 'dot') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, t);
      osc.frequency.exponentialRampToValueAtTime(440, t + 0.18);
      gain.gain.setValueAtTime(0.07, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      osc.start(t); osc.stop(t + 0.18);
    } else if (type === 'line') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(200, t);
      osc.frequency.exponentialRampToValueAtTime(600, t + 0.12);
      gain.gain.setValueAtTime(0.08, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      osc.start(t); osc.stop(t + 0.12);
    }
  }).catch(() => {});
}

// ---- SCROLL PROGRESS ----------------------------------------
window.addEventListener('scroll', () => {
  const st  = document.documentElement.scrollTop;
  const sh  = document.documentElement.scrollHeight - document.documentElement.clientHeight;
  const pct = sh > 0 ? (st / sh) * 100 : 0;
  const bar = document.getElementById('progress-bar');
  bar.style.width = pct + '%';
  bar.setAttribute('aria-valuenow', Math.round(pct));
  document.body.classList.toggle('is-scrolled', st > 80);
}, { passive: true });

// ---- INIT ---------------------------------------------------
d3.csv(DATASET_URL).then(rawData => {
  dataset = rawData
    .filter(d => d.anno && d.colori_schermo && !isNaN(+d.anno) && !isNaN(+d.colori_schermo))
    .map(d => ({ ...d, anno: +d.anno, colori_schermo: +d.colori_schermo }));
  if (dataset.length === 0) {
    document.getElementById('chart-container').innerHTML =
      '<p style="color:#8b9bb5;text-align:center;padding:40px">Nessun dato disponibile.</p>';
    return;
  }
  buildChart();
  const loadingEl = document.getElementById('chart-loading');
  if (loadingEl) loadingEl.style.display = 'none';
  buildFilters();
  currentStep = null;
  drawStep1();
  renderAnnotations("1");
  currentStep = "1";
  setupScroller();
  setupResize();
  setupAccessibility();
  initTetris();
}).catch(err => {
  console.error("Errore caricamento dataset:", err);
  document.getElementById('chart-container').innerHTML =
    '<p style="color:#f73b3b;text-align:center;padding:40px">Errore nel caricamento dei dati.</p>';
});

// ---- BUILD CHART --------------------------------------------
function getMargins() { return { top: 80, right: 44, bottom: 60, left: 134 }; }
function buildChart() {
  const container = document.getElementById("chart-container");
  const W = container.getBoundingClientRect().width;
  const H = container.getBoundingClientRect().height;
  const m = getMargins();
  innerWidth  = W - m.left - m.right;
  innerHeight = H - m.top - m.bottom;
  const minAnno = d3.min(dataset, d => d.anno) - 1;
  const maxAnno = d3.max(dataset, d => d.anno) + 1;
  xScaleAnno = d3.scaleLinear().domain([minAnno, maxAnno]).range([0, innerWidth]);
  const maxColori = d3.max(dataset, d => d.colori_schermo);
  yScaleColori = d3.scaleLinear().domain([0, maxColori + 20]).range([innerHeight, 0]);
  const CONSOLES_ORDER = ['NES', 'GEN', 'SNES'];
  const consolesInData = [...new Set(dataset.map(d => d.piattaforma))];
  const consoles = CONSOLES_ORDER.filter(c => consolesInData.includes(c))
    .concat(consolesInData.filter(c => !CONSOLES_ORDER.includes(c)));
  xScaleConsole = d3.scaleBand().domain(consoles).range([0, innerWidth]).padding(0.35);
  const generi = [...new Set(dataset.map(d => d.genere))].sort();
  yScaleGenere = d3.scalePoint().domain(generi).range([innerHeight, 0]).padding(0.5);
  const svgRoot = d3.select("#chart-container")
    .append("svg")
    .attr("width", W).attr("height", H)
    .attr("role", "img")
    .attr("aria-label", "Grafico scatter sull'evoluzione cromatica dei videogiochi");
  svg = svgRoot.append("g").attr("transform", `translate(${m.left},${m.top})`);
  svg.append("rect")
    .attr("class", "bg-rect")
    .attr("width", innerWidth).attr("height", innerHeight)
    .attr("fill", "transparent")
    .on("mouseover click touchstart", hideTooltip);
  xAxisGroup = svg.append("g").attr("transform", `translate(0,${innerHeight})`);
  yAxisGroup = svg.append("g");
  const symbolGen = d3.symbol().size(125);
  svg.selectAll("path.gioco-dot")
    .data(dataset)
    .enter()
    .append("path")
    .attr("class", "gioco-dot")
    .attr("d", symbolGen.type(d3.symbolCircle)())
    .attr("fill", d => d.colore_dominante || "#58a6ff")
    .attr("tabindex", 0)
    .attr("aria-label", d => `${d.titolo}, ${d.anno}, ${d.colori_schermo} colori, ${d.genere}`)
    .on("mouseenter", onDotEnter)
    .on("mouseleave", hideTooltip)
    .on("click", () => playSound('dot'))
    .on("focus", onDotEnter)
    .on("blur", hideTooltip)
    .on("keydown", function(event, d) {
      if (event.key === 'Enter' || event.key === ' ') { playSound('dot'); }
    });
  svg.append("g").attr("class", "annotation-group");
  dataset.forEach(d => {
    d.x = innerWidth  / 2 + (Math.random() - 0.5) * 40;
    d.y = innerHeight / 2 + (Math.random() - 0.5) * 40;
  });
  simulation = d3.forceSimulation(dataset)
    .force("collide", d3.forceCollide().radius(8).iterations(3))
    .on("tick", () => {
      clampNodes();
      svg.selectAll(".gioco-dot").attr("transform", d => `translate(${d.x},${d.y})`);
    });
  d3.select("#chart-container").on("mouseleave", hideTooltip);
}

// ---- TOOLTIP ------------------------------------------------
function onDotEnter(event, d) {
  if (!d) return;
  const chartDiv = document.getElementById("chart-container");
  const [mx, my] = d3.pointer(event, chartDiv);
  d3.select(this).raise();
  d3.select(".annotation-group").raise();
  const titleShort = encodeURIComponent((d.titolo || 'Gioco').substring(0, 14));
  const fallback   = `https://placehold.co/200x113/0d1117/58a6ff?text=${titleShort}`;
  const imgSrc     = (d.url_copertina && d.url_copertina.trim()) ? d.url_copertina : fallback;
  const accent     = d.colore_dominante || '#58a6ff';
  const tooltip = d3.select("#tooltip");
  tooltip.html(`
    <img src="${imgSrc}" loading="lazy" alt="Copertina di ${d.titolo}"
         onerror="this.onerror=null;this.src='${fallback}'">
    <div class="tooltip-color-bar" style="background:${accent};box-shadow:0 0 10px ${accent}60;"></div>
    <div class="tooltip-title" style="color:${accent};">${d.titolo || '—'}</div>
    <div class="tooltip-info">
      Console: <strong style="color:${accent};">${d.piattaforma || '—'}</strong><br>
      Anno: <strong>${d.anno}</strong><br>
      Colori: <strong>${d.colori_schermo}</strong><br>
      Genere: <strong>${d.genere || '—'}</strong>
    </div>
  `);
  tooltip.style("border-color", accent).style("box-shadow", `0 20px 50px rgba(0,0,0,0.9), 0 0 24px ${accent}40`);
  const cW = chartDiv.clientWidth;
  const cH = chartDiv.clientHeight;
  tooltip.style("left", null).style("right", null).style("top", null).style("bottom", null);
  tooltip.style(mx > cW / 2 ? "left" : "right",  "20px");
  tooltip.style(my > cH / 2 ? "top"  : "bottom", "20px");
  tooltip.classed("is-visible", true);
}
function hideTooltip() {
  d3.select("#tooltip").classed("is-visible", false);
}

// ---- CLAMP NODES --------------------------------------------
function clampNodes() {
  if (!innerWidth || !innerHeight) return;
  for (const d of dataset) {
    d.x = Math.max(8, Math.min(innerWidth - 8,  isNaN(d.x) ? innerWidth / 2  : d.x));
    d.y = Math.max(8, Math.min(innerHeight - 8, isNaN(d.y) ? innerHeight / 2 : d.y));
  }
}
function safeSimRestart(alpha) {
  if (!simulation) return;
  simulation.stop();
  dataset.forEach(d => { d.vx = 0; d.vy = 0; });
  simulation.alpha(alpha != null ? alpha : 0.9).restart();
}

// ---- GRAFICO 1: Anno × Colori -------------------------------
function drawStep1() {
  xAxisGroup.transition().duration(700).attr("transform", `translate(0,${innerHeight})`)
    .call(d3.axisBottom(xScaleAnno).ticks(Math.max(4, Math.floor(innerWidth / 80))).tickFormat(d3.format("d")).tickSize(0).tickPadding(14));
  yAxisGroup.transition().duration(700)
    .call(d3.axisLeft(yScaleColori).tickSize(-innerWidth).tickPadding(14));
  if (!hasStarted) {
    svg.selectAll(".gioco-dot")
      .style("opacity", 0)
      .transition("opacityTrans")
      .delay((_, i) => i * 5)
      .duration(600)
      .style("opacity", 0.9);
    hasStarted = true;
  } else {
    svg.selectAll(".gioco-dot").interrupt("opacityTrans")
      .transition("opacityTrans").duration(600).style("opacity", 0.9);
  }
  simulation
    .force("x", d3.forceX(d => xScaleAnno(d.anno)).strength(0.85))
    .force("y", d3.forceY(d => yScaleColori(d.colori_schermo)).strength(0.85));
  safeSimRestart(0.9);
}

// ---- GRAFICO 2: Console × Colori ----------------------------
function drawStep2() {
  xAxisGroup.transition().duration(700).attr("transform", `translate(0,${innerHeight})`)
    .call(d3.axisBottom(xScaleConsole).tickSize(0).tickPadding(18));
  yAxisGroup.transition().duration(700)
    .call(d3.axisLeft(yScaleColori).tickSize(-innerWidth).tickPadding(14));
  svg.selectAll(".gioco-dot").interrupt("opacityTrans")
    .transition("opacityTrans").duration(700)
    .style("opacity", 0.92);
  simulation
    .force("x", d3.forceX(d => (xScaleConsole(d.piattaforma) || 0) + xScaleConsole.bandwidth() / 2).strength(0.9))
    .force("y", d3.forceY(d => yScaleColori(d.colori_schermo)).strength(0.85));
  safeSimRestart(0.9);
}

// ---- GRAFICO 3: Anno × Genere -------------------------------
function drawStep3() {
  xAxisGroup.transition().duration(700).attr("transform", `translate(0,${innerHeight})`)
    .call(d3.axisBottom(xScaleAnno).ticks(Math.max(4, Math.floor(innerWidth / 80))).tickFormat(d3.format("d")).tickSize(0).tickPadding(14));
  yAxisGroup.transition().duration(700)
    .call(d3.axisLeft(yScaleGenere).tickSize(-innerWidth).tickPadding(14));
  svg.selectAll(".gioco-dot").interrupt("opacityTrans").transition("opacityTrans").duration(700)
    .style("opacity", d => {
      const g = (d.genere || '').toLowerCase();
      return (g.includes("platform") || g.includes("role") || g.includes("rpg") || g.includes("gdr")) ? 0.95 : 0.1;
    });
  simulation
    .force("x", d3.forceX(d => xScaleAnno(d.anno)).strength(0.85))
    .force("y", d3.forceY(d => yScaleGenere(d.genere) || innerHeight / 2).strength(0.85));
  safeSimRestart(0.9);
}

// ---- GRAFICO 4: Filtri Liberi -------------------------------
function drawStep4() {
  xAxisGroup.transition().duration(700).attr("transform", `translate(0,${innerHeight})`)
    .call(d3.axisBottom(xScaleAnno).ticks(Math.max(4, Math.floor(innerWidth / 80))).tickFormat(d3.format("d")).tickSize(0).tickPadding(14));
  yAxisGroup.transition().duration(700)
    .call(d3.axisLeft(yScaleColori).tickSize(-innerWidth).tickPadding(14));
  applyMultiFilter();
  simulation
    .force("x", d3.forceX(d => xScaleAnno(d.anno)).strength(0.85))
    .force("y", d3.forceY(d => yScaleColori(d.colori_schermo)).strength(0.85));
  safeSimRestart(0.9);
}

// ---- FILTRI STEP 4 ------------------------------------------
function dotOpacity(d) {
  if (activeConsoles.length === 0 && activeGenres.length === 0) return 0.9;
  const mc = activeConsoles.length === 0 || activeConsoles.includes(d.piattaforma);
  const mg = activeGenres.length   === 0 || activeGenres.includes(d.genere);
  return (mc && mg) ? 0.92 : 0.04;
}
function applyMultiFilter() {
  svg.selectAll(".gioco-dot").interrupt("opacityTrans")
    .transition("opacityTrans").duration(400).style("opacity", d => dotOpacity(d));
}

// ---- ANNOTAZIONI --------------------------------------------
const ANNOTATIONS = {
  "1": ["1983 → 1997", "Anno di uscita vs. colori a schermo"],
  "2": ["CONSOLE WAR", "Confronto diretto hardware"],
  "3": ["GENERI", "RPG e Platform dominano"],
  "4": ["ESPLORAZIONE", "Filtri utente attivi"]
};
function renderAnnotations(step) {
  const ag = d3.select(".annotation-group");
  ag.raise();
  ag.selectAll("*").remove();
  clearTimeout(annotationTimer);
  const info = ANNOTATIONS[step];
  if (!info) return;
  annotationTimer = setTimeout(() => {
    ag.append("text").attr("class", "annotation-title")
      .attr("x", 4).attr("y", -46).style("opacity", 0).text(info[0])
      .transition().duration(700).style("opacity", 1);
    ag.append("text").attr("class", "annotation-text")
      .attr("x", 4).attr("y", -26).style("opacity", 0).text(info[1])
      .transition().duration(700).style("opacity", 1);
  }, 450);
}

// ---- SCROLLER -----------------------------------------------
function setupScroller() {
  const steps   = document.querySelectorAll('.step');
  const chartEl = document.getElementById("chart-container");
  const obs = new IntersectionObserver(entries => {
    const intersecting = [];
    entries.forEach(entry => {
      if (entry.isIntersecting) intersecting.push(entry.target);
    });
    if (intersecting.length === 0) return;
    const viewportMid = window.innerHeight / 2;
    let bestGraphic   = null;
    let bestDist      = Infinity;
    let hasIntermezzo = false;
    intersecting.forEach(el => {
      const step = el.getAttribute('data-step');
      if (step === 'intermezzo') {
        hasIntermezzo = true;
      } else {
        const rect = el.getBoundingClientRect();
        const mid  = rect.top + rect.height / 2;
        const dist = Math.abs(mid - viewportMid);
        if (dist < bestDist) { bestDist = dist; bestGraphic = el; }
      }
    });
    const winner     = bestGraphic || (hasIntermezzo ? intersecting.find(e => e.getAttribute('data-step') === 'intermezzo') : null);
    if (!winner) return;
    const winnerStep = winner.getAttribute('data-step');
    clearTimeout(stepChangeTimer);
    stepChangeTimer = setTimeout(() => {
      steps.forEach(s => s.classList.remove('is-active'));
      winner.classList.add('is-active');
      if (winnerStep === 'intermezzo') {
        clearTimeout(chartHideTimer);
        chartHideTimer = setTimeout(() => {
          if (currentStep === 'intermezzo') {
            chartEl.classList.add('is-hidden');
          }
        }, 60);
        currentStep = 'intermezzo';
        return;
      }
      clearTimeout(chartHideTimer);
      chartEl.classList.remove('is-hidden');
      if (currentStep === winnerStep) return;
      currentStep = winnerStep;
      const fn = { "1": drawStep1, "2": drawStep2, "3": drawStep3, "4": drawStep4 }[winnerStep];
      if (fn) fn();
      renderAnnotations(winnerStep);
    }, STEP_DEBOUNCE_MS);
  }, {
    rootMargin: "-20% 0px -20% 0px",
    threshold: 0
  });
  steps.forEach(s => obs.observe(s));
}

// ---- RESIZE -------------------------------------------------
function setupResize() {
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const chartDiv = document.getElementById("chart-container");
      const W = chartDiv.getBoundingClientRect().width;
      const H = chartDiv.getBoundingClientRect().height;
      const m = getMargins();
      innerWidth  = W - m.left - m.right;
      innerHeight = H - m.top - m.bottom;
      d3.select("#chart-container svg").attr("width", W).attr("height", H);
      d3.select(".bg-rect").attr("width", innerWidth).attr("height", innerHeight);
      const minAnno = d3.min(dataset, d => d.anno) - 1;
      const maxAnno = d3.max(dataset, d => d.anno) + 1;
      xScaleAnno.range([0, innerWidth]).domain([minAnno, maxAnno]);
      yScaleColori.range([innerHeight, 0]);
      xScaleConsole.range([0, innerWidth]);
      yScaleGenere.range([innerHeight, 0]);
      if (currentStep === "1") drawStep1();
      if (currentStep === "2") drawStep2();
      if (currentStep === "3") drawStep3();
      if (currentStep === "4") drawStep4();
      renderAnnotations(currentStep);
    }, 220);
  });
}

// ---- ACCESSIBILITY (Forme) ----------------------------------
function setupAccessibility() {
  const btn  = document.getElementById("toggle-shapes");
  const symMap = {
    NES: d3.symbolSquare,
    GEN: d3.symbolTriangle,
    SNES: d3.symbolDiamond
  };
  btn.addEventListener("click", () => {
    playSound('button');
    accessibilityMode = !accessibilityMode;
    btn.classList.toggle("is-active", accessibilityMode);
    btn.setAttribute('aria-pressed', accessibilityMode);
    const gen = d3.symbol().size(125);
    svg.selectAll(".gioco-dot").attr("d", d => {
      const sym = accessibilityMode ? (symMap[d.piattaforma] || d3.symbolCircle) : d3.symbolCircle;
      return gen.type(sym)();
    });
    svg.selectAll(".gioco-dot").interrupt("accessFlash")
      .transition("accessFlash").duration(140).style("stroke-width", "4px").style("filter", "brightness(1.5)")
      .transition("accessFlash").duration(260).style("stroke-width", "1.5px").style("filter", "none");
    simulation.alpha(0.15).restart();
  });
}

// ---- DINAMICA FILTRI ----------------------------------------
function buildFilters() {
  const consoles = [...new Set(dataset.map(d => d.piattaforma))].sort();
  const generi   = [...new Set(dataset.map(d => d.genere))].sort();
  const cc = document.getElementById('console-filters');
  const gc = document.getElementById('genre-filters');
  consoles.forEach(c => {
    const btn = document.createElement('button');
    btn.className = 'filter-btn';
    btn.setAttribute('data-filter', `console-${c}`);
    btn.setAttribute('aria-pressed', 'false');
    btn.innerText = c;
    cc.appendChild(btn);
  });
  generi.forEach(g => {
    const btn = document.createElement('button');
    btn.className = 'filter-btn';
    btn.setAttribute('data-filter', `genre-${g}`);
    btn.setAttribute('aria-pressed', 'false');
    btn.innerText = g;
    gc.appendChild(btn);
  });
  const resetBtn = document.getElementById('reset-filters');
  const allBtns  = document.querySelectorAll('.filter-btn:not(#reset-filters):not(#btn-start-pause)');
  resetBtn.addEventListener('click', () => {
    if (currentStep !== "4") return;
    playSound('button');
    activeConsoles = [];
    activeGenres   = [];
    allBtns.forEach(b => { b.classList.remove('is-active'); b.setAttribute('aria-pressed', 'false'); });
    resetBtn.classList.add('is-active');
    applyMultiFilter();
  });
  allBtns.forEach(btn => {
    btn.addEventListener('click', function() {
      if (currentStep !== "4") return;
      playSound('button');
      const active = this.classList.toggle('is-active');
      this.setAttribute('aria-pressed', active);
      resetBtn.classList.remove('is-active');
      const fType  = this.getAttribute('data-filter');
      let fValue = "";
      if (fType.startsWith('console-')) {
        fValue = fType.replace('console-', '');
        if (active) activeConsoles.push(fValue);
        else activeConsoles = activeConsoles.filter(c => c !== fValue);
      } else {
        fValue = fType.replace('genre-', '');
        if (active) activeGenres.push(fValue);
        else activeGenres = activeGenres.filter(g => g !== fValue);
      }
      if (activeConsoles.length === 0 && activeGenres.length === 0) {
        resetBtn.classList.add('is-active');
      }
      applyMultiFilter();
    });
  });
}

// ---- TETRIS -------------------------------------------------
function initTetris() {
  const canvas   = document.getElementById('tetrisCanvas');
  if (!canvas) return;
  const ctx      = canvas.getContext('2d');
  const kbdHint  = document.getElementById('keyboard-hint');
  const ROWS = 20, COLS = 10, BLOCK = 20;
  canvas.width  = COLS * BLOCK;
  canvas.height = ROWS * BLOCK;

  // MODIFICA: cycleColor ora cambia solo il bordo del canvas tetris,
  // NON la variabile --accent globale (evita di influenzare l'intera pagina)
  const PAGE_COLORS = ['#58a6ff','#f73b3b','#a872ff','#EDB12E','#2E68ED','#ff007f','#00e5ff','#00e676'];
  let colorCycle = 0;
  function cycleColor() {
    colorCycle = (colorCycle + 1) % PAGE_COLORS.length;
    const c = PAGE_COLORS[colorCycle];
    // Cambia solo il bordo del canvas, non il tema globale della pagina
    canvas.style.borderColor = c;
    canvas.style.boxShadow   = `inset 0 0 24px rgba(0,0,0,0.8), 0 0 28px ${c}40`;
  }

  const WHITE_COLOR = '#ffffff';
  const VIVID_COLORS = [null,'#00e5ff','#f73b3b','#EDB12E','#ffeb3b','#00e676','#a872ff','#2E68ED'];
  let unlockedCount = 0;
  function getPieceColor(val) {
    if (val <= 0) return WHITE_COLOR;
    return val <= unlockedCount ? VIVID_COLORS[val] : WHITE_COLOR;
  }
  function updateUnlockedColors() {
    unlockedCount = Math.min(7, Math.floor(score / 10));
  }

  const PIECES = [
    null,
    [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
    [[2,0,0],[2,2,2],[0,0,0]],
    [[0,0,3],[3,3,3],[0,0,0]],
    [[4,4],[4,4]],
    [[0,5,5],[5,5,0],[0,0,0]],
    [[0,6,0],[6,6,6],[0,0,0]],
    [[7,7,0],[0,7,7],[0,0,0]]
  ];
  let board = createBoard();
  let score = 0;
  let state = 'IDLE'; // IDLE | PLAYING | PAUSED | GAME_OVER | WON
  let dropCounter  = 0;
  let dropInterval = 1000;
  let lastTime     = 0;
  let player       = { pos: { x: 0, y: 0 }, matrix: null };

  const startBtn   = document.getElementById('btn-start-pause');
  const startIcon  = document.getElementById('start-icon');
  const startLabel = document.getElementById('start-label');

  function updateUIVisibility() {
    const isPlaying = (state === 'PLAYING' || state === 'PAUSED');
    // MODIFICA: l'hint tastiera rimane visibile anche durante il gioco
    // (evita lo slittamento del layout al click su "Inizia")
    // La si nasconde solo dopo che il gioco è stato avviato almeno una volta
    if (kbdHint) kbdHint.classList.toggle('is-hidden', isPlaying);
  }

  function setBtn(iconClass, label, isActive) {
    startIcon.className = `fa-solid ${iconClass}`;
    startLabel.textContent = label;
    startBtn.classList.toggle('is-active', !!isActive);
  }

  startBtn.addEventListener('click', () => {
    playSound('button');
    if (state === 'IDLE' || state === 'PAUSED') {
      state = 'PLAYING';
      setBtn('fa-pause', 'Pausa · Punteggio: ' + score, false);
      lastTime = performance.now();
      updateUIVisibility();
    } else if (state === 'PLAYING') {
      state = 'PAUSED';
      setBtn('fa-play', 'Riprendi · ' + score + ' pt', true);
      updateUIVisibility();
    } else if (state === 'GAME_OVER' || state === 'WON') {
      // Reset: pezzi tornano bianchi, bordo canvas torna al colore base
      unlockedCount = 0;
      canvas.style.borderColor = '';
      canvas.style.boxShadow   = '';
      board = createBoard();
      score = 0;
      dropInterval = 1000;
      resetPlayer();
      state = 'PLAYING';
      setBtn('fa-pause', 'Pausa · Punteggio: 0', false);
      lastTime = performance.now();
      updateUIVisibility();
    }
  });

  function createBoard() {
    return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
  }
  function createPiece() {
    return PIECES[Math.floor(Math.random() * 7) + 1];
  }
  function resetPlayer() {
    player.matrix = createPiece();
    player.pos.y  = 0;
    player.pos.x  = Math.floor(COLS / 2) - Math.floor(player.matrix[0].length / 2);
    if (collide(board, player)) {
      state = 'GAME_OVER';
      setBtn('fa-rotate-right', 'Gioca Ancora', true);
      updateUIVisibility();
    }
  }
  function collide(b, p) {
    const { matrix, pos } = p;
    for (let y = 0; y < matrix.length; y++) {
      for (let x = 0; x < matrix[y].length; x++) {
        if (matrix[y][x] !== 0) {
          const by = y + pos.y, bx = x + pos.x;
          if (by >= ROWS || bx < 0 || bx >= COLS || (b[by] && b[by][bx] !== 0)) return true;
        }
      }
    }
    return false;
  }
  function merge() {
    player.matrix.forEach((row, y) => {
      row.forEach((val, x) => {
        if (val !== 0) board[y + player.pos.y][x + player.pos.x] = val;
      });
    });
    cycleColor();
    playSound('dot');
  }
  function rotate(matrix, dir) {
    const t = matrix[0].map((_, i) => matrix.map(r => r[i]));
    return dir > 0 ? t.map(r => r.reverse()) : t.reverse();
  }
  function playerRotate() {
    const origPos = player.pos.x;
    let offset = 1;
    player.matrix = rotate(player.matrix, 1);
    while (collide(board, player)) {
      player.pos.x += offset;
      offset = -(offset + (offset > 0 ? 1 : -1));
      if (Math.abs(offset) > player.matrix[0].length + 1) {
        player.matrix = rotate(player.matrix, -1);
        player.pos.x  = origPos;
        return;
      }
    }
  }
  function playerDrop() {
    player.pos.y++;
    if (collide(board, player)) {
      player.pos.y--;
      merge();
      resetPlayer();
      sweep();
    }
    dropCounter = 0;
  }
  function playerMove(dir) {
    player.pos.x += dir;
    if (collide(board, player)) player.pos.x -= dir;
  }
  function sweep() {
    let mult = 1;
    outer: for (let y = ROWS - 1; y >= 0; y--) {
      for (let x = 0; x < COLS; x++) {
        if (board[y][x] === 0) continue outer;
      }
      board.splice(y, 1);
      board.unshift(new Array(COLS).fill(0));
      y++;
      score += 10 * mult;
      mult  *= 2;
      playSound('line');
      dropInterval = Math.max(180, 1000 - score * 1.6);
      updateUnlockedColors();
      // Aggiorna testo bottone con punteggio corrente
      if (state === 'PLAYING') {
        setBtn('fa-pause', 'Pausa · Punteggio: ' + score, false);
      }
      if (score >= 200 && state === 'PLAYING') {
        state = 'WON';
        setBtn('fa-rotate-right', 'Gioca Ancora · ' + score + ' pt', true);
        updateUIVisibility();
      }
    }
  }

  function drawBlock(matrix, offX, offY) {
    matrix.forEach((row, y) => {
      row.forEach((val, x) => {
        if (val === 0) return;
        const c = getPieceColor(val);
        ctx.fillStyle = c;
        ctx.fillRect((x + offX) * BLOCK, (y + offY) * BLOCK, BLOCK - 1, BLOCK - 1);
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.fillRect((x + offX) * BLOCK, (y + offY) * BLOCK, BLOCK - 1, 3);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect((x + offX) * BLOCK, (y + offY + 1) * BLOCK - 4, BLOCK - 1, 4);
      });
    });
  }
  function drawGhost() {
    const ghost = { pos: { ...player.pos }, matrix: player.matrix };
    while (!collide(board, ghost)) ghost.pos.y++;
    ghost.pos.y--;
    ghost.matrix.forEach((row, y) => {
      row.forEach((val, x) => {
        if (val !== 0) {
          ctx.strokeStyle = 'rgba(255,255,255,0.16)';
          ctx.lineWidth   = 1;
          ctx.strokeRect(
            (x + ghost.pos.x) * BLOCK + 0.5,
            (y + ghost.pos.y) * BLOCK + 0.5,
            BLOCK - 2, BLOCK - 2
          );
        }
      });
    });
  }
  function draw() {
    ctx.fillStyle = '#080b10';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth   = 0.5;
    for (let y = 0; y < ROWS; y++) {
      ctx.beginPath(); ctx.moveTo(0, y * BLOCK); ctx.lineTo(canvas.width, y * BLOCK); ctx.stroke();
    }
    for (let x = 0; x < COLS; x++) {
      ctx.beginPath(); ctx.moveTo(x * BLOCK, 0); ctx.lineTo(x * BLOCK, canvas.height); ctx.stroke();
    }
    if (state === 'IDLE') {
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#58a6ff';
      ctx.font      = '14px "Press Start 2P", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('TETRIS', canvas.width / 2, canvas.height / 2 - 22);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font      = '9px "Space Grotesk", sans-serif';
      ctx.fillText('Raggiungi 200 punti!', canvas.width / 2, canvas.height / 2 + 2);
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.font      = '8px "Space Grotesk", sans-serif';
      ctx.fillText('Premi il bottone per iniziare', canvas.width / 2, canvas.height / 2 + 18);
      return;
    }
    drawBlock(board, 0, 0);
    if (player.matrix && (state === 'PLAYING' || state === 'PAUSED')) {
      drawGhost();
      drawBlock(player.matrix, player.pos.x, player.pos.y);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font      = '11px "Space Grotesk", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`SCORE: ${score}`, 6, 18);

    const overlays = {
      PAUSED:    { bg: 'rgba(0,0,0,0.72)', color: '#EDB12E', text: 'IN PAUSA',  sub: 'Premi il bottone per riprendere' },
      GAME_OVER: { bg: 'rgba(0,0,0,0.85)', color: '#f73b3b', text: 'GAME OVER', sub: `Punteggio: ${score}` },
      WON:       { bg: 'rgba(0,0,0,0.78)', color: '#00e676', text: 'VITTORIA!', sub: `Punteggio: ${score}` }
    };
    const ov = overlays[state];
    if (ov) {
      ctx.fillStyle = ov.bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = ov.color;
      ctx.font      = '13px "Press Start 2P", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(ov.text, canvas.width / 2, canvas.height / 2 - (ov.sub ? 14 : 0));
      if (ov.sub) {
        ctx.fillStyle = 'rgba(255,255,255,0.65)';
        ctx.font      = '10px "Space Grotesk", sans-serif';
        ctx.fillText(ov.sub, canvas.width / 2, canvas.height / 2 + 10);
      }
    }
  }

  function loop(time = 0) {
    requestAnimationFrame(loop);
    if (state === 'PLAYING') {
      const delta = time - lastTime;
      lastTime    = time;
      dropCounter += delta;
      if (dropCounter > dropInterval) playerDrop();
    } else {
      if (state === 'PAUSED') lastTime = time;
    }
    draw();
  }

  // MODIFICA: tastiera corretta — Space mette in pausa/riprende (non drop)
  document.addEventListener('keydown', e => {
    if (state !== 'PLAYING' && state !== 'PAUSED') return;
    // Previeni scroll della pagina solo se il canvas è in viewport
    if ([37, 38, 39, 40].includes(e.keyCode)) {
      const rect = canvas.getBoundingClientRect();
      if (rect.bottom > 0 && rect.top < window.innerHeight) e.preventDefault();
    }
    if      (e.keyCode === 37) { if (state === 'PLAYING') playerMove(-1); }
    else if (e.keyCode === 39) { if (state === 'PLAYING') playerMove(1); }
    else if (e.keyCode === 40) { if (state === 'PLAYING') playerDrop(); }
    else if (e.keyCode === 38) { if (state === 'PLAYING') playerRotate(); }
    // MODIFICA: Space → pausa/riprendi (era drop nel codice originale via hint, ma il comportamento era già pausa)
    else if (e.keyCode === 32) {
      e.preventDefault();
      if (state === 'PLAYING') {
        state = 'PAUSED';
        setBtn('fa-play', 'Riprendi · ' + score + ' pt', true);
        updateUIVisibility();
      } else if (state === 'PAUSED') {
        state = 'PLAYING';
        lastTime = performance.now();
        setBtn('fa-pause', 'Pausa · Punteggio: ' + score, false);
        updateUIVisibility();
      }
    }
  }, { passive: false });

  resetPlayer();
  loop();
}