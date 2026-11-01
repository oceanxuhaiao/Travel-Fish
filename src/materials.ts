import {createHash} from 'node:crypto';
import {SCENES,type Scene} from './scenes.ts';

/** D-2 metadata is additive. Legacy and already frozen material snapshots stay valid. */
export function validateMaterialLibrary(library:any){
 if(!library||!Array.isArray(library.motifs)||!Array.isArray(library.sources)||!Array.isArray(library.provenance))throw Error('素材库格式无效');
 const ids=new Set<string>();
 for(const m of library.motifs){
  if(!m?.id||ids.has(m.id))throw Error('素材ID缺失或重复');ids.add(m.id);
  if(!m.id.startsWith('d2-'))continue;
  const p=library.provenance.filter((p:any)=>p.motifId===m.id);
  const s=library.sources.find((s:any)=>s.id===p[0]?.sourceId);
  if(p.length!==1||!s?.author||s.url!==m.origin?.url||!s.readingScope||!p[0].locator||!p[0].anchor)throw Error('D-2素材缺少唯一可追溯来源：'+m.id);
  const a=m.applicability,e=m.sourceEvidence;
  if(!a||!Array.isArray(a.environments)||!a.environments.length||new Set(a.environments).size!==a.environments.length||a.environments.some((v:any)=>!SCENES.includes(v))||!Array.isArray(a.prerequisites)||a.prerequisites.some((v:any)=>typeof v!=='string'||!v.trim()))throw Error('D-2素材环境适配无效：'+m.id);
  if(!['P1','P2','P3','P4','P5'].includes(m.activity)||!m.requirementId||!e||!['situation','action','result','feeling'].every(k=>typeof e[k]==='string'&&e[k].trim())||!m.adaptation||!p[0].adaptationCaution)throw Error('D-2素材证据或原创边界缺失：'+m.id);
  if(m.activity==='P5'&&a.environments.length!==1)throw Error('自然观景必须明确一个本类环境：'+m.id);
 }
}

export function selectMaterialPool(library:any,journeyId:string,scene:Scene){
 validateMaterialLibrary(library);
 const rank=(m:any)=>createHash('sha256').update(JSON.stringify([journeyId,m.id])).digest('hex');
 const eligible=library.motifs.filter((m:any)=>!m.id.startsWith('d2-')||m.applicability.environments.includes(scene));
 const ranked=eligible.slice().sort((a:any,b:any)=>rank(a).localeCompare(rank(b)));
 const nature=ranked.find((m:any)=>m.id.startsWith('d2-')&&m.activity==='P5');
 const pool=(nature?[nature,...ranked.filter((m:any)=>m!==nature)]:ranked).slice(0,12);
 if(!pool.some((m:any)=>m.id.startsWith('s2-cn-'))){const domestic=ranked.find((m:any)=>m.id.startsWith('s2-cn-'));if(domestic&&pool.length)pool[pool.length-1]=domestic;}
 return pool;
}

export const MATERIAL_GUIDANCE='D-2素材的sourceEvidence只陈述原作者明确经历；applicability.environments是允许环境，prerequisites是内部适配前提，不能冒充原文事实。先核对前提与节点载体，不能为用素材凭空添加设施。P5为独立自然观景，观看位置/关注方式/停留选择本身可构成主动行动和收获，不强制消费、互动、意外或科普。sourceEvidence.feeling若写未明，角色感受必须列入originalDetails。来源锚点仅用于内部核对，未交付旅程不向用户展示预案。';
