(function(root){
  'use strict';
  const C={text:'#e1e9f0',muted:'#9aafc0',grid:'#263747',yb:'#68d6dc',p1:'#e9ac7c',p2:'#bba0f0',gold:'#dfc48b',red:'#e78385'};
  const palettes={
    mineral:{yb:'#8eafbd',p1:'#c4a570',p2:'#cb7962',groundYb:'#68777e',groundPr:'#988774'},
    contrast:{yb:'#79a9d1',p1:'#dfb25f',p2:'#be83a7',groundYb:'#657789',groundPr:'#9b8d74'},
    classic:{yb:'#68d6dc',p1:'#e9ac7c',p2:'#bba0f0',groundYb:'#47677f',groundPr:'#a17f64'}
  };
  const ionText=s=>String(s).replace(/\b(Yb|Pr)(?![A-Za-z0-9_³])/g,'$1³⁺');
  const channelColor=kind=>kind==='MIGRATION'?C.yb:kind==='ETU_FORWARD'?C.p1:['BACK_TRANSFER','PR_DECAY_20'].includes(kind)?C.p2:YbPr.channels[kind].color;
  function surface(canvas){
    const box=canvas.getBoundingClientRect();if(box.width<1||box.height<1)return null;
    const d=Math.min(2,window.devicePixelRatio||1),w=box.width,h=box.height;
    if(canvas.width!==Math.round(w*d)||canvas.height!==Math.round(h*d)){canvas.width=Math.round(w*d);canvas.height=Math.round(h*d);}
    const ctx=canvas.getContext('2d');ctx.setTransform(d,0,0,d,0,0);ctx.clearRect(0,0,w,h);
    return {ctx,w,h};
  }
  function text(ctx,s,x,y,color=C.muted,size=12,align='left'){
    ctx.fillStyle=color;ctx.font=`${size}px Cambria, Georgia, serif`;ctx.textAlign=align;ctx.fillText(ionText(s),x,y);
  }
  function line(ctx,pts,color,width=1,dash=[]){
    ctx.strokeStyle=color;ctx.lineWidth=width;ctx.setLineDash(dash);ctx.beginPath();
    pts.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.stroke();ctx.setLineDash([]);
  }
  function dot(ctx,x,y,r,color){ctx.fillStyle=color;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();}
  function arrow(ctx,x1,y1,x2,y2,color,width=1.6,dash=[]){
    line(ctx,[[x1,y1],[x2,y2]],color,width,dash);const a=Math.atan2(y2-y1,x2-x1),r=7;
    ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(x2,y2);ctx.lineTo(x2-r*Math.cos(a-.5),y2-r*Math.sin(a-.5));ctx.lineTo(x2-r*Math.cos(a+.5),y2-r*Math.sin(a+.5));ctx.closePath();ctx.fill();
  }
  function curveArrow(ctx,from,to,color,bend=0){
    ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(...from);
    ctx.bezierCurveTo(from[0]+(to[0]-from[0])*.45,from[1]+bend,to[0]-(to[0]-from[0])*.45,to[1]+bend,...to);ctx.stroke();
    const a=Math.atan2(-bend,(to[0]-from[0])*.45),r=7;
    ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(...to);ctx.lineTo(to[0]-r*Math.cos(a-.5),to[1]-r*Math.sin(a-.5));ctx.lineTo(to[0]-r*Math.cos(a+.5),to[1]-r*Math.sin(a+.5));ctx.closePath();ctx.fill();
  }
  function compact(v,d=2){if(!Number.isFinite(v))return '—';if(v===0)return '0';
    if(Math.abs(v)>=1e5||Math.abs(v)<.01)return v.toExponential(1).replace('e+','e');
    return v.toLocaleString('en-US',{maximumFractionDigits:d});}
  function time(t){if(t===0)return '0 s';const a=t<1e-6?[1e9,'ns']:t<1e-3?[1e6,'µs']:t<1?[1000,'ms']:[1,'s'];return compact(t*a[0],3)+' '+a[1];}
  function logTick(v){
    const exponent=Math.log10(v),n=Math.round(exponent),sup='⁰¹²³⁴⁵⁶⁷⁸⁹';
    return v>0&&Math.abs(exponent-n)<1e-10?'10'+String(n).split('').map(c=>c==='-'?'⁻':sup[Number(c)]).join(''):compact(v);
  }
  function chart(canvas,{xmin=0,xmax=1,ymin=0,ymax=1,xlog=false,ylog=false,xlabel='',ylabel='',xticks,yticks}={}){
    const s=surface(canvas);if(!s)return null;const {ctx,w,h}=s,l=57,r=w-21,t=29,b=h-40;
    const tx=v=>xlog?Math.log10(v):v,ty=v=>ylog?Math.log10(v):v;
    const x=v=>l+(tx(v)-tx(xmin))/(tx(xmax)-tx(xmin))*(r-l);
    const y=v=>b-(ty(v)-ty(ymin))/(ty(ymax)-ty(ymin))*(b-t);
    if(!xticks)xticks=Array.from({length:5},(_,i)=>xmin+(xmax-xmin)*i/4);
    if(!yticks)yticks=Array.from({length:4},(_,i)=>ymin+(ymax-ymin)*i/3);
    for(const v of yticks){if(v<ymin||v>ymax)continue;line(ctx,[[l,y(v)],[r,y(v)]],C.grid,.7);text(ctx,ylog?logTick(v):compact(v),l-8,y(v)+4,C.muted,10,'right');}
    for(const v of xticks){if(v<xmin||v>xmax)continue;line(ctx,[[x(v),b],[x(v),b+4]],C.grid);text(ctx,xlog?logTick(v):compact(v),x(v),b+18,C.muted,10,'center');}
    line(ctx,[[l,t],[l,b],[r,b]],'#425669');text(ctx,ylabel,l,13,C.muted,11);text(ctx,xlabel,(l+r)/2,h-6,C.muted,11,'center');
    return {...s,l,r,t,b,x,y};
  }
  function spatial(canvas,model,view,pulses,selected,now){
    const s=surface(canvas);if(!s)return [];const {ctx,w,h}=s;
    const palette=palettes[view.palette]||palettes.mineral,material=view.material||'matte';
    const scale=Math.min(w*.38,h*.36)/model.g.radius*view.zoom;
    const cy=Math.cos(view.yaw),sy=Math.sin(view.yaw),cp=Math.cos(view.pitch),sp=Math.sin(view.pitch);
    const project=p=>{const a=p[0]*cy-p[1]*sy,b=p[0]*sy+p[1]*cy;
      return [w*.51+a*scale,h*.52-(p[2]*cp-b*sp)*scale,b*cp+p[2]*sp];};
    const r=model.g.radius;
    // Faint coordinate rings locate a finite 3D spherical fragment.
    for(let axis=0;axis<3;axis++){
      const points=[];for(let i=0;i<=100;i++){const a=i/100*Math.PI*2,p=[r*Math.cos(a),r*Math.sin(a),0];if(axis===1)[p[1],p[2]]=[p[2],p[1]];if(axis===2)[p[0],p[2]]=[p[2],p[0]];points.push(project(p).slice(0,2));}
      line(ctx,points,'#4c6b7f44',1,[3,5]);
    }
    // Optical excitation is drawn schematically, not as propagated photons.
    const beam=ctx.createLinearGradient(0,h*.55,w*.33,h*.55);
    beam.addColorStop(0,'#dfc48b00');beam.addColorStop(1,model.c.intensity>0?'#dfc48b13':'#dfc48b00');
    ctx.fillStyle=beam;ctx.beginPath();ctx.moveTo(0,h*.43);ctx.lineTo(w*.48,h*.48);ctx.lineTo(w*.48,h*.58);ctx.lineTo(0,h*.64);ctx.fill();
    if(model.c.intensity>0){arrow(ctx,25,h*.64,78,h*.64,C.gold,1);text(ctx,'852 nm',25,h*.64+20,C.gold,11);}
    const positions=model.ions.map(a=>project(a.p));
    if(view.links){
      ctx.lineWidth=.6;
      for(const e of model.edges){const a=model.ions[e.i],b=model.ions[e.j],focus=e.i===selected||e.j===selected;
        const color=focus?'#dfc48b99':a.s!==b.s?'#bd997a26':'#6eacb315';
        line(ctx,[positions[e.i].slice(0,2),positions[e.j].slice(0,2)],color,focus?1.2:.5);
      }
    }
    const order=model.ions.map((_,i)=>i).sort((a,b)=>positions[a][2]-positions[b][2]);
    for(const i of order){const a=model.ions[i],p=positions[i],depth=(p[2]/r+1)/2;
      const color=a.level?(a.s===1?palette.yb:a.level===1?palette.p1:palette.p2):(a.s===1?palette.groundYb:palette.groundPr);
      const radius=(a.s===1?2.3:4.5)*(.8+depth*.45)*Math.min(1.4,Math.sqrt(view.zoom));
      ctx.globalAlpha=a.level?1:.25+depth*.38;
      if(a.level&&material==='luminous'){const glow=ctx.createRadialGradient(p[0],p[1],0,p[0],p[1],radius*4);
        glow.addColorStop(0,color+'70');glow.addColorStop(1,color+'00');ctx.fillStyle=glow;ctx.beginPath();ctx.arc(p[0],p[1],radius*4,0,7);ctx.fill();}
      if(material==='outline'){
        if(a.level)dot(ctx,p[0],p[1],radius*.65,color);
        ctx.strokeStyle=color;ctx.lineWidth=a.level?1.3:.9;ctx.beginPath();ctx.arc(p[0],p[1],radius,0,Math.PI*2);ctx.stroke();
      }else{
        dot(ctx,p[0],p[1],radius,color);
        if(material==='luminous')dot(ctx,p[0]-radius*.25,p[1]-radius*.3,radius*.25,'#d9eff180');
      }
      if(a.s===2){ctx.strokeStyle=color;ctx.lineWidth=.7;ctx.beginPath();ctx.arc(p[0],p[1],radius+2.3,0,7);ctx.stroke();}
      if(i===selected){ctx.globalAlpha=1;ctx.strokeStyle=C.gold;ctx.lineWidth=1.4;ctx.beginPath();ctx.arc(p[0],p[1],radius+7,0,7);ctx.stroke();text(ctx,(a.s===1?'Yb':'Pr')+' #'+i,p[0]+12,p[1]-10,C.gold,12);}
    }
    ctx.globalAlpha=1;
    for(const pulse of pulses){
      const age=(now-pulse.born)/900;if(age<0||age>1)continue;
      const {kind,ids}=pulse.e,color=channelColor(kind),p=positions[ids[0]];
      ctx.globalAlpha=(1-age)*.9;
      if(ids.length===2){const q=positions[ids[1]],reverse=kind==='BACK_TRANSFER'||(kind==='MIGRATION'&&pulse.e.before[0]===0);
        const from=reverse?q:p,to=reverse?p:q;
        line(ctx,[from.slice(0,2),to.slice(0,2)],color,2);const f=Math.min(1,age*2);
        dot(ctx,from[0]+(to[0]-from[0])*f,from[1]+(to[1]-from[1])*f,3.5,'#f1f7fa');
      }else{ctx.strokeStyle=color;ctx.lineWidth=1.6;ctx.beginPath();ctx.arc(p[0],p[1],5+age*22,0,7);ctx.stroke();}
    }
    ctx.globalAlpha=1;
    const o=[w-62,h-51];arrow(ctx,...o,o[0]+27*cy,o[1]+27*sy*sp,'#6d9aa9',1);text(ctx,'x',o[0]+30*cy,o[1]+30*sy*sp+4,C.muted,10);
    arrow(ctx,...o,o[0]-27*sy,o[1]+27*cy*sp,'#6d9aa9',1);text(ctx,'y',o[0]-30*sy,o[1]+30*cy*sp+4,C.muted,10);
    arrow(ctx,...o,o[0],o[1]-27*cp,'#6d9aa9',1);text(ctx,'z',o[0]+3,o[1]-30*cp,C.muted,10);
    return positions;
  }
  function wavy(ctx,x1,y1,x2,y2,color){
    const dx=x2-x1,dy=y2-y1,length=Math.hypot(dx,dy),pts=[];
    for(let i=0;i<=60;i++){const t=i/60,v=Math.sin(t*Math.PI*12)*3;
      pts.push([x1+dx*t-dy/length*v,y1+dy*t+dx/length*v]);}
    line(ctx,pts,color,1.5);arrow(ctx,pts.at(-3)[0],pts.at(-3)[1],x2,y2,color,1.4);
  }
  function guide(canvas,step,phase=.6){
    const s=surface(canvas);if(!s)return;const {ctx,w,h}=s;
    const xs=[w*.11,w*.34,w*.57,w*.80],ys=[h*.79,h*.46,h*.17];
    const lw=Math.min(78,w*.115),small=w<570;
    arrow(ctx,12,h*.82,12,h*.13,C.muted,1);
    text(ctx,'E',12,h*.10,C.muted,12,'center');
    const colors=[C.text,C.gold,C.gold,C.p2,C.yb,C.p1,'#8bb5cc','#bda994',C.muted];
    const routes=[];
    const style=k=>({color:colors[k]+(step===0?'a8':step===k?'ff':'2e'),width:step===k?2.25:1.25});
    const transition=(k,i,from,to,offset,kind='arrow')=>{
      const st=style(k),x=xs[i]+lw*offset,y1=ys[from]+(from>to?7:-7),y2=ys[to]+(from>to?-7:7);
      if(kind==='wave')wavy(ctx,x,y1,x,y2,st.color);
      else arrow(ctx,x,y1,x,y2,st.color,st.width,kind==='inactive'?[2,5]:[]);
      if(step===k&&kind!=='inactive')routes.push({x,y1,y2,color:colors[k]});
      return [x,(y1+y2)/2];
    };
    const couple=(k,a,b,bend)=>{
      // This curve couples two intra-ion transitions; it is not an inter-ion level jump.
      const st=style(k),dx=b[0]-a[0];ctx.strokeStyle=st.color;ctx.lineWidth=step===k?1.6:1;
      ctx.setLineDash([3,5]);ctx.beginPath();ctx.moveTo(...a);
      ctx.bezierCurveTo(a[0]+dx*.40,a[1]+bend,b[0]-dx*.40,b[1]+bend,...b);ctx.stroke();ctx.setLineDash([]);
    };
    // One representative of each channel keeps the complete network legible.
    // These assignments illustrate the loop; every ion of a species follows the same rules.
    transition(1,0,0,1,-.30);transition(1,1,0,1,-.30);
    transition(2,0,1,2,-.30);
    const crP=transition(3,0,2,1,.24),crY=transition(3,1,0,1,.08);couple(3,crP,crY,-18);
    const emA=transition(4,1,1,0,.34),emB=transition(4,2,0,1,-.28);couple(4,emA,emB,-35);
    const etY=transition(5,2,1,0,.04),etP=transition(5,3,0,1,-.30);couple(5,etY,etP,-18);
    transition(6,2,1,0,.35);transition(6,3,2,0,.36);transition(6,3,1,0,-.04);
    transition(7,3,1,0,.16,'wave');transition(8,3,2,1,-.04,'inactive');
    ['Pr³⁺ A','Yb³⁺ A','Yb³⁺ B','Pr³⁺ B'].forEach((name,i)=>{
      const isY=i===1||i===2,color=isY?C.yb:C.p1;
      text(ctx,name,xs[i],h*.065,color,small?16:19,'center');
      const list=isY?[[0,'²F₇/₂'],[1,'²F₅/₂']]:[[0,'³H₄'],[1,'¹G₄'],[2,'³P₀*']];
      for(const [j,label]of list){
        const levelColor=isY?C.yb:j===2?C.p2:C.p1;
        line(ctx,[[xs[i]-lw/2,ys[j]],[xs[i]+lw/2,ys[j]]],levelColor+'95',1.8);
        // Spectroscopic terms sit to the right of each horizontal level.
        text(ctx,label,xs[i]+lw/2+5,ys[j]+4,C.text,small?11:13,'left');
      }
    });
    // A schematic highlight animates paired vertical transitions together.
    // It never changes the spatial KMC state or its physical clock.
    for(const r of routes){
      const y=r.y1+(r.y2-r.y1)*phase,glow=ctx.createRadialGradient(r.x,y,0,r.x,y,15);
      glow.addColorStop(0,r.color+'cc');glow.addColorStop(.35,r.color+'40');glow.addColorStop(1,r.color+'00');
      ctx.fillStyle=glow;ctx.beginPath();ctx.arc(r.x,y,15,0,Math.PI*2);ctx.fill();
      dot(ctx,r.x,y,3.6,r.color);dot(ctx,r.x-.6,y-.8,1.3,'#fff3de');
    }
  }
  function trace(canvas,model){
    const hist=model.history,end=hist.at(-1).t,start=hist[0].t;
    const max=Math.min(1,Math.max(.05,...hist.flatMap(a=>[a.p[0]/Math.max(1,model.nY),a.p[1]/Math.max(1,model.nP),a.p[2]/Math.max(1,model.nP)]))*1.15);
    const unit=end<.001?1e6:end<1?1000:1,label=unit===1e6?'µs':unit===1000?'ms':'s';
    const g=chart(canvas,{xmin:start*unit,xmax:(end>start?end:start+1/unit)*unit,ymax:max,xlabel:`Physical time / ${label}`,ylabel:'Excited-state fraction'});
    if(!g)return;for(let k=0;k<3;k++){const n=k===0?model.nY:model.nP;
      line(g.ctx,hist.map(a=>[g.x(a.t*unit),g.y(a.p[k]/Math.max(1,n))]),[C.yb,C.p1,C.p2][k],1.7);}
    if(model.events===0)text(g.ctx,'Run or advance an event to build a trajectory.',(g.l+g.r)/2,g.h*.45,C.muted,12,'center');
  }

  function activity(canvas,model){
    const hist=model.activityHistory,start=hist[0].t,end=Math.max(start+1e-6,model.t);
    const unit=end<.001?1e6:end<1?1000:1,label=unit===1e6?'µs':unit===1000?'ms':'s';
    const ymax=Math.max(2,...hist.map(a=>a.q))*1.15;
    const g=chart(canvas,{xmin:start*unit,xmax:end*unit,ymax,xlabel:`Physical time / ${label}`,ylabel:'Excited ions, Q'});
    if(!g)return;const path=[];
    hist.forEach((a,i)=>{if(i)path.push([g.x(a.t*unit),g.y(hist[i-1].q)]);path.push([g.x(a.t*unit),g.y(a.q)]);});
    path.push([g.x(end*unit),g.y(hist.at(-1).q)]);line(g.ctx,path,C.p2,1.8);
    if(!model.events)text(g.ctx,'Run the KMC simulation or prepare one ¹G₄ seed.',(g.l+g.r)/2,g.h*.42,C.muted,12,'center');
  }

  function events(canvas,model){
    const s=surface(canvas);if(!s)return;const {ctx,w,h}=s;
    const groups=[['Absorption',['YB_PUMP','PR_PUMP_01','PR_PUMP_12'],C.gold],['Migration',['MIGRATION'],C.yb],
      ['Yb → Pr',['ETU_FORWARD'],C.p1],['Pr → Yb',['BACK_TRANSFER'],C.p2],
      ['Pr emission',['PR_DECAY_20'],C.p2],['Relaxation',['YB_DECAY','PR_DECAY_10','PR_DECAY_21'],C.muted]];
    const counts=groups.map(a=>a[1].reduce((n,k)=>n+model.counts[k],0)),max=Math.max(10,...counts),l=100,r=w-62,top=14;
    groups.forEach(([name,_,color],i)=>{const y=top+i*(h-21)/groups.length;
      text(ctx,name,l-10,y+10,C.muted,11,'right');ctx.fillStyle='#203242';ctx.fillRect(l,y,r-l,11);
      ctx.fillStyle=color;ctx.fillRect(l,y,(r-l)*Math.log10(1+counts[i])/Math.log10(1+max),11);
      text(ctx,compact(counts[i],0),r+8,y+10,color,11);});
  }
  function response(canvas,points,I){
    const vals=points.flatMap(p=>[p.on,p.off]).filter(v=>v>0);
    if(!vals.length){const g=chart(canvas,{xmin:.5,xmax:501,xlog:true,xlabel:'Excitation intensity / kW cm⁻²',ylabel:'Pr emission rate / s⁻¹',xticks:[1,10,100,500]});
      if(g)text(g.ctx,'No Pr emitters in this configuration.',(g.l+g.r)/2,(g.t+g.b)/2,C.muted,12,'center');return null;}
    const min=10**Math.floor(Math.log10(Math.min(...vals))),max=Math.max(min*10,10**Math.ceil(Math.log10(Math.max(...vals))));
    const yt=[];for(let v=Math.log10(min);v<=Math.log10(max);v+=2)yt.push(10**v);
    const g=chart(canvas,{xmin:.5,xmax:501,ymin:min,ymax:max,xlog:true,ylog:true,xlabel:'Excitation intensity / kW cm⁻²',ylabel:'Pr emission rate / s⁻¹',xticks:[1,10,100,500],yticks:yt});
    if(!g)return null;
    line(g.ctx,points.map(p=>[g.x(p.I),g.y(p.off)]),'#90a4b4',1.5,[5,5]);
    line(g.ctx,points.map(p=>[g.x(p.I),g.y(p.on)]),C.p2,2.4);
    if(I>=.5&&I<=501){line(g.ctx,[[g.x(I),g.t],[g.x(I),g.b]],C.gold+'70',1,[3,5]);}
    return g;
  }
  function archive(canvas,dataset,convergedOnly,selected,observable='populations'){
    const series=observable==='populations'?
      [{key:'yb_level1_mean',name:'Yb excited',color:C.yb},{key:'pr_level1_mean',name:'Pr ¹G₄',color:C.p1},{key:'pr_level2_mean',name:'Pr upper*',color:C.p2}]:
      [{key:observable==='fraction'?'fraction':'rate',name:observable==='fraction'?'Pr upper* fraction':'Emission rate',color:C.p2}];
    const rows=dataset.rows.map((r,i)=>({...r,index:i,fraction:r.pr_level2_mean/Math.max(1,dataset.species.Pr),
      rate:r.measurement_time>0?(r.events_pr_decay_20||0)/r.measurement_time:0}));
    const all=rows.flatMap(r=>series.map(s=>r[s.key])).filter(v=>v>0);
    const valid=rows.filter(r=>!convergedOnly||r.converged===1);
    const min=all.length?10**Math.floor(Math.log10(Math.min(...all))):1e-3,max=all.length?10**Math.ceil(Math.log10(Math.max(...all))):1e3;
    const ylabel=observable==='populations'?'Time-weighted mean population':
      observable==='fraction'?'Time-weighted Pr upper* fraction':'Recorded Pr emission events / s⁻¹';
    const logSpan=Math.max(1,Math.ceil(Math.log10(max/min))),tickStep=Math.max(1,Math.ceil(logSpan/6));
    const g=chart(canvas,{xmin:Math.min(...rows.map(r=>r.intensity))*.95,xmax:Math.max(...rows.map(r=>r.intensity))*1.05,
      ymin:min,ymax:max===min?max*10:max,xlog:true,ylog:true,xlabel:'Recorded excitation intensity / kW cm⁻²',ylabel,
      xticks:[10,30,50,100,200,500],yticks:Array.from({length:logSpan+1},(_,i)=>min*10**i).filter((_,i)=>i%tickStep===0)});
    if(!g)return [];
    const screen=[];
    // Piecewise lines join only adjacent recorded intensities. Missing, zero,
    // or filtered points break the path; dashes retain the convergence flag.
    const ordered=rows.slice().sort((a,b)=>a.intensity-b.intensity);
    for(const s of series)for(let i=1;i<ordered.length;i++){
      const a=ordered[i-1],b=ordered[i];
      if(!(a[s.key]>0&&b[s.key]>0)||convergedOnly&&(a.converged!==1||b.converged!==1))continue;
      line(g.ctx,[[g.x(a.intensity),g.y(a[s.key])],[g.x(b.intensity),g.y(b[s.key])]],s.color,2,
        a.converged===1&&b.converged===1?[]:[5,3]);
    }
    for(const r of valid)for(const s of series){if(!(r[s.key]>0))continue;
      const x=g.x(r.intensity),y=g.y(r[s.key]),color=s.color;
      if(r.index===selected){g.ctx.strokeStyle=C.text;g.ctx.beginPath();g.ctx.arc(x,y,8,0,7);g.ctx.stroke();}
      screen.push({x,y,row:r,series:s.name,value:r[s.key]});}
    if(!screen.length)text(g.ctx,'No positive values match this filter.',(g.l+g.r)/2,(g.t+g.b)/2,C.muted,12,'center');
    text(g.ctx,`${new Set(screen.map(p=>p.row.index)).size} intensities / ${rows.length} recorded`,g.r,g.t+10,C.muted,10,'right');
    return screen;
  }
  root.YbPrGraphics={C,palettes,ionText,channelColor,surface,text,line,dot,compact,time,chart,activity,spatial,guide,trace,events,response,archive};
})(globalThis);
