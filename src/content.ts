import {createHash} from 'node:crypto';
export const LEGACY_POLICY='non-contradiction-cloud-v1';
export const CONTENT_POLICY='non-contradiction-cloud-v2';
export const COAST_VARIANTS=[
 {id:'tide-pools',prompt:'晴日岩岸潮池。近景是清浅小水洼、湿润岩石和零星浅色贝壳，远处蓝绿海面。镜头低，岩石由左下斜向右远方；女孩在右下潮池边，岸线有纵深。不要沙堡、螃蟹、灯塔或木栈道。'},
 {id:'lighthouse-meadow',prompt:'海湾灯塔与海边草坡。镜头从较高草坡望向弯曲海岸，左远方白色小灯塔、低矮海岬，女孩在右下草坡小径旁。以大片浅色天空和草坡形成开阔构图。不要沙堡、螃蟹、潮池或木栈道。'},
 {id:'coastal-boardwalk',prompt:'宁静海边木栈道。木板路与简朴护栏从左下斜向右远方，海面在画面左侧，女孩在右下木栈道上，面部可辨。浅淡日光，构图沿对角线展开。不要沙堡、螃蟹、灯塔或潮池。'},
 {id:'shell-dunes',prompt:'海草沙丘与拾贝的小海岸。以前景大而浅色的贝壳、柔和起伏的沙丘和稀疏海草引导视线，女孩在画面中下偏左，蓝绿海水仅在较远处呈一条柔和弯线，地平线在上三分之一。不要沙堡、螃蟹、灯塔、木栈道。'},
 {id:'sunset-rock-arch',prompt:'黄昏海拱与层叠礁石。远处一座天然岩拱，左半画面是层叠浅灰礁石，女孩在右下岩岸空地，海面映着浅桃色暮光。保持透明浅淡水彩与象牙纸留白，不用厚重滤镜。不要沙堡、螃蟹、灯塔或栈道。'},
 {id:'sheltered-cove',prompt:'被低矮海崖环抱的小海湾。略俯视镜头，海湾弧线从上方绕向画面下部，浅绿松石色海水与两侧岩壁形成环抱布局，女孩在左下岸边小径，面部可辨。不要沙堡、螃蟹、灯塔、栈道或潮池。'},
] as const;
export function selectCoastVariant(tripId:string,recent:string[]=[]){
 const excluded=new Set(recent.filter(id=>COAST_VARIANTS.some(v=>v.id===id)).slice(0,COAST_VARIANTS.length-1));
 const available=COAST_VARIANTS.filter(v=>!excluded.has(v.id));
 const seed=createHash('sha256').update(tripId).digest().readUInt32BE(0);
 return available[seed%available.length];
}
export const NOTE_VOICES=[
 '安安心心的陪伴感；不以“想你”或“把安静分你一半”作结，写一件让心慢下来的小事。',
 '带一点好奇和孩子气；分享一个不起眼但可爱的发现，结尾留给对方想象。',
 '轻轻的幽默与自得其乐；没有夸张行为，不编造用户性格、喜好或身体感受。',
 '满足与珍惜；把普通片刻当作小礼物，不套“暖意寄给你”的固定句型。',
 '温柔的问候；只表达当下牵挂，不凭空声称对方怕冷、习惯、往事或共同回忆。',
 '对回家的小小期待；不编造约定或具体未来活动，给来信一个自然的停顿。',
] as const;
export function selectNoteVoice(tripId:string):string{return NOTE_VOICES[createHash('sha256').update('note:'+tripId).digest().readUInt32BE(0)%NOTE_VOICES.length];}
export function notePrompt(facts:unknown,recent:string[],voice?:string):string{
 const legacy='写桌宠旅行短笺，返回JSON：title（4到20字中文）、note（建议60到90字，最多120字）。第一人称自然写给牵挂的人，只选一两个成图锚点，其余写心情与想念；适度模糊，避免精确数量、左右位置、具体姿势和复杂动作。不虚构共同经历，不写技法/水彩/照片/署名，不重复近期标题。事实：';
 if(!voice)return legacy+JSON.stringify(facts)+'；近期标题：'+JSON.stringify(recent);
 const anchors=Array.isArray(facts)?facts.filter(x=>typeof x==='string'&&!/坐|蹲|站|躺|趴|跪|双手|左手|右手|蓝发|鲸鱼装|女孩/.test(x)):[];
 return '写桌宠旅行短笺，返回JSON：title（4到20字中文）、note（60到90字，最多120字）。第一人称自然写给陪伴的人，只选一两个背景锚点。不要写自己坐、蹲、站、躺、趴、跪等具体姿态，不逐条复述服装或描述复杂动作，优先用“来到/在这里停留/一路上”。姿态不承担情绪表达。不声称用户怕冷、喜欢什么、正在做什么，不编造往事、共同回忆、约定或具体未来活动。感受、比喻、风声气味可以适度模糊。不写技法/水彩/照片/署名，不重复近期标题。本次语气：'+voice+' 背景锚点：'+JSON.stringify(anchors)+'；近期标题：'+JSON.stringify(recent);
}
