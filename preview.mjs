import {createServer} from 'node:http';
import {createReadStream,statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {basename} from 'node:path';
import {execFile} from 'node:child_process';

const root = new URL('./',import.meta.url);
const types={html:'text/html; charset=utf-8',css:'text/css; charset=utf-8',js:'text/javascript; charset=utf-8',
  webmanifest:'application/manifest+json',svg:'image/svg+xml',png:'image/png'};
const port=Number(process.env.CONTAS_CCS_PREVIEW_PORT || 8765);
createServer((request,response)=>{
  const name=request.url?.split('?')[0]?.slice(1) || 'index.html';
  const ext=name.split('.').pop();
  if (!/^[a-z0-9.-]+$/i.test(name) || name!==basename(name) || !Object.hasOwn(types,ext)) {
    response.writeHead(404).end();
    return;
  }
  const file=fileURLToPath(new URL(name,root));
  try {
    const stats=statSync(file);
    if (!stats.isFile()) throw new Error();
    response.writeHead(200,{'Content-Type':types[ext],'Content-Length':stats.size,'Cache-Control':'no-cache'});
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404).end();
  }
}).listen(port,'127.0.0.1',()=>{
  const address='http://localhost:'+port+'/';
  console.log('Contas CCS disponível em '+address);
  if (process.argv.includes('--open') && process.platform==='win32') {
    execFile('rundll32.exe',['url.dll,FileProtocolHandler',address]);
  }
});
