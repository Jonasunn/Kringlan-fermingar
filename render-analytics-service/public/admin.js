async function getJSON(url){
  const r = await fetch(url);
  const j = await r.json();
  if(!r.ok) throw new Error(j?.error || "Request failed");
  return j;
}

function funnelSVG(steps){
  const w=900, h=220;
  const topW=820, bottomW=240;
  const n=steps.length;
  const segH=h/n;

  const pts=[];
  for(let i=0;i<=n;i++){
    const t=i/n;
    const width=topW*(1-t)+bottomW*t;
    const y=i*segH;
    const x0=(w-width)/2;
    const x1=x0+width;
    pts.push({y,x0,x1});
  }
  let d="";
  for(let i=0;i<n;i++){
    const p0=pts[i], p1=pts[i+1];
    d += `M ${p0.x0} ${p0.y} L ${p0.x1} ${p0.y} L ${p1.x1} ${p1.y} L ${p1.x0} ${p1.y} Z `;
  }
  const labels = steps.map((s,i)=>{
    const y=(i+0.5)*segH;
    return `<text x="24" y="${y}" font-size="20" fill="rgba(17,17,17,.75)">${s.label}: ${s.value}</text>`;
  }).join("");
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><path d="${d}" fill="rgba(47,212,162,.75)"></path>${labels}</svg>`;
}

async function fillFilters(){
  const meta = await getJSON("/api/meta");
  const c = document.getElementById("campaign");
  const g = document.getElementById("game");
  c.innerHTML = `<option value="">All</option>` + meta.campaigns.map(x=>`<option value="${x}">${x}</option>`).join("");
  g.innerHTML = `<option value="">All</option>` + meta.games.map(x=>`<option value="${x}">${x}</option>`).join("");
}

async function load(){
  await fillFilters();

  async function render(){
    const days = document.getElementById("days").value;
    const campaign = document.getElementById("campaign").value;
    const game = document.getElementById("game").value;
    const qs = new URLSearchParams({ days, ...(campaign?{campaign_id:campaign}:{}) , ...(game?{game_id:game}:{}) });
    const stats = await getJSON(`/api/stats?${qs.toString()}`);

    document.getElementById("kpis").innerHTML = `
      <div class="kpi"><div class="label">Views</div><div class="value">${stats.totals.views.toLocaleString()}</div></div>
      <div class="kpi"><div class="label">Starts</div><div class="value">${stats.totals.starts.toLocaleString()}</div></div>
      <div class="kpi"><div class="label">Wins</div><div class="value">${stats.totals.wins.toLocaleString()}</div></div>
      <div class="kpi"><div class="label">Registrations</div><div class="value">${stats.totals.regs.toLocaleString()}</div></div>
    `;

    document.getElementById("funnel").innerHTML = funnelSVG(stats.funnel);
    document.getElementById("rates").textContent =
      `Win rate: ${(stats.rates.winRate*100).toFixed(1)}% · Reg/Starts: ${(stats.rates.regRateFromStarts*100).toFixed(1)}% · Reg/Wins: ${(stats.rates.regRateFromWins*100).toFixed(1)}%`;

    const labels = stats.series.map(s => s.date.slice(5));
    const views = stats.series.map(s => s.views);
    const starts = stats.series.map(s => s.starts);
    const wins = stats.series.map(s => s.wins);
    const regs = stats.series.map(s => s.regs);

    const ctx = document.getElementById("line");
    if (window.__chart) window.__chart.destroy();
    window.__chart = new Chart(ctx, {
      type:"line",
      data:{ labels, datasets:[
        {label:"Views", data:views, tension:.2},
        {label:"Starts", data:starts, tension:.2},
        {label:"Wins", data:wins, tension:.2},
        {label:"Registrations", data:regs, tension:.2}
      ]},
      options:{ responsive:true, plugins:{ legend:{ display:true } } }
    });
  }

  document.getElementById("apply").addEventListener("click", render);
  render();
}

load().catch(err => {
  document.body.innerHTML = `<pre style="padding:16px;">${err.message}</pre>`;
});
