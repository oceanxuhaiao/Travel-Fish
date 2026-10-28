import {it,expect} from 'vitest';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SCENES,SCENE_PLANS,chooseScene,freezeScene,chooseVisualVariation,ALLOWED_ACTIONS} from '../src/scenes.ts';
import {TravelService,TravelStore} from '../src/travel.ts';

it('八类各至少三个方案，ID唯一，相容氛围与核心/装饰分开',()=>{
 expect(SCENES).toHaveLength(8);expect(new Set(SCENE_PLANS.map(p=>p.id)).size).toBe(SCENE_PLANS.length);
 for(const scene of SCENES){const plans=SCENE_PLANS.filter(p=>p.scene===scene);expect(plans.length).toBeGreaterThanOrEqual(3);for(const p of plans){expect(p.moods.length).toBeGreaterThan(0);expect(p.core).toBeTruthy();expect(p.conflicts).toBeTruthy();}}
});
it('随机类别平衡近期且避开最近两趟，场景耗尽放宽最老排除项',()=>{
 const recent=['forest','coast','forest'] as const;
 for(let i=0;i<50;i++)expect(['forest','coast']).not.toContain(chooseScene(String(i),recent));
 const ids=SCENE_PLANS.filter(p=>p.scene==='lake').map(p=>p.id);
 const selected=freezeScene('stable','lake',[],ids);expect(selected.id).toBe(ids.at(-1));
 expect(freezeScene('stable','lake',[],ids)).toEqual(selected);
});
it('取消也记入近期；快照重启后不变，不依赖生成服务在线',async()=>{
 const root=mkdtempSync(join(tmpdir(),'postcard-scenes-'));let service=new TravelService(new TravelStore(root),undefined,()=>1000);service.open();
 try{const first=service.start('surprise',1);service.cancel(first.id);const second=service.start('surprise',1);expect(second.scene).not.toBe(first.scene);const frozen=structuredClone(second.sceneSnapshot);await service.close();service=new TravelService(new TravelStore(root),undefined,()=>1000);service.open();expect(service.status()?.sceneSnapshot).toEqual(frozen);expect(service.status()?.id).toBe(second.id);}finally{await service.close();rmSync(root,{recursive:true,force:true});}
});
it('旧版三场景收藏按原始字节读取，不自动迁移或改写',()=>{
 // Existing E evidence provides real old records; only read from original data.
 const root=join(process.cwd(),'../../../../output/stage-e-quality/runs/coast/data/postcard');
 const store=new TravelStore(root);const cards=store.cards();expect(cards.length).toBeGreaterThan(0);
 const card=cards[0],file=join(root,'collection',card.tripId,'record.json');const before=readFileSync(file);expect(store.card(card.tripId)?.sha256).toBe(card.sha256);expect(readFileSync(file).equals(before)).toBe(true);
});

it('所有方案显式限制安全动作，组合确定且避开全环境最近两次',()=>{
 for(const plan of SCENE_PLANS){expect(ALLOWED_ACTIONS[plan.id]?.length).toBeGreaterThan(0);const first=chooseVisualVariation('first',plan.id),second=chooseVisualVariation('second',plan.id,[first]),third=chooseVisualVariation('third',plan.id,[second,first]);expect(third.id).not.toBe(first.id);expect(third.id).not.toBe(second.id);expect(ALLOWED_ACTIONS[plan.id]).toContain(third.action);expect(chooseVisualVariation('third',plan.id,[second,first])).toEqual(third);}
 for(const plan of ['snow-lane','coastal-boardwalk','lake-jetty','waterside-dock'])for(let i=0;i<40;i++)expect(chooseVisualVariation(String(i),plan).action).not.toBe('sit');
 expect(chooseVisualVariation('unknown','future-plan').reason).toBe('safe-default');
});
it('新快照包含组合，无旧朝向冲突且保持场景视点',()=>{
 const snap=freezeScene('framing-new','lake');expect(snap.catalogVersion).toBe('imagined-scenes-v3');expect(snap.visualVariation?.version).toBe('postcard-framing-v1');expect(snap.prompt).not.toContain('不背对观众');expect(snap.prompt).toContain(snap.composition);expect(snap.prompt).toContain('风景主导');
});
