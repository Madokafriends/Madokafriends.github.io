/* Passive observation of genuine KMC transitions; never modifies rates or RNG. */
(function(root){
  'use strict';
  class IonActivity {
    constructor(model){this.reset(model);}
    reset(model){
      this.rows=model.ions.map(a=>({level:a.level,changedAt:0,changes:0,emissions:0,
        residence:[0,0,0],counts:{},last:null}));
    }
    record(event){
      event.ids.forEach((id,j)=>{
        const row=this.rows[id],before=event.before[j],after=event.after[j];
        if(row.level!==before||event.t<row.changedAt)throw Error('Ion observation is out of sequence');
        row.counts[event.kind]=(row.counts[event.kind]||0)+1;
        if(event.kind==='PR_DECAY_20')row.emissions++;
        if(before===after)return;
        row.residence[before]+=event.t-row.changedAt;
        row.changedAt=event.t;row.level=after;row.changes++;
        row.last={kind:event.kind,from:before,to:after,t:event.t};
      });
    }
    summary(id,time){
      const row=this.rows[id];if(!row||time<row.changedAt)throw Error('Invalid ion observation');
      const age=time-row.changedAt,residence=row.residence.slice();residence[row.level]+=age;
      return {...row,age,residence,counts:{...row.counts},last:row.last?{...row.last}:null};
    }
  }
  if(typeof module==='object'&&module.exports)module.exports=IonActivity;else root.YbPrIonActivity=IonActivity;
})(globalThis);
