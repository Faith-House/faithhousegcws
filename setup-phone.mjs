import { readFile,writeFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preparePhoneTls } from './phone-tls.mjs';
import { privateIPv4 } from './samsung-launcher.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
try{
 const addresses=Object.entries(networkInterfaces()).flatMap(([name,items])=>items.filter(i=>!i.internal&&i.family==='IPv4'&&privateIPv4(i.address)).map(i=>({name,address:i.address})));
 const preferred=addresses.filter(i=>/wi-?fi|wireless/i.test(i.name));
 const candidates=preferred.length?preferred:addresses.filter(i=>!/^vEthernet|^WSL/i.test(i.name));
 const address=process.argv[2]||(candidates.length===1?candidates[0].address:null);
 if(!address||!addresses.some(i=>i.address===address))throw Error('Choose this computer’s Wi-Fi IPv4 address: node setup-phone.mjs YOUR_LOCAL_IP');
 await preparePhoneTls({directory:path.join(root,'private','phone-access','tls'),address,openssl:process.env.JARVIS_OPENSSL||'C:/Program Files/Git/usr/bin/openssl.exe'});
 const envFile=path.join(root,'.env.local');let text=await readFile(envFile,'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;});
 for(const [name,value]of Object.entries({JARVIS_PHONE_BIND:address,JARVIS_PHONE_PORT:3215,JARVIS_PHONE_SETUP_PORT:3214})){
  const expression=new RegExp('^'+name+'=[^\\r\\n]*','m');text=expression.test(text)?text.replace(expression,name+'='+value):text.replace(/\s*$/,'')+'\n'+name+'='+value+'\n';
 }
 await writeFile(envFile,text,{mode:0o600});
 console.log('Phone TLS certificate prepared; no certificate trust settings were changed.');
 console.log('Restart only Jarvis, then open Phone access on the central computer.');
 console.log('On the same Wi-Fi, phone setup: http://'+address+':3214/');
 console.log('Secure phone app after certificate trust: https://'+address+':3215/');
}catch(error){console.error('Phone setup could not finish: '+(error.code==='ENOENT'?'OpenSSL is missing. Install Git for Windows or set JARVIS_OPENSSL to an existing OpenSSL executable.':error.message));process.exitCode=1;}
