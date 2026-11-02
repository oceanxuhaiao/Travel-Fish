import type {OutputTap,RunPhase} from 'cortico/core/types.ts';

export interface TaskTerminal {taskId:string;activation:number;responseId:string;reason:'output_truncated'|'output_filtered'|'model_failed';at:number;}
/** Passive observer: retain terminal metadata only, never model text or reasoning. */
export class HostTaskObserver {
 private phase?:RunPhase;
 private reads=new Map<string,number>();private readRound?:number;
 private next?:{taskId:string;activation:number};
 private response?:{taskId:string;activation:number;responseId:string};
 constructor(private terminal:(event:TaskTerminal)=>void){}
 read(taskId:string,activation:number){
  if(!this.phase||!['tools','model'].includes(this.phase.state)||this.phase.round===undefined)return;
  if(this.readRound!==this.phase.round){this.reads.clear();this.readRound=this.phase.round;}
  this.reads.set(taskId,activation);
 }
 onRunPhase(phase:RunPhase){
  const newModelRound=phase.state==='model'&&(this.phase?.state!=='model'||this.phase.round!==phase.round);
  this.phase=phase;
  if(['delivering','idle','handoff'].includes(phase.state)){this.clear();return;}
  if(['tools','model'].includes(phase.state)&&phase.running.some(n=>!['postcard_host_read','postcard_host_submit'].includes(n)))this.clear();
  if(newModelRound){
   this.next=phase.round===((this.readRound??-2)+1)&&this.reads.size===1
    ?{taskId:[...this.reads.keys()][0],activation:[...this.reads.values()][0]}:undefined;
   this.reads.clear();this.readRound=undefined;
  }
 }
 private clear(){this.reads.clear();this.readRound=undefined;this.next=undefined;this.response=undefined;}
 forget(taskId:string){this.reads.delete(taskId);if(this.next?.taskId===taskId)this.next=undefined;if(this.response?.taskId===taskId)this.response=undefined;}
 readonly tap:OutputTap={
  externalizes:()=>false,
  onEvent:event=>{
   if(event.type==='response.created'){
    this.response=this.next?{...this.next,responseId:event.response.id}:undefined;this.next=undefined;return;
   }
   if(!['response.incomplete','response.failed','response.completed'].includes(event.type))return;
   const response=(event as {response?:{id:string;incomplete_details?:{reason?:string}|null}}).response;
   const linked=this.response;this.response=undefined;
   if(!linked||response?.id!==linked.responseId||event.type==='response.completed')return;
   const reason=response?.incomplete_details?.reason;
   if(event.type==='response.incomplete'&&!['max_output_tokens','content_filter'].includes(reason??''))return;
   this.terminal({...linked,reason:event.type==='response.failed'?'model_failed':reason==='max_output_tokens'?'output_truncated':'output_filtered',at:Date.now()});
  },
  onAbort:()=>this.clear(),
 };
}
