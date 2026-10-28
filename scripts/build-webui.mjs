import {build} from 'esbuild';
import {mkdirSync,copyFileSync} from 'node:fs';
mkdirSync('dist',{recursive:true});
await build({entryPoints:['webui/client.ts'],bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:'dist/webui.js',minify:true});
copyFileSync('webui/style.css','dist/webui.css');
