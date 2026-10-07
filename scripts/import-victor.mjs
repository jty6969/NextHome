import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { root } from './local-db.mjs';
export async function prepareVictorData() {
  const target = path.join(root, 'assets/victor-metadata.json');
  const current = JSON.parse(await readFile(path.join(root, 'assets/properties-ai-table.json'), 'utf8'));
  const summary = JSON.parse(await readFile(path.join(root, 'NextHome-Victor/data/ai-summary/properties-ai-table.json'), 'utf8'));
  const rows = new Map(current.table.map(row => [row.id, row]));
  const source = path.join(root, 'NextHome-Victor/data/properties');
  for (const file of (await readdir(source)).filter(f => f.endsWith('.json'))) {
    const property = JSON.parse(await readFile(path.join(source, file), 'utf8'));
    const original = rows.get(property.id) || summary.table.find(row => row.id === property.id);
    rows.set(property.id, { ...enrich(original, property), victorAdditional: !rows.has(property.id) });
  }
  current.table = [...rows.values()];
  current.meta.rowCount = current.table.length;
  current.meta.dataSource = '30 套历史挂牌 + 5 套演示数据';
  await writeFile(target, JSON.stringify(current, null, 2));
  const fields=['id','listingTitle','totalPriceWan','areaSqm','bedrooms','elevator','sourceListingDate','isDemo','priceHistorySynthetic','source','surrounding','communityInfo','priceHistory'];
  const value=v=>typeof v==='object'&&v!==null?JSON.stringify(v):String(v??'');
  const escape=v=>'"'+value(v).replaceAll('"','""')+'"';
  await writeFile(path.join(root,'assets/victor-analysis.csv'),'\uFEFF'+[fields.join(','),...current.table.map(row=>fields.map(key=>escape(row[key])).join(','))].join('\r\n'));
  await writeFile(path.join(root,'assets/victor-analysis.md'),'# 合并房源分析快照\n\n数据包含历史挂牌与演示房源；不代表实时成交价。JSON 保留完整字段。\n\n| ID | 房源 | 万元 | 面积㎡ | 来源日期 | 演示 |\n|---|---|---:|---:|---|---|\n'+current.table.map(row=>'| '+[row.id,row.listingTitle,row.totalPriceWan,row.areaSqm,row.sourceListingDate,row.isDemo?'是':'否'].map(v=>value(v).replaceAll('|','／')).join(' | ')+' |').join('\n')+'\n');
  return { total: current.table.length };
}
function enrich(original, p) {
  if (!original || !/^[\w-]{1,100}$/.test(p.id)) throw Error('Invalid source listing');
  const row = { ...original, source: p.source, sourceListingDate: p.listingDate,
    priceHistory: p.priceHistory, priceHistorySynthetic: p.source.platform !== '内置演示数据',
    surrounding: p.surrounding, communityInfo: p.communityInfo,
    legacySellerUsername: p.seller.username, isDemo: p.source.platform === '内置演示数据' };
  if (row.elevator == null && /无电梯/.test(p.compromise || '')) row.elevator = '无电梯';
  return row;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await prepareVictorData()));
}
