import type {MailboxSnapshot} from './mailbox.ts';
import type {MailboxWindowState} from './mailbox-window.ts';
import {TRAVEL_MINUTES} from './config.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { zipSync,strToU8 } from 'fflate';
import type { Card,Scene,TravelService,Trip } from './travel.ts';

export type PublicTrip=Omit<Trip,'generation'|'sceneSnapshot'>;
export type PublicCard=Pick<Card,'tripId'|'scene'|'title'|'note'|'completedAt'|'sceneLabel'>;
export interface PanelSnapshot { trip:PublicTrip|null; cards:Array<PublicCard&{unread?:boolean}>; mailbox?:MailboxSnapshot; mailboxWindow?:MailboxWindowState; minutes:number; generatorConnected:boolean; }
function tripView(trip:Trip|null):PublicTrip|null {if(!trip)return null;const {generation,sceneSnapshot,...view}=trip;return view;}
function cardView(card:Card):PublicCard {const {tripId,scene,title,note,completedAt,sceneLabel}=card;return {tripId,scene,title,note,completedAt,...(sceneLabel?{sceneLabel}:{})};}
const binary=(mime:string,bytes:Uint8Array)=>({$binary:{mime,base64:Buffer.from(bytes).toString('base64')}});

/** Standard panel data surface; every mutation uses the existing travel service. */
export class PostcardPanel {
  private thumbnails=new Map<string,Buffer>();
  constructor(private service:TravelService,private settings:()=>{minutes:number;generatorConnected:boolean;cost?:unknown;readyForTravel?:boolean},private mail?:{snapshot:()=>MailboxSnapshot|undefined;markRead:(id:string)=>unknown;open:()=>Promise<MailboxWindowState>;close:()=>Promise<unknown>;windowState:()=>MailboxWindowState},private beforeStart?:()=>void){}
  snapshot():PanelSnapshot {const mailbox=this.mail?.snapshot();return {trip:tripView(this.service.status()),cards:this.service.store.cards().map(c=>({...cardView(c),...(mailbox?{unread:mailbox.cards.find(m=>m.tripId===c.tripId)?.unread??false}:{})})),...(mailbox?{mailbox,mailboxWindow:this.mail!.windowState()}:{}),...this.settings(),minutes:TRAVEL_MINUTES};}
  async invoke(panel:string,method:string,args:unknown[]):Promise<unknown>{
    if(panel!=='album')throw new Error('未知旅行面板');
    switch(method){
      case 'snapshot': return this.snapshot();
      case 'markRead': if(!this.mail)throw Error('邮箱未接入');this.mail.markRead(String(args[0]));return this.snapshot();
      case 'openMailbox':if(!this.mail)throw Error('邮箱未接入');await this.mail.open();return this.snapshot();
      case 'closeMailbox':if(!this.mail)throw Error('邮箱未接入');await this.mail.close();return this.snapshot();
      case 'start': this.beforeStart?.();this.service.start('surprise',TRAVEL_MINUTES);return this.snapshot();
      case 'cancel': this.service.cancel(String(args[0]));return this.snapshot();
      case 'retry': this.service.retry(String(args[0]),args[1]===true);return this.snapshot();
      case 'image': case 'thumbnail': case 'png': case 'zip': {
        const id=String(args[0]);const record=this.service.store.card(id);if(!record)throw new Error('找不到这份已完成的来信');
        const image=readFileSync(join(this.service.store.collection,id,'postcard.png'));
        if(method==='zip')return binary('application/zip',zipSync({
          'postcard.png':image,
          'note.md':strToU8('# '+record.title+'\n\n'+record.note+'\n'),
          'metadata.json':strToU8(JSON.stringify({...cardView(record),sha256:record.sha256,schema:1},null,2)),
        }));
        if(method==='thumbnail'){
          let thumb=this.thumbnails.get(record.sha256);
          if(!thumb){
            const original=PNG.sync.read(image),scale=Math.min(1,360/original.width,540/original.height);
            const target=new PNG({width:Math.max(1,Math.round(original.width*scale)),height:Math.max(1,Math.round(original.height*scale))});
            for(let y=0;y<target.height;y++)for(let x=0;x<target.width;x++){
              const sx=Math.min(original.width-1,Math.floor(x/scale)),sy=Math.min(original.height-1,Math.floor(y/scale));
              original.data.copy(target.data,(y*target.width+x)*4,(sy*original.width+sx)*4,(sy*original.width+sx)*4+4);
            }
            thumb=PNG.sync.write(target);this.thumbnails.set(record.sha256,thumb);
            if(this.thumbnails.size>24)this.thumbnails.delete(this.thumbnails.keys().next().value!);
          }
          return binary('image/png',thumb);
        }
        return binary('image/png',image);
      }
      default:throw new Error('未知旅行面板操作');
    }
  }
}
