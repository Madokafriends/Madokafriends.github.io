(function(){
  'use strict';
  const $=id=>document.getElementById(id),M=YbPr,G=YbPrGraphics,D=YbPrData;
  const diagnosticUI=new YbPrDiagnosticUI();
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  let config={...M.defaults},model,ionActivity,playing=false,mode='spatial',selected=-1,positions=[];
  let pulses=[],view={yaw:-.65,pitch:.42,zoom:1,links:true,palette:'mineral',material:'matte'},lastFrame=performance.now(),budget=0,lastUI=0;
  let guideStep=3,queuedChanges={};
  // Preserve the pre-selector-removal plot: Pr excited-state absorption, series B.
  const recordedScan=D.archive.find(d=>d.id===32);
  if(!recordedScan)throw new Error('Recorded population baseline is unavailable.');
  let guideVisible=false,guideStart=performance.now(),lastGuideFrame=0;
  function pumpOffMessage(){return playing?
    'Pump is off (I = 0). Residual excitations evolve through transfer and relaxation; no new GSA or ESA events occur.':
    'Pump is off (I = 0). The ion configuration is held while paused. Choose Run or Single event to follow the remaining relaxation.';}
  function setPlaying(value){playing=value;budget=0;$('run').textContent=value?'Pause simulation Ⅱ':'Run simulation ▷';$('status').textContent=value?'Running':'Paused';$('status').style.color=value?G.C.yb:G.C.gold;
    if(config.intensity===0)$('segmentNote').textContent=pumpOffMessage();}
  function fresh(c=config){
    setPlaying(false);config={...c};model=new M.KMC(M.graph(config),config,D.source);
    ionActivity=new YbPrIonActivity(model);$('inspectIon').max=model.ions.length-1;
    selected=model.ions.findIndex(a=>a.s===2);if(selected<0&&model.ions.length)selected=0;pulses=[];positions=[];
    $('geometryTag').textContent='Hexagonal host · Spherical fragment';
    $('segmentNote').textContent=model.nP?'All ions initially occupy their ground states. Parameter changes preserve the configuration and restart the measurement segment.':'This seed produced no Pr³⁺ ions. Increase the radius or Pr³⁺ fraction to include an emitter.';
    syncControls();updateDiagnostics();refresh();draw();
  }
  function syncControls(){
    $('intensityNumber').value=config.intensity;$('intensity').value=Math.log10(Math.max(.5,config.intensity));
    $('pumpOff').disabled=config.intensity===0;
    ['feedback','migration','mpr','esa'].forEach(k=>{$(k).value=config[k];$(k+'Value').textContent=config[k].toFixed(2)+'×';});
    $('gsa').value=Math.log10(config.gsa);$('gsaValue').textContent=config.gsa.toFixed(2)+'×';
    $('latticeA').value=config.a*5;$('latticeC').value=config.c*5;$('cutoff').value=config.cutoff*5;
    $('radius').value=config.radius;$('seed').value=config.seed;
    $('fractionYb').value=config.fractionYb*100;$('fractionPr').value=config.fractionPr*100;
    $('parameterProfile').value=Object.entries(M.profiles).find(([,p])=>config.geometry==='hex'&&p.a===config.a&&p.c===config.c&&p.cutoff===config.cutoff&&p.fractionPr===config.fractionPr&&p.fractionYb===config.fractionYb)?.[0]||'custom';
  }
  function change(c,note='Parameters changed: the ion configuration is retained; the physical clock and statistics start a new segment.'){
    if(!Object.entries(c).some(([key,value])=>config[key]!==value))return;
    config={...config,...c};model.setConfig(c);ionActivity.reset(model);pulses=[];budget=0;syncControls();updateDiagnostics();refresh();$('segmentNote').textContent=config.intensity===0?pumpOffMessage()+' A new measurement segment has started.':note;
  }
  function updateDiagnostics(){
    diagnosticUI.update(model);
  }
  function advance(n,maxMilliseconds=8){
    const start=performance.now();let done=0,event=null;
    for(;done<n;done++){
      event=model.step();if(!event){setPlaying(false);
        const darkGround=config.intensity===0&&model.populations().every(n=>n===0);
        $('status').textContent=darkGround?'Ground state':'No active events';
        if(darkGround)$('segmentNote').textContent='Pump-off relaxation is complete: all ions occupy their ground states. The simulation clock stops at the last event.';
        break;}
      ionActivity.record(event);
      if(event.kind!=='MIGRATION'||done%32===0){
        pulses.push({e:event,born:performance.now()});
      }
      if(done%128===0&&performance.now()-start>=maxMilliseconds){done++;break;}
    }
    pulses=pulses.slice(-45);if(done){model.sample();displayEvent(model.last);}
    return done;
  }
  function displayEvent(e){
    if(!e)return;const ch=M.channels[e.kind];$('eventType').textContent=G.ionText(ch.label);$('eventType').style.color=G.channelColor(e.kind);
    $('eventTime').textContent='Δt = '+G.time(e.dt)+' · event '+model.events.toLocaleString('en-US');
  }
  function inspect(){
    if(selected<0||!model.ions[selected])return;
    const a=model.ions[selected],n=model.edges.filter(e=>e.i===selected||e.j===selected);
    const names=M.levelNames[a.s];
    const partners=n.map(e=>model.ions[e.i===selected?e.j:e.i]);
    const y=partners.filter(p=>p.s===1).length,p=partners.length-y;
    const rate=model.incident[selected].reduce((v,i)=>v+model.rates[i],0);
    $('inspector').textContent=`${a.s===1?'Yb³⁺':'Pr³⁺'} #${selected} · ${names[a.level]}. ${y} Yb³⁺ and ${p} Pr³⁺ neighbours; depth ${(a.depth*.5).toFixed(2)} nm. Incident event rate: ${G.compact(rate)} s⁻¹.`;
    if(document.activeElement!==$('inspectIon'))$('inspectIon').value=selected;
    const stats=ionActivity.summary(selected,model.t),last=stats.last;
    $('ionActivity').textContent=`Current segment · ${stats.changes.toLocaleString('en-US')} level changes${a.s===2?' · '+stats.emissions.toLocaleString('en-US')+' upper-state emissions':''}. `+
      (last?`Last transition: ${names[last.from]} → ${names[last.to]} at ${G.time(last.t)}. `:'No recorded transition. ')+
      `Current level occupied for ${G.time(stats.age)} within this segment.`;
  }
  function selectIon(commit=false){
    const raw=$('inspectIon').value,id=Number(raw);
    if(raw!==''&&Number.isInteger(id)&&id>=0&&id<model.ions.length){selected=id;inspect();draw();}
    else if(commit)$('inspectIon').value=selected;
  }
  $('inspectIon').addEventListener('input',()=>selectIon());
  $('inspectIon').addEventListener('change',()=>selectIon(true));
  function refresh(){
    const p=model.populations();$('physicalTime').textContent=G.time(model.t);
    $('timeSeconds').textContent=model.t.toLocaleString('en-US',{maximumSignificantDigits:6})+' s · current segment';
    $('nYb').textContent=p[0];$('nPr').textContent=p[2];$('photons').textContent=model.counts.PR_DECAY_20.toLocaleString('en-US');
    $('ybFraction').textContent=`of ${model.nY} Yb³⁺ ions`;$('prFraction').textContent=`¹G₄: ${p[1]} · total Pr³⁺: ${model.nP}`;
    $('eventsTotal').textContent=model.events.toLocaleString('en-US')+(model.events===1?' event':' events');
    if(!model.last){$('eventType').textContent='Ready for excitation';$('eventType').style.color=G.C.yb;$('eventTime').textContent='Gillespie waiting times';}
    inspect();G.trace($('trace'),model);G.events($('events'),model);G.activity($('activity'),model);
  }
  function draw(now=performance.now()){
    pulses=pulses.filter(p=>now-p.born<900);
    if(mode==='spatial')positions=G.spatial($('crystal'),model,view,reduced?[]:pulses,selected,now);
  }
  function render(now){
    const elapsed=Math.min(.1,(now-lastFrame)/1000);lastFrame=now;
    if(playing&&!document.hidden){budget+=elapsed*Number($('speed').value);const n=Math.min(20000,Math.floor(budget));
      if(n){try{const done=advance(n);budget=Math.min(budget-done,Number($('speed').value)*.1);}catch(error){setPlaying(false);$('segmentNote').textContent='Simulation stopped: '+error.message;console.error(error);}}}
    if(!document.hidden){draw(now);if(now-lastUI>180){refresh();lastUI=now;}}
    if(guideVisible&&!$('pathwaysPanel').hidden&&!document.hidden&&!reduced&&guideStep!==0&&now-lastGuideFrame>32){G.guide($('guide'),guideStep,Math.min(1,((now-guideStart)%2600)/1700));lastGuideFrame=now;}
    requestAnimationFrame(render);
  }
  $('run').addEventListener('click',()=>{flushChanges();setPlaying(!playing);});
  $('step').addEventListener('click',()=>{flushChanges();setPlaying(false);advance(1,100);refresh();draw();});
  $('reset').addEventListener('click',()=>{flushChanges();setPlaying(false);model.reset();ionActivity.reset(model);pulses=[];refresh();$('segmentNote').textContent='Ground-state initial condition restored with the same lattice and kinetic seed.';});
  $('seedG4').addEventListener('click',()=>{flushChanges();setPlaying(false);model.reset(true);ionActivity.reset(model);pulses=[];refresh();$('segmentNote').textContent=model.nP?'Prepared initial condition: one Pr³⁺ ion is placed in ¹G₄ at t = 0. Subsequent events follow the unchanged rates.':'There is no Pr³⁺ ion in this nanoparticle; no excitation was prepared.';});
  $('speed').addEventListener('change',()=>{budget=0;});
  let sliderTimer;
  function flushChanges(){
    clearTimeout(sliderTimer);
    if(Object.keys(queuedChanges).length){const c=queuedChanges;queuedChanges={};change(c);}
  }
  function queueChanges(c){queuedChanges={...queuedChanges,...c};clearTimeout(sliderTimer);sliderTimer=setTimeout(flushChanges,90);}
  function intensity(I){if(!Number.isFinite(I))return;change({intensity:Math.max(0,Math.min(500,I))});}
  $('intensity').addEventListener('input',()=>{const I=Math.min(500,Number((10**Number($('intensity').value)).toFixed(2)));$('intensityNumber').value=I;queueChanges({intensity:I});});
  $('intensityNumber').addEventListener('change',()=>{const I=Number($('intensityNumber').value);flushChanges();intensity(I);});
  $('intensityNumber').addEventListener('input',()=>{const raw=$('intensityNumber').value,I=Number(raw);if(raw!==''&&Number.isFinite(I)&&I>=0&&I<=500)queueChanges({intensity:I});});
  $('pumpOff').addEventListener('click',()=>{flushChanges();intensity(0);});
  ['feedback','migration','mpr','esa'].forEach(k=>$(k).addEventListener('input',()=>{const value=Number($(k).value);$(k+'Value').textContent=value.toFixed(2)+'×';queueChanges({[k]:value});}));
  $('gsa').addEventListener('input',()=>{const value=10**Number($('gsa').value);$('gsaValue').textContent=value.toFixed(2)+'×';queueChanges({gsa:value});});
  $('parameterProfile').addEventListener('change',()=>{
    const p=M.profiles[$('parameterProfile').value];if(!p)return;flushChanges();fresh({...config,...p,geometry:'hex'});
    $('segmentNote').textContent='Geometry preset applied to the live fragment. Stored curves are independent of these controls.';
  });
  $('rebuild').addEventListener('click',()=>{
    const radius=Number($('radius').value),seed=Number($('seed').value),y=Number($('fractionYb').value),p=Number($('fractionPr').value);
    const a=Number($('latticeA').value)/5,c=Number($('latticeC').value)/5,cutoff=Number($('cutoff').value)/5,geometry='hex';
    if(![radius,seed,y,p,a,c,cutoff].every(Number.isFinite)||radius<3||radius>8||seed<0||seed>999999||y<2||y>40||p<.1||p>5||a<.5||a>2||c<.3||c>2||cutoff<.5||cutoff>2){
      $('segmentNote').textContent='Use radius 3–8; a 2.5–10 Å; c 1.5–10 Å; cutoff 2.5–10 Å; Yb³⁺ 2–40%; Pr³⁺ 0.1–5%; seed 0–999999.';return;}
    flushChanges();fresh({...config,radius,a,c,cutoff,seed:Math.floor(seed),fractionYb:y/100,fractionPr:p/100,geometry});
    if(model.nP)$('segmentNote').textContent='New solid spherical lattice crop; all ions start in their ground states.';
  });
  function setView(value){
    mode=value;
    $('spatialView').setAttribute('aria-pressed',String(value==='spatial'));
    $('levelView').setAttribute('aria-pressed',String(value==='mechanism'));
    $('spatialPanel').hidden=value!=='spatial';$('spatialTools').hidden=value!=='spatial';
    $('mechanism').hidden=value!=='mechanism';
    if(value==='mechanism')G.guide($('guide'),guideStep);else draw();
  }
  $('spatialView').addEventListener('click',()=>setView('spatial'));
  $('levelView').addEventListener('click',()=>setView('mechanism'));
  function setLevelDiagram(spectroscopic){
    $('pathwaysPanel').hidden=spectroscopic;$('spectroscopyPanel').hidden=!spectroscopic;
    $('pathwaysView').setAttribute('aria-pressed',String(!spectroscopic));
    $('spectroscopyView').setAttribute('aria-pressed',String(spectroscopic));
    if(!spectroscopic){guideStart=performance.now();G.guide($('guide'),guideStep);}
  }
  $('pathwaysView').addEventListener('click',()=>setLevelDiagram(false));
  $('spectroscopyView').addEventListener('click',()=>setLevelDiagram(true));
  window.addEventListener('hashchange',()=>{if(location.hash==='#mechanism')setView('mechanism');});
  function setAppearance(){
    view.palette=$('ionPalette').value;view.material=$('ionMaterial').value;
    const p=G.palettes[view.palette];
    Object.assign(G.C,{yb:p.yb,p1:p.p1,p2:p.p2});
    for(const [key,color]of Object.entries({cyan:p.yb,peach:p.p1,violet:p.p2,ground:p.groundYb}))document.documentElement.style.setProperty('--'+key,color);
    draw();refresh();G.guide($('guide'),guideStep);updateDiagnostics();drawArchive();
    if(model.last)displayEvent(model.last);
  }
  $('ionPalette').addEventListener('change',setAppearance);
  $('ionMaterial').addEventListener('change',setAppearance);
  $('showLinks').addEventListener('change',()=>{view.links=$('showLinks').checked;draw();});
  $('homeView').addEventListener('click',()=>{view={...view,yaw:-.65,pitch:.42,zoom:1};draw();});
  let drag=null;
  $('crystal').addEventListener('pointerdown',e=>{if(mode!=='spatial')return;drag={x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY,moved:0};$('crystal').setPointerCapture(e.pointerId);});
  $('crystal').addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.lastX,dy=e.clientY-drag.lastY;
    drag.moved+=Math.abs(dx)+Math.abs(dy);view.yaw+=dx*.008;view.pitch=Math.max(-1.35,Math.min(1.35,view.pitch+dy*.008));drag.lastX=e.clientX;drag.lastY=e.clientY;});
  $('crystal').addEventListener('pointerup',e=>{if(!drag)return;
    if(drag.moved<7){const b=$('crystal').getBoundingClientRect(),x=e.clientX-b.left,y=e.clientY-b.top;
      let nearest=-1,dist=15;positions.forEach((p,i)=>{const d=Math.hypot(x-p[0],y-p[1]);if(d<dist){dist=d;nearest=i;}});
      if(nearest>=0){selected=nearest;inspect();}}
    drag=null;
  });
  $('crystal').addEventListener('pointercancel',()=>{drag=null;});
  $('crystal').addEventListener('wheel',e=>{if(mode!=='spatial')return;e.preventDefault();view.zoom=Math.max(.65,Math.min(2.5,view.zoom*Math.exp(-e.deltaY*.001)));},{passive:false});
  function setGuide(i){guideStep=i;guideStart=performance.now();
    document.querySelectorAll('[data-guide]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.guide)===i)));G.guide($('guide'),i);}
  document.querySelectorAll('[data-guide]').forEach(b=>b.addEventListener('click',()=>setGuide(Number(b.dataset.guide))));
  function drawArchive(){
    G.archive($('archiveChart'),recordedScan,false,-1,'populations');
  }
  new IntersectionObserver(entries=>{guideVisible=entries[0].isIntersecting;},{threshold:.1}).observe($('guide'));
  const resize=new ResizeObserver(()=>{if(!model)return;draw();refresh();G.guide($('guide'),guideStep);updateDiagnostics();drawArchive();});
  resize.observe(document.querySelector('.page'));
  window.addEventListener('resize',()=>{draw();refresh();G.guide($('guide'),guideStep);updateDiagnostics();drawArchive();});
  document.addEventListener('visibilitychange',()=>{budget=0;lastFrame=performance.now();});
  fresh();setGuide(3);setAppearance();
  if(location.hash==='#mechanism')setView('mechanism');
  requestAnimationFrame(render);
})();
