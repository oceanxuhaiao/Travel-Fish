const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('postcard',{call:(action,id)=>ipcRenderer.invoke('postcard:call',action,id),rects:(value)=>ipcRenderer.send('postcard:rects',value)});
