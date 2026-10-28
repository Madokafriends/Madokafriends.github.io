/* Spatial Gillespie model. No rendering dependencies. */
(function (root) {
  'use strict';
  const kinds = ['YB_PUMP','YB_DECAY','PR_PUMP_01','PR_PUMP_12',
    'PR_DECAY_10','PR_DECAY_20','PR_DECAY_21',
    'MIGRATION','ETU_FORWARD','BACK_TRANSFER'];
  const channels = {
    YB_PUMP: {label:'Yb ground-state absorption', family:'pump', color:'#dfc48b'},
    PR_PUMP_01: {label:'Pr ground-state absorption', family:'pump', color:'#dfc48b'},
    PR_PUMP_12: {label:'Pr excited-state absorption', family:'esa', color:'#dfc48b'},
    YB_DECAY: {label:'Yb radiative decay', family:'loss', color:'#718ca6'},
    PR_DECAY_10: {label:'Pr intermediate-state relaxation', family:'loss', color:'#718ca6'},
    PR_DECAY_20: {label:'Pr upconversion emission', family:'emission', color:'#c2a1ff'},
    PR_DECAY_21: {label:'Pr upper-state relaxation', family:'loss', color:'#718ca6'},
    MIGRATION: {label:'Yb–Yb excitation migration', family:'migration', color:'#68d6dc'},
    ETU_FORWARD: {label:'Yb → Pr energy transfer', family:'transfer', color:'#e9ac7c'},
    BACK_TRANSFER: {label:'Pr → Yb cross-relaxation', family:'feedback', color:'#b9a1ec'},
  };
  // Alternative geometry presets share the same transition rules.
  const profiles = {
    thesis: {a:1,c:.7,cutoff:1,fractionYb:.15,fractionPr:.005},
    table: {a:1,c:.7,cutoff:1,fractionYb:.15,fractionPr:.05},
    archive: {a:1.2,c:.7,cutoff:1.5,fractionYb:.15,fractionPr:.005},
  };
  const defaults = {intensity:100, migration:1, forward:1, feedback:1, mpr:1, esa:1, gsa:1,
    ...profiles.thesis, radius:6.5, geometry:'hex', seed:1234};
  // These are effective kinetic states, not a unique assignment of S2 to D2 or P0.
  const levelNames={1:['²F₇/₂','²F₅/₂'],2:['³H₄','¹G₄','³P₀* · effective upper state']};
  function rng(seed) {
    let a=seed>>>0;
    return () => {
      a=(a+0x6d2b79f5)>>>0;let t=a;
      t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);
      return ((t^(t>>>14))>>>0)/4294967296;
    };
  }
  class Fenwick {
    constructor(n){this.n=n;this.tree=new Float64Array(n+1);this.total=0;}
    add(i,delta){for(let k=i+1;k<=this.n;k+=k&-k)this.tree[k]+=delta;this.total+=delta;}
    find(target){let i=0,bit=1;while(bit*2<=this.n)bit*=2;
      for(;bit;bit>>=1){const j=i+bit;if(j<=this.n&&this.tree[j]<=target){i=j;target-=this.tree[j];}}
      return Math.min(i,this.n-1);
    }
  }
  function graph(config) {
    const c={...defaults,...config}, random=rng(c.seed), ions=[];
    if(c.geometry!=='hex')throw new RangeError('The interactive model supports only the hexagonal host');
    const r=c.radius, lim=Math.ceil(2*r/Math.min(c.a,c.c))+1;let sites=0;
    if(!(r>=1&&r<=12))throw Error('Radius outside supported range');
    if(!(c.a>=.5&&c.c>=.3&&c.cutoff>0&&c.cutoff<=3))throw Error('Invalid lattice dimensions');
    for(let x=-lim;x<=lim;x++)for(let y=-lim;y<=lim;y++)for(let z=-lim;z<=lim;z++){
      for(let b=0;b<2;b++){
        const p=[c.a*(x+y*.5+b*5/6),c.a*Math.sqrt(3)/2*(y+b/3),c.c*(z+b*.5)];
        const norm=Math.hypot(...p);if(norm>r+1e-9)continue;
        sites++;const u=random(),s=u<c.fractionPr?2:u<c.fractionPr+c.fractionYb?1:0;
        if(s)ions.push({p,s,level:0,depth:Math.max(0,r-norm)});
      }
    }
    const edges=neighbors(ions,c.cutoff);
    return {ions,edges,radius:r,sites,geometry:c.geometry,a:c.a,c:c.c,cutoff:c.cutoff};
  }
  function neighbors(ions,cutoff){
    const edges=[];
    for(let i=0;i<ions.length;i++)for(let j=i+1;j<ions.length;j++){
      if(ions[i].s===2&&ions[j].s===2)continue;
      const d=Math.hypot(...ions[i].p.map((p,k)=>p-ions[j].p[k]));
      if(d>0&&d<=cutoff+1e-9)edges.push({i,j,d});
    }
    return edges;
  }
  class KMC {
    constructor(g,config,source){
      this.g=g;this.ions=g.ions.map(a=>({...a,p:[...a.p]}));this.edges=g.edges;
      this.c={...defaults,...config};this.source=source;this.random=rng(this.c.seed+5678);
      this.nY=this.ions.filter(a=>a.s===1).length;this.nP=this.ions.length-this.nY;
      this.slots=[];this.incident=Array.from(this.ions,()=>[]);
      const add=(kind,ids,d=1)=>{
        const slot={kind,ids,d};const index=this.slots.push(slot)-1;
        for(const i of ids)this.incident[i].push(index);
      };
      this.ions.forEach((a,i)=>(a.s===1?kinds.slice(0,2):kinds.slice(2,7)).forEach(k=>add(k,[i])));
      this.edges.forEach(e=>{
        if(this.ions[e.i].s===this.ions[e.j].s)add('MIGRATION',[e.i,e.j],e.d);
        else {const ids=this.ions[e.i].s===1?[e.i,e.j]:[e.j,e.i];
          add('ETU_FORWARD',ids,e.d);add('BACK_TRANSFER',ids,e.d);}
      });
      this.rates=new Float64Array(this.slots.length);this.tree=new Fenwick(this.slots.length);
      this.resetStats();this.refresh();
    }
    resetStats(){
      this.t=0;this.events=0;this.counts=Object.fromEntries(kinds.map(k=>[k,0]));
      this.integrals=[0,0,0];this.last=null;this.history=[{t:0,p:this.populations()}];
      this.initialActive=this.populations().reduce((a,b)=>a+b,0);
      this.activityHistory=[{t:0,q:this.initialActive}];
    }
    populations(){
      let y=0,p1=0,p2=0;for(const a of this.ions){if(a.s===1)y+=a.level===1;else{p1+=a.level===1;p2+=a.level===2;}}
      return [y,p1,p2];
    }
    rate(slot){
      const {kind,ids,d}=slot,a=this.ions[ids[0]],b=this.ions[ids[1]],p=this.source.pump;
      const dec=this.source.decay,c=this.c,pair=this.source.pair;
      switch(kind){
        case 'YB_PUMP':return a.level===0?p.yb01*c.intensity*c.gsa:0;
        case 'YB_DECAY':return a.level===1?dec.gamma_yb10:0;
        case 'PR_PUMP_01':return a.level===0?p.pr01*c.intensity:0;
        case 'PR_PUMP_12':return a.level===1?p.pr12*c.intensity*c.esa:0;
        case 'PR_DECAY_10':return a.level===1?dec.gamma_pr10-this.source.mpr+this.source.mpr*c.mpr:0;
        case 'PR_DECAY_20':return a.level===2?dec.gamma_pr20:0;
        case 'PR_DECAY_21':return a.level===2?dec.gamma_pr21:0;
        case 'MIGRATION':return a.level!==b.level?pair.migration*c.migration/d**6:0;
        case 'ETU_FORWARD':return a.level===1&&b.level===0?pair.yb_to_pr*c.forward/d**6:0;
        case 'BACK_TRANSFER':return a.level===0&&b.level===2?pair.pr_to_yb*c.feedback/d**6:0;
        default:throw Error('Unknown channel '+kind);
      }
    }
    refresh(indices){
      if(!indices){this.tree=new Fenwick(this.slots.length);this.rates.fill(0);this.activeRateCount=0;indices=this.slots.keys();}
      for(const i of indices){const r=this.rate(this.slots[i]);if(!Number.isFinite(r)||r<0)throw Error('Invalid rate');
        this.activeRateCount+=Number(r>0)-Number(this.rates[i]>0);
        this.tree.add(i,r-this.rates[i]);this.rates[i]=r;}
    }
    setConfig(c){this.c={...this.c,...c};this.refresh();this.resetStats();}
    reset(seedExcitation=false){
      for(const a of this.ions)a.level=0;this.random=rng(this.c.seed+5678);
      if(seedExcitation){const pr=this.ions.find(a=>a.s===2);if(pr)pr.level=1;}
      this.refresh();this.resetStats();
    }
    step(){
      // An absorbing state is determined by actual rates, not a floating-point
      // sum: fast migration can leave a small positive cancellation residual.
      if(this.activeRateCount===0){if(this.tree.total!==0)this.refresh();return null;}
      let total=this.tree.total;if(!(total>0)){this.refresh();total=this.tree.total;}
      const uTime=this.random(),uEvent=this.random();
      let index=this.tree.find(uEvent*total);
      if(!(this.rates[index]>0)){
        // Reuse both uniforms after rebuilding; do not reject/redraw a waiting time.
        this.refresh();total=this.tree.total;index=this.tree.find(uEvent*total);
      }
      if(!(this.rates[index]>0))throw Error('Selected inactive event');
      const dt=-Math.log1p(-uTime)/total,slot=this.slots[index];
      const before=this.populations(),{kind,ids}=slot,a=this.ions[ids[0]],b=this.ions[ids[1]];
      const levels=ids.map(i=>this.ions[i].level);
      switch(kind){
        case 'YB_PUMP':case 'PR_PUMP_01':a.level=1;break;
        case 'PR_PUMP_12':a.level=2;break;
        case 'YB_DECAY':case 'PR_DECAY_10':
        case 'PR_DECAY_20':a.level=0;break;
        case 'PR_DECAY_21':a.level=1;break;
        case 'MIGRATION':{const l=a.level;a.level=b.level;b.level=l;break;}
        case 'ETU_FORWARD':a.level=0;b.level=1;break;
        case 'BACK_TRANSFER':a.level=1;b.level=1;break;
      }
      this.t+=dt;this.events++;this.counts[kind]++;
      // Q counts excited ions, not excitation energy or emitted photons.
      if(['YB_PUMP','PR_PUMP_01','BACK_TRANSFER','YB_DECAY','PR_DECAY_10','PR_DECAY_20'].includes(kind)){
        this.activityHistory.push({t:this.t,q:this.populations().reduce((a,b)=>a+b,0)});
        if(this.activityHistory.length>400)this.activityHistory.shift();
      }
      before.forEach((v,i)=>this.integrals[i]+=v*dt);
      const affected=new Set();for(const i of ids)for(const j of this.incident[i])affected.add(j);
      this.refresh(affected);if(this.events%4096===0)this.refresh();
      this.last={kind,ids:[...ids],before:levels,after:ids.map(i=>this.ions[i].level),dt,t:this.t};
      return this.last;
    }
    sample(){this.history.push({t:this.t,p:this.populations()});if(this.history.length>400)this.history.shift();}
    means(){return this.integrals.map(x=>this.t>0?x/this.t:0);}
    excitationBalance(){
      const seeds=this.counts.YB_PUMP+this.counts.PR_PUMP_01,created=this.counts.BACK_TRANSFER;
      const lost=this.counts.YB_DECAY+this.counts.PR_DECAY_10+this.counts.PR_DECAY_20;
      const active=this.populations().reduce((a,b)=>a+b,0);
      return {initial:this.initialActive,seeds,created,lost,active,residual:active-this.initialActive-seeds-created+lost};
    }
  }
  function coefficients(model){
    let w=0;
    for(const e of model.edges)if(model.ions[e.i].s!==model.ions[e.j].s)w+=e.d**-6;
    return {fY:w*model.source.pair.yb_to_pr*model.c.forward/Math.max(1,model.nY),
      fP:w*model.source.pair.yb_to_pr*model.c.forward/Math.max(1,model.nP),
      bY:w*model.source.pair.pr_to_yb*model.c.feedback/Math.max(1,model.nY),
      bP:w*model.source.pair.pr_to_yb*model.c.feedback/Math.max(1,model.nP)};
  }
  // Uncorrelated, species-homogeneous closure. Yb migration cancels in this closure.
  function equilibrium(model,I,feedback=true,co=coefficients(model)){
    if(I<=0)return {y:0,p1:0,p2:0,emission:0,residual:0};
    const s=model.source,c=model.c,gy=s.decay.gamma_yb10;
    const g1=s.decay.gamma_pr10-s.mpr+s.mpr*c.mpr,g2=s.decay.gamma_pr20;
    const a=s.pump.pr12*I*c.esa,by=feedback?co.bY:0,bp=feedback?co.bP:0;
    const populations=y=>{
      const source=s.pump.pr01*I+co.fP*y,u=a/(g2+s.decay.gamma_pr21+bp*(1-y));
      const p1=source/(source*(1+u)+g1+g2*u),p2=u*p1;
      return {p1,p2,p0:1-p1-p2};
    };
    const balance=y=>{const p=populations(y);return s.pump.yb01*I*c.gsa*(1-y)-gy*y-co.fY*y*p.p0+by*(1-y)*p.p2;};
    // Choose the first stable root from the ground-state side; no fitted threshold.
    let lo=0,hi=1,previous=0;
    for(let k=0;k<=240;k++){const y=k===240?1:10**(-14+14*k/240);
      if(balance(y)<=0){lo=previous;hi=y;break;}previous=y;}
    for(let k=0;k<70;k++){const mid=(lo+hi)/2;if(balance(mid)>0)lo=mid;else hi=mid;}
    const y=(lo+hi)/2,p=populations(y);
    return {y,p1:p.p1,p2:p.p2,emission:g2*model.nP*p.p2,residual:balance(y)};
  }
  function response(model){
    const co=coefficients(model),points=Array.from({length:110},(_,i)=>{
      const I=10**(-.3+3*i/109);
      return {I,on:equilibrium(model,I,true,co).emission,off:equilibrium(model,I,false,co).emission};
    });
    return points;
  }
  const api={defaults,profiles,levelNames,kinds,channels,rng,Fenwick,graph,neighbors,KMC,coefficients,equilibrium,response};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.YbPr=api;
})(globalThis);
