import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import path from 'node:path';

const fields = ['MAP_PROVIDER', 'BAIDU_PUBLIC_JS_KEY', 'AMAP_PUBLIC_JS_KEY', 'AMAP_SECURITY_JS_CODE', 'MAP_COORDINATE_SYSTEM', 'MAP_GEOCODE_CITY'];
// Only map variables are imported. Never log file contents or overwrite process.env.
export async function loadLocalMapConfig(root, environment = process.env) {
  let local = {};
  try { local = parseEnv(await readFile(path.join(root, '.env.local'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Unable to read local map configuration (.env.local).'); }
  const result=Object.fromEntries(fields.map(key => [key, String(environment[key] ?? local[key] ?? '').trim()]));
  // Reuse existing browser AK in place. Never copy credentials into source/build files.
  if(!result.BAIDU_PUBLIC_JS_KEY){
    for(const relative of ['map-config.json','legacy/victor/map-config.json']){
      let config;
      try{config=JSON.parse(await readFile(path.join(root,relative),'utf8'));}
      catch(error){if(error.code==='ENOENT')continue;throw new Error('Unable to read legacy map configuration.');}
      if(typeof config.baiduAk!=='string'||!config.baiduAk.trim()||config.baiduAk.includes('在此填入'))continue;
      result.BAIDU_PUBLIC_JS_KEY=config.baiduAk.trim();
      const c=config.center;
      if(c&&Number.isFinite(c.lng)&&Number.isFinite(c.lat)&&Math.abs(c.lng)<=180&&Math.abs(c.lat)<=90)result.BAIDU_MAP_CENTER={lng:c.lng,lat:c.lat,zoom:Number.isFinite(c.zoom)?c.zoom:11};
      break;
    }
  }
  return result;
}
