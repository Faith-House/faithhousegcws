import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { X509Certificate } from 'node:crypto';
import { privateIPv4 } from './samsung-launcher.mjs';
const exec = promisify(execFile);
export async function preparePhoneTls({ directory, address, openssl = 'C:/Program Files/Git/usr/bin/openssl.exe' } = {}) {
  if (!privateIPv4(address)) throw Error('Choose a private LAN IPv4 address for phone access.');
  await access(openssl); await mkdir(directory,{recursive:true});
  const file=name=>path.join(directory,name);
  const run=args=>exec(openssl,args,{windowsHide:true,maxBuffer:1024*1024});
  const exists=name=>access(file(name)).then(()=>true,()=>false);
  const hasCa=await exists('ca.pem'),hasKey=await exists('ca.key');
  if(hasCa!==hasKey)throw Error('The local phone CA is incomplete. Preserve its files and repair it before continuing.');
  if(!hasCa)await run(['req','-x509','-newkey','rsa:2048','-nodes','-days','1825','-subj','/CN=Jarvis Local Phone CA','-addext','basicConstraints=critical,CA:TRUE,pathlen:0','-addext','keyUsage=critical,keyCertSign,cRLSign','-keyout',file('ca.key'),'-out',file('ca.pem')]);
  let valid=false;
  if(await exists('server.pem')&&await exists('server.key')){try{const certificate=new X509Certificate(await readFile(file('server.pem')));valid=Boolean(certificate.checkIP(address))&&Date.parse(certificate.validTo)>Date.now()+86400000;}catch{}}
  if(!valid){
    await run(['req','-new','-newkey','rsa:2048','-nodes','-subj','/CN=Jarvis Phone','-keyout',file('server.key'),'-out',file('server.csr')]);
    await writeFile(file('server.ext'),'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:'+address+',IP:127.0.0.1,DNS:localhost\n',{mode:0o600});
    await run(['x509','-req','-in',file('server.csr'),'-CA',file('ca.pem'),'-CAkey',file('ca.key'),'-CAcreateserial','-days','365','-sha256','-extfile',file('server.ext'),'-out',file('server.pem')]);
  }
  await run(['x509','-in',file('ca.pem'),'-outform','DER','-out',file('jarvis-local-ca.cer')]);
  const ca=new X509Certificate(await readFile(file('ca.pem')));
  return {address,caFingerprint:ca.fingerprint256};
}
