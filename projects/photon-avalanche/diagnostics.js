/* Homogeneous kinetic reference; not a spatial-KMC lifetime estimator. */
(function(root){
  'use strict';
  const M=typeof module==='object'&&module.exports?require('./model.js'):root.YbPr;
  const EXCITATION_CHANGE=Object.freeze({YB_PUMP:1,PR_PUMP_01:1,BACK_TRANSFER:1,
    YB_DECAY:-1,PR_DECAY_10:-1,PR_DECAY_20:-1,PR_PUMP_12:0,
    PR_DECAY_21:0,MIGRATION:0,ETU_FORWARD:0});
  function accounting(model,initialExcitations=0){
    const c=model.counts,primary=c.YB_PUMP+c.PR_PUMP_01,
      multiplication=c.BACK_TRANSFER,loss=c.YB_DECAY+c.PR_DECAY_10+c.PR_DECAY_20;
    const observed=model.populations().reduce((a,b)=>a+b,0),
      predicted=initialExcitations+primary+multiplication-loss;
    return {primary,multiplication,loss,observed,predicted,residual:observed-predicted,
      // An event ratio, not a reproduction number: repeats and return transfer are included.
      crossRelaxationsPerPrimary:primary>0?multiplication/primary:null};
  }
  function rates(model,I,feedback=true,co=M.coefficients(model)){
    if(!Number.isFinite(I)||I<0)throw new RangeError('Intensity must be finite and nonnegative');
    const s=model.source,c=model.c;
    return {py:s.pump.yb01*I*c.gsa,pp:s.pump.pr01*I,a:s.pump.pr12*I*c.esa,
      gy:s.decay.gamma_yb10,g1:s.decay.gamma_pr10-s.mpr+s.mpr*c.mpr,
      g2:s.decay.gamma_pr20,g21:s.decay.gamma_pr21,
      fy:co.fY,fp:co.fP,by:feedback?co.bY:0,bp:feedback?co.bP:0};
  }
  // y = excited Yb fraction; p1,p2 = Pr fractions, p0 = 1-p1-p2.
  function derivative(p,r){
    const [y,p1,p2]=p,p0=1-p1-p2,back=r.bp*(1-y)*p2;
    return [r.py*(1-y)-r.gy*y-r.fy*y*p0+r.by*(1-y)*p2,
      (r.pp+r.fp*y)*p0-(r.a+r.g1)*p1+r.g21*p2+back,
      r.a*p1-(r.g2+r.g21)*p2-back];
  }
  const A=[[],[1/5],[3/40,9/40],[44/45,-56/15,32/9],
    [19372/6561,-25360/2187,64448/6561,-212/729],
    [9017/3168,-355/33,46732/5247,49/176,-5103/18656],
    [35/384,0,500/1113,125/192,-2187/6784,11/84]];
  const B4=[5179/57600,0,7571/16695,393/640,-92097/339200,187/2100,1/40];
  function trial(p,h,r){
    const k=[derivative(p,r)];
    for(let stage=1;stage<7;stage++){
      const q=p.map((v,j)=>v+h*A[stage].reduce((s,a,i)=>s+a*k[i][j],0));
      k.push(derivative(q,r));
    }
    const next=p.map((v,j)=>v+h*A[6].reduce((s,a,i)=>s+a*k[i][j],0)),
      fourth=p.map((v,j)=>v+h*B4.reduce((s,a,i)=>s+a*k[i][j],0));
    return {next,error:next.map((v,j)=>v-fourth[j]),beforeDerivative:k[0],afterDerivative:k[6]};
  }
  function crossing(p,q,d0,d1,h,target){
    // Cubic Hermite interpolation of the accepted physical-time step.
    const at=u=>{const u2=u*u,u3=u2*u;
      return (2*u3-3*u2+1)*p+(-2*u3+3*u2)*q+(u3-2*u2+u)*h*d0+(u3-u2)*h*d1;};
    let lo=0,hi=1;
    for(let n=0;n<48;n++){const m=(lo+hi)/2;if(at(m)<target)lo=m;else hi=m;}
    return (lo+hi)/2;
  }
  function turnOn(model,I,options={}){
    const {fraction=.8,feedback=true,relativeTolerance=1e-6,absoluteTolerance=1e-14,
      maxTime=2,maxSteps=200000,record=true}=options;
    if(!(fraction>0&&fraction<1))throw new RangeError('Rise fraction must lie between zero and one');
    if(!(relativeTolerance>0&&absoluteTolerance>0&&maxTime>0&&maxSteps>=1))throw new RangeError('Invalid integration budget or tolerance');
    const co=options.coefficients||M.coefficients(model),r=rates(model,I,feedback,co),
      steady=M.equilibrium(model,I,feedback,co),target=fraction*steady.p2;
    const base={I,fraction,feedback,steady,target,riseTime:null,t95:null,time:0,steps:0,
      rejected:0,populations:[0,0,0],trace:record?[{t:0,p:[0,0,0]}]:[],status:'unresolved'};
    if(!model.nP)return {...base,status:'no-emitters'};
    if(I===0||!(steady.p2>0))return {...base,status:'no-emission'};
    const maxRate=Math.max(1,...Object.values(r)),dp=derivative([steady.y,steady.p1,steady.p2],r);
    const residual=Math.max(...dp.map((v,j)=>Math.abs(v)/(maxRate*Math.max(absoluteTolerance,[steady.y,steady.p1,steady.p2][j]))));
    base.equilibriumResidual=residual;
    if(!Number.isFinite(residual)||residual>1e-7)return {...base,status:'invalid-equilibrium'};
    let p=[0,0,0],t=0,h=Math.min(maxTime,.1/maxRate),steps=0,rejected=0;
    const scales=[steady.y,steady.p1,steady.p2];
    while(steps+rejected<maxSteps&&t<maxTime){
      h=Math.min(h,maxTime-t);
      if(h<=Number.EPSILON*Math.max(1,t))return {...base,time:t,populations:p,steps,rejected,status:'step-underflow'};
      const tr=trial(p,h,r),q=tr.next;
      const error=Math.max(...tr.error.map((v,j)=>Math.abs(v)/(absoluteTolerance+relativeTolerance*Math.max(Math.abs(p[j]),Math.abs(q[j]),scales[j]))));
      const valid=q.every(Number.isFinite)&&q.every(v=>v>=-absoluteTolerance)&&q[0]<=1+absoluteTolerance&&q[1]+q[2]<=1+absoluteTolerance;
      if(!valid||!Number.isFinite(error)||error>1){
        rejected++;h*=valid&&Number.isFinite(error)?Math.max(.1,.9*error**(-.2)):.2;continue;
      }
      steps++;
      if(q[2]>=target&&p[2]<target){
        const u=crossing(p[2],q[2],tr.beforeDerivative[2],tr.afterDerivative[2],h,target),riseTime=t+u*h;
        // Return the accepted endpoint as well as the interpolated crossing.
        if(record)base.trace.push({t:t+h,p:q.slice()});
        return {...base,status:'reached',riseTime,t95:fraction===.95?riseTime:null,
          time:t+h,populations:q,steps,rejected,crossingBracket:[t,t+h]};
      }
      p=q;t+=h;
      if(record){base.trace.push({t,p:p.slice()});if(base.trace.length>1000)base.trace=base.trace.filter((_,i)=>i%2===0);}
      h*=error===0?5:Math.min(5,Math.max(.2,.9*error**(-.2)));
    }
    return {...base,time:t,populations:p,steps,rejected,status:t>=maxTime?'time-limit':'step-limit'};
  }
  function scan(model,options={}){
    const {minIntensity=.5,maxIntensity=500,count=25,refinements=2,...solverOptions}=options;
    if(!(minIntensity>0&&maxIntensity>minIntensity&&Number.isInteger(count)&&count>=3&&count<=200&&Number.isInteger(refinements)&&refinements>=0&&refinements<=4))throw new RangeError('Invalid intensity scan');
    const co=M.coefficients(model),points=[];
    const append=I=>points.push({I,on:turnOn(model,I,{...solverOptions,coefficients:co,feedback:true,record:false}),
      off:turnOn(model,I,{...solverOptions,coefficients:co,feedback:false,record:false})});
    for(let i=0;i<count;i++){
      const I=minIntensity*(maxIntensity/minIntensity)**(i/(count-1));
      append(I);
    }
    // Resolve a narrow kinetic maximum without assuming its location or height.
    // Keep every original point, including censored points; no fitted peak is inserted.
    for(let pass=0;pass<refinements;pass++){
      const best=points.reduce((a,p)=>p.on.status==='reached'&&(!a||p.on.riseTime>a.on.riseTime)?p:a,null),i=points.indexOf(best);
      if(i<=0||i>=points.length-1||points[i-1].on.status!=='reached'||points[i+1].on.status!=='reached')break;
      const low=points[i-1].I,high=points[i+1].I;
      for(let j=1;j<9;j++){
        const I=low*(high/low)**(j/9);
        if(points.every(p=>Math.abs(Math.log(I/p.I))>1e-12))append(I);
      }
      points.sort((a,b)=>a.I-b.I);
    }
    const resolved=points.filter(p=>p.on.status==='reached');
    const maximum=resolved.reduce((best,p)=>!best||p.on.riseTime>best.on.riseTime?p:best,null);
    const idx=points.indexOf(maximum),interiorMaximum=idx>0&&idx<points.length-1&&
      points[idx-1].on.status==='reached'&&points[idx+1].on.status==='reached'&&
      maximum.on.riseTime>points[idx-1].on.riseTime&&maximum.on.riseTime>points[idx+1].on.riseTime;
    return {points,maximum:maximum?{I:maximum.I,riseTime:maximum.on.riseTime}:null,
      interiorMaximum,complete:points.every(p=>p.on.status==='reached'&&p.off.status==='reached'),
      note:'A sampled maximum is a kinetic-reference feature, not an established spatial-KMC avalanche threshold.'};
  }
  const api={EXCITATION_CHANGE,accounting,rates,derivative,turnOn,scan};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.YbPrDiagnostics=api;
})(globalThis);
