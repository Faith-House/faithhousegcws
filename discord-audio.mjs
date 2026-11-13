export function pcmToWhisperWave(pcm){
 if(!Buffer.isBuffer(pcm)||pcm.length<48000||pcm.length>20*48000*4||pcm.length%4)throw Error('Use a clear voice request under twenty seconds.');
 const count=Math.floor(pcm.length/12),wave=Buffer.alloc(44+count*2);
 wave.write('RIFF',0);wave.writeUInt32LE(wave.length-8,4);wave.write('WAVEfmt ',8);wave.writeUInt32LE(16,16);wave.writeUInt16LE(1,20);wave.writeUInt16LE(1,22);wave.writeUInt32LE(16000,24);wave.writeUInt32LE(32000,28);wave.writeUInt16LE(2,32);wave.writeUInt16LE(16,34);wave.write('data',36);wave.writeUInt32LE(count*2,40);
 for(let i=0;i<count;i++){let sum=0;for(let j=0;j<6;j++)sum+=pcm.readInt16LE(i*12+j*2);wave.writeInt16LE(Math.round(sum/6),44+i*2);}return wave;
}
export function waveToDiscordPcm(wave){
 if(!Buffer.isBuffer(wave)||wave.length<44||wave.length>8*1024*1024||wave.toString('ascii',0,4)!=='RIFF'||wave.toString('ascii',8,12)!=='WAVE')throw Error('Unsupported local speech audio.');
 let format,samples;
 for(let i=12;i+8<=wave.length;){const size=wave.readUInt32LE(i+4),end=i+8+size;if(end>wave.length)throw Error('Incomplete speech audio.');const name=wave.toString('ascii',i,i+4);if(name==='fmt '){if(size<16)throw Error('Invalid speech format.');format={encoding:wave.readUInt16LE(i+8),channels:wave.readUInt16LE(i+10),rate:wave.readUInt32LE(i+12),bits:wave.readUInt16LE(i+22)};}if(name==='data')samples=wave.subarray(i+8,end);i=end+(size%2);}
 if(!format||!samples?.length||format.encoding!==1||format.bits!==16||![1,2].includes(format.channels)||format.rate<8000||format.rate>96000||samples.length%(format.channels*2))throw Error('Unsupported local speech PCM format.');
 const frames=samples.length/(format.channels*2),count=Math.floor(frames*48000/format.rate),out=Buffer.alloc(count*4);
 for(let i=0;i<count;i++){const at=i*format.rate/48000,index=Math.floor(at),fraction=at-index,next=Math.min(index+1,frames-1);for(let channel=0;channel<2;channel++){const c=Math.min(channel,format.channels-1);const a=samples.readInt16LE((index*format.channels+c)*2),b=samples.readInt16LE((next*format.channels+c)*2);out.writeInt16LE(Math.round(a+(b-a)*fraction),i*4+channel*2);}}
 return out;
}
export const discordWakeQuestion=text=>text.replaceAll('’',"'").trim().match(/^(?:hey\s+)?jarvis\b[,.:!?\s]*(.+)$/i)?.[1]?.trim()||null;
