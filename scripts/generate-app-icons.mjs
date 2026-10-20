// Dependency-free rasterization of the existing N brand; run only when changing icons.
import { deflateSync } from 'node:zlib';
import { writeFile } from 'node:fs/promises';
const shapes = [
  { color: [240,107,63], points: [[.24,.36],[.5,.17],[.76,.36],[.72,.42],[.5,.26],[.28,.42]] },
  { color: [255,255,255], points: [[.32,.43],[.40,.43],[.60,.64],[.60,.43],[.68,.43],[.68,.77],[.60,.77],[.40,.56],[.40,.77],[.32,.77]] },
];
function inside(x, y, points) {
  let yes = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [a,b] = points[i], [c,d] = points[j];
    if ((b > y) !== (d > y) && x < (c-a)*(y-b)/(d-b)+a) yes = !yes;
  }
  return yes;
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of body) { crc ^= byte; for (let i=0;i<8;i++) crc=(crc>>>1)^((crc&1)?0xedb88320:0); }
  const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length); checksum.writeUInt32BE((crc^0xffffffff)>>>0);
  return Buffer.concat([length,body,checksum]);
}
for (const size of [180,192,512]) {
  const pixels = Buffer.alloc(size*(size*3+1));
  for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
    const color=[0,0,0];
    for (const dx of [.25,.75]) for(const dy of [.25,.75]) {
      let sample=[14,42,76];
      for(const shape of shapes) if(inside((x+dx)/size,(y+dy)/size,shape.points)) sample=shape.color;
      for(let c=0;c<3;c++) color[c]+=sample[c]/4;
    }
    for(let c=0;c<3;c++) pixels[y*(size*3+1)+1+x*3+c]=Math.round(color[c]);
  }
  const header=Buffer.alloc(13); header.writeUInt32BE(size);header.writeUInt32BE(size,4);header[8]=8;header[9]=2;
  await writeFile(new URL(`../assets/app-icon-${size}.png`,import.meta.url),Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]));
}
