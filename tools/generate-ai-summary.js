/*
 * Nexthome - 房源 AI 分析表格生成器
 * 读取 data/properties/ 全部房源，逐套分析，输出 AI 可读的数据表格到 data/ai-summary/ 文件夹：
 *   1. properties-ai-table.json —— 结构化 JSON（含字段说明，最适合 AI 直接读取）
 *   2. properties-ai-table.csv  —— 电子表格格式（带 BOM，Excel 可直接打开）
 *   3. properties-ai-table.md   —— Markdown 表格（适合 LLM 上下文注入）
 * 重新运行即全量覆盖生成。
 */
const fs = require('fs');
const path = require('path');

const PROPS_DIR = path.join(__dirname, '..', 'data', 'properties');
const OUT_DIR = path.join(__dirname, '..', 'data', 'ai-summary');

// 小区挂牌参考单价（万/㎡，来自房天下小区页公开参考价）
const COMMUNITY_REF_PRICE = {
  '罗山花苑': 8.3,
  '世茂湖滨花园': 8.8,
  '汤臣一品': 20.0
};

function bandOfFloor(level, total) {
  var r = level / total;
  if (r < 0.34) return '低楼层';
  if (r < 0.67) return '中楼层';
  return '高楼层';
}

function targetBuyerOf(p) {
  var b = p.rooms.bedroom;
  if (p.area < 90) return '刚需/上车盘';
  if (p.area < 144) return '改善型家庭';
  return b <= 2 ? '高端改善（大平层两房）' : '高端改善/豪宅';
}

function priceTagOf(diffPct) {
  if (diffPct <= -8) return '明显低于参考价';
  if (diffPct <= -2) return '低于参考价';
  if (diffPct < 2) return '接近参考价';
  if (diffPct < 8) return '高于参考价';
  return '明显高于参考价';
}

// 逐套分析
function analyzeRow(p) {
  var ref = COMMUNITY_REF_PRICE[p.community];
  if (!ref) {
    ref = Math.round(p.unitPrice * 10) / 10; // 未知小区用自身单价兜底
  }
  var diffPct = Math.round((p.unitPrice - ref) / ref * 1000) / 10;
  var age = 2026 - p.buildYear;
  var roomType = p.rooms.bedroom + '室' + p.rooms.livingRoom + '厅' + p.rooms.bathroom + '卫';
  var floorBand = bandOfFloor(p.floor.level, p.floor.total);

  return {
    // ---- 基础标识 ----
    id: p.id,
    community: p.community,
    address: p.address,
    building: p.building,
    unit: p.unit,
    // ---- 核心参数 ----
    areaSqm: p.area,
    roomType: roomType,
    bedrooms: p.rooms.bedroom,
    livingRooms: p.rooms.livingRoom,
    bathrooms: p.rooms.bathroom,
    floorLevel: p.floor.level,
    floorTotal: p.floor.total,
    floorBand: floorBand,
    orientation: p.orientation,
    decoration: p.decoration,
    buildYear: p.buildYear,
    buildingAgeYears: age,
    propertyType: p.propertyType,
    // ---- 价格 ----
    totalPriceWan: p.totalPrice,
    unitPriceWanPerSqm: p.unitPrice,
    communityRefPriceWanPerSqm: ref,
    priceVsRefPct: diffPct,
    priceTag: priceTagOf(diffPct),
    priceDropped: p.priceDropCount > 0,
    daysOnMarket: p.daysOnMarket,
    // ---- 文案与卖点 ----
    listingTitle: p.title,
    highlights: (p.highlights || []).join(' / '),
    sellingPoint: p.sellingPoint,
    compromise: p.compromise,
    // ---- 配套 ----
    metro: p.surrounding && p.surrounding.metro
      ? p.surrounding.metro.line + p.surrounding.metro.station + ' ' + p.surrounding.metro.distance + 'm'
      : '',
    // ---- 分析结论 ----
    targetBuyer: targetBuyerOf(p),
    aiSummary: [
      '【' + p.community + ' ' + p.building + p.unit + '】',
      p.area + '㎡ ' + roomType + ' ' + p.orientation + '向',
      floorBand + '(' + p.floor.level + '/' + p.floor.total + '层)',
      p.buildYear + '年建' + p.decoration,
      '总价' + p.totalPrice + '万(' + p.unitPrice + '万/㎡，' + priceTagOf(diffPct) + ')',
      (p.highlights || [])[0] ? '亮点：' + (p.highlights || []).slice(0, 2).join('、') : '',
      p.compromise ? '注意：' + p.compromise : '',
      '适合：' + targetBuyerOf(p)
    ].filter(Boolean).join('，')
      .replace('，适合', '；适合')
      .replace(/。；/g, '；')  // 句号后不再叠加分号
      .replace(/。，/g, '；')
  };
}

function csvEscape(v) {
  var s = v === null || v === undefined ? '' : String(v);
  return '"' + s.replace(/"/g, '""') + '"';
}

function main() {
  var files = fs.readdirSync(PROPS_DIR).filter(function (f) { return f.endsWith('.json'); }).sort();
  var rows = files.map(function (f) {
    return analyzeRow(JSON.parse(fs.readFileSync(path.join(PROPS_DIR, f), 'utf8')));
  });

  var meta = {
    generatedAt: new Date().toISOString(),
    dataSource: 'data/properties/（35 套，采自房天下公开在售挂牌，含来源链接）',
    rowCount: rows.length,
    priceUnitNote: '总价单位=万元；单价单位=万元/㎡；价格对比=挂牌单价相对小区参考价的百分比（负数=便宜）',
    fieldNotes: {
      id: '房源唯一ID', community: '小区名', address: '地址', building: '楼栋', unit: '户号',
      areaSqm: '建筑面积（㎡）', roomType: '户型（几室几厅几卫）', bedrooms: '卧室数', livingRooms: '客厅数', bathrooms: '卫生间数',
      floorLevel: '所在楼层', floorTotal: '总楼层', floorBand: '楼层段（低/中/高）', orientation: '朝向', decoration: '装修状况',
      buildYear: '建成年份', buildingAgeYears: '房龄（年，按2026年算）', propertyType: '物业类型',
      totalPriceWan: '总价（万元）', unitPriceWanPerSqm: '挂牌单价（万元/㎡）', communityRefPriceWanPerSqm: '小区参考单价（万元/㎡）',
      priceVsRefPct: '单价相对参考价差（%，负=低于参考价）', priceTag: '价格水平标签', priceDropped: '挂牌期间是否降价', daysOnMarket: '挂牌天数',
      listingTitle: '挂牌标题', highlights: '核心亮点（/分隔）', sellingPoint: '卖家卖点描述', compromise: '缺点/妥协点',
      metro: '最近地铁', targetBuyer: '适合人群（AI 分析）', aiSummary: 'AI 一句话点评（可直接用于推荐话术）'
    }
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });

  // 1. JSON
  fs.writeFileSync(
    path.join(OUT_DIR, 'properties-ai-table.json'),
    JSON.stringify({ meta: meta, table: rows }, null, 2), 'utf8'
  );

  // 2. CSV（带 BOM，Excel 打开不乱码）
  var cols = Object.keys(rows[0]);
  var csv = '\uFEFF' + cols.join(',') + '\n' + rows.map(function (r) {
    return cols.map(function (c) { return csvEscape(r[c]); }).join(',');
  }).join('\n');
  fs.writeFileSync(path.join(OUT_DIR, 'properties-ai-table.csv'), csv, 'utf8');

  // 3. Markdown 表格
  var mdCols = ['id', 'community', 'roomType', 'areaSqm', 'floorBand', 'orientation', 'decoration', 'buildYear', 'totalPriceWan', 'unitPriceWanPerSqm', 'priceTag', 'highlights', 'targetBuyer', 'aiSummary'];
  var md = '# Nexthome 房源 AI 分析表（' + rows.length + ' 套）\n\n'
    + '> 生成时间：' + meta.generatedAt + '\n> 总价单位=万元，单价=万元/㎡；priceTag 为挂牌单价相对小区参考价的位置。\n\n'
    + '| ' + mdCols.join(' | ') + ' |\n'
    + '| ' + mdCols.map(function () { return '---'; }).join(' | ') + ' |\n'
    + rows.map(function (r) {
      return '| ' + mdCols.map(function (c) { return String(r[c]).replace(/\|/g, '，').replace(/\n/g, ' '); }).join(' | ') + ' |';
    }).join('\n');
  fs.writeFileSync(path.join(OUT_DIR, 'properties-ai-table.md'), md, 'utf8');

  console.log('已生成 ' + rows.length + ' 套房源的 AI 分析表格到 data/ai-summary/：');
  console.log('  - properties-ai-table.json');
  console.log('  - properties-ai-table.csv');
  console.log('  - properties-ai-table.md');
}

main();
