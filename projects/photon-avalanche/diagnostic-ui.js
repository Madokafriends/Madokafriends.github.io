(function(root){
  'use strict';
  const $=id=>document.getElementById(id),M=YbPr,K=YbPrDiagnostics,G=YbPrGraphics;
  const tickLog=(min,max)=>Array.from({length:9},(_,i)=>10**(Math.floor(Math.log10(min))+i)).filter(v=>v>=min&&v<=max);
  const peakIntensity=I=>I<1?'< 1':'≈ '+Math.round(I).toLocaleString('en-US');
  class DiagnosticUI {
    constructor(){
      this.model=null;this.key='';this.transientKey='';this.job=0;this.points=[];this.peak=null;this.started=false;
      $('runRiseScan').addEventListener('click',()=>this.scan());
      $('cancelRiseScan').addEventListener('click',()=>this.cancel('Cancelled · partial results retained'));
      $('riseFraction').addEventListener('change',()=>{this.transientKey='';this.update(this.model);this.scan();});
      for(const id of ['scanMin','scanMax'])$(id).addEventListener('change',()=>{this.cancel('Range changed · run a new scan');this.points=[];this.peak=null;this.drawScan();});
    }
    cancel(message){this.job++;$('riseReadout').textContent=message;$('runRiseScan').disabled=false;$('cancelRiseScan').hidden=true;}
    update(model){
      if(!model)return;this.model=model;
      const {intensity,...c}=model.c,key=JSON.stringify([c,model.nY,model.nP,model.edges.length]);
      if(this.key&&key!==this.key){this.cancel('Parameters changed · run a new scan');this.points=[];this.peak=null;$('riseReadout').textContent='The previous scan used different rates or geometry. Recompute to compare the current parameters.';}
      this.key=key;
      const fraction=Number($('riseFraction').value),transientKey=key+':'+intensity+':'+fraction;
      if(this.transientKey!==transientKey){
        this.transientKey=transientKey;
        const options={fraction,record:false,maxSteps:50000};
        this.on=K.turnOn(model,intensity,{...options,feedback:true});
        this.off=K.turnOn(model,intensity,{...options,feedback:false});
        this.onTrace=K.turnOn(model,intensity,{fraction:.995,feedback:true,maxSteps:50000});
        this.offTrace=K.turnOn(model,intensity,{fraction:.995,feedback:false,maxSteps:50000});
      }
      $('transientIntensity').textContent=`I = ${G.compact(intensity)} kW cm⁻² · homogeneous reference`;
      this.drawTransient();this.drawScan();
      if(!this.started){this.started=true;this.scan();}
    }
    drawTransient(){
      if(!this.onTrace)return;
      const series=[{r:this.onTrace,color:G.C.p2,dash:[]},{r:this.offTrace,color:G.C.muted,dash:[5,4]}];
      const end=Math.max(1e-6,...series.map(s=>s.r.trace.at(-1)?.t||0));
      const scale=end<.001?1e6:end<1?1000:1,unit=scale===1e6?'µs':scale===1000?'ms':'s';
      const f=G.chart($('transientChart'),{xmax:end*scale,ymax:1.05,xlabel:`Time after pump onset / ${unit}`,ylabel:'R(t) / R(∞)',yticks:[0,.25,.5,.75,1]});
      if(!f)return;
      const fraction=Number($('riseFraction').value);
      G.line(f.ctx,[[f.l,f.y(fraction)],[f.r,f.y(fraction)]],G.C.gold+'80',1,[2,4]);
      for(const s of series){
        if(!(s.r.steady.p2>0))continue;
        G.line(f.ctx,s.r.trace.map(p=>[f.x(p.t*scale),f.y(p.p[2]/s.r.steady.p2)]),s.color,1.9,s.dash);
      }
      if(this.on.status==='reached')G.dot(f.ctx,f.x(this.on.riseTime*scale),f.y(fraction),4,G.C.gold);
      else G.text(f.ctx,'No resolved rise time at the selected intensity.',(f.l+f.r)/2,(f.t+f.b)/2,G.C.muted,11,'center');
    }
    drawScan(){
      const min=Number($('scanMin').value),max=Number($('scanMax').value);
      if(!(min>0&&max>min))return;
      const vals=this.points.flatMap(p=>[p.on.riseTime,p.off.riseTime]).filter(v=>v>0);
      const ymax=vals.length?Math.max(...vals)*1.12*1000:1;
      const f=G.chart($('riseChart'),{xmin:min,xmax:max,xlog:true,ymax,xlabel:'Excitation intensity / kW cm⁻²',ylabel:`τ${Math.round(Number($('riseFraction').value)*100)} / ms`,xticks:tickLog(min,max)});
      if(!f)return;
      for(const [key,color,dash]of [['on',G.C.p2,[]],['off',G.C.muted,[5,4]]]){
        let segment=[];
        for(const p of this.points){if(p[key].status==='reached')segment.push([f.x(p.I),f.y(p[key].riseTime*1000)]);else{G.line(f.ctx,segment,color,1.9,dash);segment=[];}}
        G.line(f.ctx,segment,color,1.9,dash);
      }
      if(this.model?.c.intensity>=min&&this.model.c.intensity<=max)G.line(f.ctx,[[f.x(this.model.c.intensity),f.t],[f.x(this.model.c.intensity),f.b]],G.C.gold+'70',1,[3,5]);
      const peak=this.peak;
      if(peak){
        const x=f.x(peak.I),y=f.y(peak.on.riseTime*1000),label=`I ${peakIntensity(peak.I)} kW cm⁻²`;
        G.line(f.ctx,[[x,y],[x,f.b]],G.C.p2+'aa',1,[3,4]);
        G.dot(f.ctx,x,y,4.5,G.C.p2);
        G.text(f.ctx,label,Math.max(f.l+75,Math.min(f.r-75,x)),f.t+10,G.C.p2,12,'center');
        $('riseChart').setAttribute('aria-label',`Build-up time versus intensity; sampled τ${Math.round(Number($('riseFraction').value)*100)} maximum at ${label}`);
      }else $('riseChart').setAttribute('aria-label','Calculated build-up time versus pump intensity; no completed maximum');
      if(!vals.length)G.text(f.ctx,'No resolved scan points yet.',(f.l+f.r)/2,(f.t+f.b)/2,G.C.muted,12,'center');
    }
    async scan(){
      if(!this.model)return;
      const min=Number($('scanMin').value),max=Number($('scanMax').value),fraction=Number($('riseFraction').value);
      if(!(min>=.01&&max>min&&max<=500)){$('riseReadout').textContent='Use 0.01 ≤ I minimum < I maximum ≤ 500 kW cm⁻².';return;}
      const token=++this.job,model={...this.model,c:{...this.model.c}},co=M.coefficients(model);
      this.points=[];this.peak=null;$('runRiseScan').disabled=true;$('cancelRiseScan').hidden=false;
      $('riseReadout').textContent='Integrating ground-state turn-on responses; no threshold or peak shape is imposed.';
      const evaluate=async I=>{
        // Yield between intensity points so changes and cancellation remain responsive.
        await new Promise(resolve=>setTimeout(resolve,0));if(token!==this.job)return false;
        const options={fraction,record:false,maxSteps:50000,coefficients:co};
        this.points.push({I,on:K.turnOn(model,I,{...options,feedback:true}),off:K.turnOn(model,I,{...options,feedback:false})});
        this.points.sort((a,b)=>a.I-b.I);this.drawScan();
        return true;
      };
      try{
        for(let i=0;i<41;i++)if(!await evaluate(min*(max/min)**(i/40)))return;
        // Narrow peaks need extra directly evaluated points, not a fitted spline.
        for(let round=0;round<2;round++){
          const peak=this.points.reduce((best,p)=>p.on.status==='reached'&&(!best||p.on.riseTime>best.on.riseTime)?p:best,null);
          const i=this.points.indexOf(peak);if(i<=0||i>=this.points.length-1)break;
          const a=this.points[i-1].I,b=this.points[i+1].I;
          for(let j=1;j<=8;j++){const I=a*(b/a)**(j/9);if(this.points.some(p=>Math.abs(Math.log(p.I/I))<1e-10))continue;if(!await evaluate(I))return;}
        }
        if(token!==this.job)return;
        const resolved=this.points.filter(p=>p.on.status==='reached'),peak=resolved.reduce((best,p)=>!best||p.on.riseTime>best.on.riseTime?p:best,null),i=this.points.indexOf(peak);
        const interior=i>0&&i<this.points.length-1&&this.points[i-1].on.status==='reached'&&this.points[i+1].on.status==='reached'&&peak.on.riseTime>this.points[i-1].on.riseTime&&peak.on.riseTime>this.points[i+1].on.riseTime;
        const missing=this.points.filter(p=>p.on.status!=='reached'||p.off.status!=='reached').length;
        this.peak=peak;this.drawScan();
        $('riseReadout').textContent=peak?`${interior?'Interior sampled maximum':'Largest resolved value; no interior peak confirmed'}: ${G.time(peak.on.riseTime)} at I ${peakIntensity(peak.I)} kW cm⁻².${missing?' Unresolved points are omitted from the connecting lines.':''}`:'No rise time was resolved within the integration budget.';
      }catch(error){$('riseReadout').textContent='Scan stopped: '+error.message;console.error(error);}
      finally{if(token===this.job){$('runRiseScan').disabled=false;$('cancelRiseScan').hidden=true;}}
    }
  }
  root.YbPrDiagnosticUI=DiagnosticUI;
})(globalThis);
