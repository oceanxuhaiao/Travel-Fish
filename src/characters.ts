import {fileURLToPath} from 'node:url';
import type {PostcardConfigSection} from './config.ts';
export const CHARACTER_PRESETS=[{id:'maid',label:'女仆装'},{id:'winter',label:'冬装'},{id:'crew',label:'店员装'}] as const;
export function presetPath(id:string){if(!CHARACTER_PRESETS.some(p=>p.id===id))throw new Error('未知内置角色');return fileURLToPath(new URL('../assets/characters/'+id+'.png',import.meta.url));}
export function characterReference(cfg:PostcardConfigSection){const mode=cfg.characterPreset??'auto';
 if(mode==='custom'||mode==='auto'&&cfg.characterReference.trim()){if(!cfg.characterReference.trim())throw new Error('请先导入自定义角色PNG');return cfg.characterReference;}
 return presetPath(mode==='auto'?'winter':mode);
}

export function styleReference(cfg:PostcardConfigSection){return cfg.styleReference.trim()||fileURLToPath(new URL('../assets/style-default.png',import.meta.url));}
