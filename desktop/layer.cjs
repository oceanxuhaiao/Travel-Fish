/** Keep our own mailbox immediately behind the existing official pet, without changing that pet. */
function keepBehindPet(win,platform=process.platform){
 if(platform!=='win32')return {update:()=>({supported:false}),dispose(){}};
 try{
  const ffi=require('koffi'),os=ffi.load('user32.dll');
  const find=os.func('intptr_t __stdcall FindWindowW(str16 className, str16 windowName)');
  const next=os.func('intptr_t __stdcall GetWindow(intptr_t hwnd, uint32_t cmd)');
  const visible=os.func('int __stdcall IsWindowVisible(intptr_t hwnd)');
  const place=os.func('int __stdcall SetWindowPos(intptr_t hwnd, intptr_t after, int x, int y, int width, int height, uint32_t flags)');
  const raw=win.getNativeWindowHandle(),own=raw.length>=8?raw.readBigUInt64LE():BigInt(raw.readUInt32LE());
  function update(){
   if(win.isDestroyed())return {supported:true,petFound:false};
   const titles=['Cortico 桌宠','Cortico Pet','Cortico 桌寵','Cortico ペット','Cortico 펫','Cortico-Haustier','Compagnon Cortico','Питомец Cortico','Pet do Cortico','Mascota de Cortico','Animaletto Cortico'];let pet=0;for(const title of titles){const candidate=find(null,title);if(candidate&&visible(candidate)){pet=candidate;break;}}if(!pet)return {supported:true,petFound:false};
   // SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE | SWP_NOOWNERZORDER.
   const moved=!!place(own,pet,0,0,0,0,0x213);let above=false,at=next(pet,2);
   for(let i=0;at&&i<256;i++){if(BigInt(at)===own){above=true;break;}at=next(at,2);}
   return {supported:true,petFound:true,mailboxBelowPet:moved&&above};
  }
  return {update,dispose(){}};
 }catch{return {update:()=>({supported:false,detail:'native layer unavailable'}),dispose(){}};}
}
module.exports={keepBehindPet};
