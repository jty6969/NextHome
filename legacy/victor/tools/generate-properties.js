/* Nexthome - 房源数据生成器
 * 数据来源：房天下（fang.com）上海站公开在售挂牌（贝壳/链家强制登录墙无法采集）
 * 采集时间：2026-09-05
 * 罗山花苑（明月路199弄，浦东碧云）15 套 + 世茂滨海花园（明月路188弄，浦东碧云）15 套
 * 运行：node tools/generate-properties.js
 */
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'data', 'properties');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

/* ============ 小区公共信息 ============ */
const COMMUNITIES = {
  lshy: {
    community: '罗山花苑',
    address: '浦东新区碧云明月路199弄',
    communityInfo: {
      name: '罗山花苑', buildYear: 2000, developer: '上海金洋置业有限公司',
      propertyFee: 1.2, greeningRate: '35%', plotRatio: '1.4',
      totalBuildings: 105, totalUnits: 826, parkingRatio: '1:0.6'
    },
    surrounding: {
      metro: { line: '9 号线', station: '蓝天路站', distance: 1100 },
      mall: ['家乐福（碧云店）1.2km', '碧云体育休闲中心 1.0km', '金桥国际商业广场 1.8km'],
      school: ['上海市实验学校东校 0.8km', '香山小学 1.0km', '冰厂田幼儿园碧云部 0.9km'],
      hospital: ['瑞东医院 1.2km', '华山医院东院 1.8km'],
      park: ['金桥公园 1.0km', '碧云绿地 0.8km']
    }
  },
  smhb: {
    community: '世茂湖滨花园',
    address: '浦东新区碧云明月路188弄',
    communityInfo: {
      name: '世茂湖滨花园', buildYear: 2004, developer: '世茂集团',
      propertyFee: 3.6, greeningRate: '60%', plotRatio: '1.2',
      totalBuildings: 32, totalUnits: 1164, parkingRatio: '1:1.5'
    },
    surrounding: {
      metro: { line: '9 号线', station: '蓝天路站', distance: 1009 },
      mall: ['家乐福（碧云店）0.9km', '碧云体育休闲中心 0.7km', '金桥国际商业广场 1.6km'],
      school: ['上海德威英国国际学校 0.8km', '上海市实验学校东校 1.2km', '冰厂田幼儿园碧云部 1.0km'],
      hospital: ['瑞东医院 0.9km', '华山医院东院 1.5km'],
      park: ['张家浜滨水绿地 0.5km', '金桥公园 1.3km']
    }
  }
};

/* ============ 卖家池（每套房一个卖家账号，密码统一 seller123） ============ */
const SELLER_NAMES = [
  '王女士', '李先生', '张女士', '陈先生', '刘女士',
  '杨先生', '赵女士', '黄先生', '周女士', '吴先生',
  '徐女士', '孙先生', '马女士', '朱先生', '胡女士'
];

/* 看房时段（未来两周的周末为主） */
function slotsFor(i) {
  var base = [
    { date: '2026-09-06', slots: ['10:00-11:00', '14:00-15:00'] },
    { date: '2026-09-07', slots: ['10:00-11:00'] },
    { date: '2026-09-13', slots: ['10:00-11:00', '14:00-15:00', '16:00-17:00'] },
    { date: '2026-09-14', slots: ['14:00-15:00'] },
    { date: '2026-09-20', slots: ['10:00-11:00', '14:00-15:00'] }
  ];
  // 不同卖家错开时段
  return base.map(function (d, di) {
    var shift = (i + di) % 3;
    return { date: d.date, slots: d.slots.slice(shift % d.slots.length).concat(d.slots.slice(0, shift % d.slots.length)) };
  });
}

function phoneFor(i) {
  var heads = ['138', '139', '137', '136', '135', '158', '159', '186', '187', '188'];
  return heads[i % heads.length] + '****' + String(2000 + i * 137).slice(-4);
}

/* ============ 罗山花苑 15 套（真实挂牌） ============
 * 字段：面积/户型/朝向/楼层/装修/年代/总价/单价 均来自房天下挂牌页
 */
const LSHY = [
  { area: 116,   br: 3, lr: 2, ba: 2, orient: '南北', price: 900,  up: 7.79,  floor: [4, 6],  deco: '简装', year: 2000, bldg: '12 号', unit: '402 室', listDate: '2026-08-12', drops: 0,
    title: '业主变现诚意出售，南北通好位置三房',
    points: ['南北通透', '户型方正', '小区花园位置', '满五年'],
    selling: '罗山花苑稀缺三房，一单元少户设计，位置安静不临路，全南户型采光好，业主置换诚意出售，价格可谈。',
    compromise: '多层 6 楼无电梯，高楼层爬楼略辛苦；装修为早年简装，可按喜好重装。',
    url: 'https://sh.esf.fang.com/chushou/3_511724027.htm' },
  { area: 121,   br: 3, lr: 2, ba: 2, orient: '南',   price: 950,  up: 7.84,  floor: [3, 6],  deco: '精装', year: 2001, bldg: '18 号', unit: '301 室', listDate: '2026-08-08', drops: 0,
    title: '户型正气大三房，上实隔壁小区，绿化多',
    points: ['户型方正', '三房朝南', '近上海市实验学校东校', '满五年'],
    selling: '121㎡ 大三房，客厅面宽 4.2 米，主卧带阳台，小区绿化高，紧邻上实东校，接送方便。',
    compromise: '总价偏高，三房预算需要 900 万以上。',
    url: 'https://sh.esf.fang.com/chushou/3_511661738.htm' },
  { area: 115.55,br: 3, lr: 2, ba: 2, orient: '南',   price: 1000, up: 8.65,  floor: [5, 6],  deco: '精装', year: 2002, bldg: '22 号', unit: '501 室', listDate: '2026-08-28', drops: 0,
    title: '新上电梯三房，电梯已经在运行，电梯高区花苑位置',
    points: ['已加装电梯', '高楼层视野好', '采光无遮挡', '拎包入住'],
    selling: '本栋已完成电梯加装并投入使用，5 楼高区视野开阔，115㎡ 三房精装保养好，罗山花苑里少见的电梯三房。',
    compromise: '电梯为后加装，公摊使用需共同维护；报价为本小区高位。',
    url: 'https://m.fang.com/esf/sh/3_432333881.html' },
  { area: 74.98, br: 2, lr: 2, ba: 1, orient: '南北', price: 588,  up: 7.84,  floor: [4, 6],  deco: '精装', year: 2002, bldg: '30 号', unit: '401 室', listDate: '2026-07-30', drops: 1,
    title: '必看好房｜上实隔壁｜二房热门户型｜不靠马路｜好楼层',
    points: ['南北通透', '热门两房', '不靠马路', '满五年'],
    selling: '75㎡ 经典两房，南北通透厅房同宽，4 楼好楼层不爬高，不靠马路安静，房东诚心出售近期必卖。',
    compromise: '单卫生间，次卧面积略小。',
    url: 'https://sh.esf.fang.com/chushou/3_426423375.htm' },
  { area: 74.85, br: 4, lr: 2, ba: 2, orient: '南',   price: 772,  up: 10.31, floor: [6, 6],  deco: '简装', year: 2000, bldg: '35 号', unit: '601 室', listDate: '2026-08-18', drops: 0,
    title: '小区中间位置，采光好，户型方正，正规复式买一层送一层',
    points: ['顶层复式', '买一层送一层', '使用面积大', '满二年'],
    selling: '顶楼正规复式，产证 75㎡ 实用近 130㎡，楼下两房楼上两房，可做四房，挑高客厅，小区中间位置采光好。',
    compromise: '顶楼无电梯，夏天略热；复式楼梯不适合老人长期居住。',
    url: 'https://sh.esf.fang.com/chushou/3_432300171.htm' },
  { area: 85.29, br: 2, lr: 2, ba: 1, orient: '南北', price: 680,  up: 7.97,  floor: [3, 6],  deco: '精装', year: 2001, bldg: '38 号', unit: '302 室', listDate: '2026-08-22', drops: 0,
    title: '罗山花苑三楼 85 平大户型，自住装修干净清爽',
    points: ['自住精装', '大两房', '有钥匙随时看', '户型方正'],
    selling: '85㎡ 大两房，业主自住五年装修保养干净，三楼不潮湿不爬高，有钥匙随时看房，产权清晰。',
    compromise: '单卫设计；装修风格偏老式，年轻买家可能需要局部翻新。',
    url: 'https://m.anjuke.com/sh/sale/S4642025165036553/' },
  { area: 69.52, br: 2, lr: 1, ba: 1, orient: '南北', price: 540,  up: 7.77,  floor: [2, 6],  deco: '简装', year: 1999, bldg: '42 号', unit: '202 室', listDate: '2026-08-05', drops: 0,
    title: '罗山花苑小两房，户型方正，满五年',
    points: ['户型方正', '低楼层方便', '满五年税费少', '近地铁'],
    selling: '69㎡ 紧凑两房，南北通透，二楼出行方便，总价低适合首套上车，满五年税费少。',
    compromise: '客厅较小，简装需重装；低楼层采光略受绿化影响。',
    url: 'https://m.anjuke.com/sh/sale/pudong-q-biyun/' },
  { area: 75,    br: 2, lr: 2, ba: 1, orient: '南',   price: 478,  up: 6.38,  floor: [1, 6],  deco: '简装', year: 1998, bldg: '46 号', unit: '101 室', listDate: '2026-07-25', drops: 1,
    title: '国际社区，虽紧贴内环线但被绿化包围，远离喧嚣',
    points: ['一楼带院', '总价低', '被绿化包围', '满五年'],
    selling: '一楼房源带小院子，窗外就是小区绿化，虽近内环但非常安静，总价 478 万为小区低位，适合养老或带娃家庭。',
    compromise: '一楼采光一般，梅雨季略潮湿；装修老旧需要翻新。',
    url: 'https://sh.esf.fang.com/chushou/3_432300162.htm' },
  { area: 75,    br: 3, lr: 2, ba: 2, orient: '南',   price: 550,  up: 7.31,  floor: [6, 6],  deco: '简装', year: 2002, bldg: '50 号', unit: '602 室', listDate: '2026-08-30', drops: 0,
    title: '电梯复式户型！买一层享两层，挑高空间随心改造',
    points: ['已加装电梯', '顶层复式', '挑高客厅', '满五年'],
    selling: '加装电梯直达顶楼复式，75㎡ 产证上下两层实用 120㎡，挑高客厅可按创意改造，三房两卫适合三代同堂。',
    compromise: '顶层复式保温隔热不如平层；改造需要额外预算。',
    url: 'https://sh.esf.fang.com/chushou/3_432333871.htm' },
  { area: 75,    br: 2, lr: 2, ba: 1, orient: '南',   price: 480,  up: 6.39,  floor: [2, 6],  deco: '简装', year: 2000, bldg: '55 号', unit: '201 室', listDate: '2026-09-01', drops: 0,
    title: '下一套成交房源，电梯房小区花园位置，价可谈',
    points: ['小区花园位置', '已加装电梯', '价格可谈', '满五年'],
    selling: '本栋已加装电梯，二楼半层即到，正对小区花园景观，房东急售价可谈，参考近期成交价性价比突出。',
    compromise: '简装空关，需要买家自行装修。',
    url: 'https://sh.esf.fang.com/chushou/3_511015159.htm' },
  { area: 116,   br: 3, lr: 2, ba: 2, orient: '南',   price: 650,  up: 5.63,  floor: [1, 6],  deco: '精装', year: 1999, bldg: '60 号', unit: '102 室', listDate: '2026-07-20', drops: 2,
    title: '业主急卖小区花园位置，南北通户型，自住5年装修，满五唯一',
    points: ['一楼带大花园', '地暖', '自住精装', '满五唯一税费低'],
    selling: '116㎡ 三房带 40㎡ 私家花园，自住五年精装带地暖，满五唯一税费极少，业主置换急卖，单价小区最低。',
    compromise: '一楼楼层低；花园使用权需与物业确认边界。',
    url: 'https://sh.esf.fang.com/chushou/3_430674002.htm' },
  { area: 75,    br: 2, lr: 2, ba: 1, orient: '南',   price: 560,  up: 7.44,  floor: [5, 6],  deco: '精装', year: 2002, bldg: '66 号', unit: '502 室', listDate: '2026-08-15', drops: 0,
    title: '从未看到如此清爽的装修，户型方正，看房随时，送车位',
    points: ['精装修清爽', '送固定车位', '地暖', '满五年'],
    selling: '5 楼采光好，装修保养得非常清爽可直接入住，带地暖，附赠一个固定租赁车位，看房随时方便。',
    compromise: '顶楼（6 层中的 5 楼为次顶）；无电梯。',
    url: 'https://sh.esf.fang.com/chushou/3_429747934.htm' },
  { area: 53,    br: 1, lr: 1, ba: 1, orient: '南北', price: 500,  up: 9.43,  floor: [4, 6],  deco: '精装', year: 2003, bldg: '72 号', unit: '401 室', listDate: '2026-08-25', drops: 0,
    title: '碧云小户型，带个车位，精装全送，租金可达 6000',
    points: ['小户型低总价', '带产权车位', '精装全送', '租金回报高'],
    selling: '53㎡ 精装一房，家具家电全送，带一个车位，碧云国际社区租赁需求旺，月租金约 6000 元，适合投资或单身自住。',
    compromise: '一房只适合单身/小两口；单价偏高。',
    url: 'https://sh.esf.fang.com/chushou/3_425534652.htm' },
  { area: 69,    br: 3, lr: 1, ba: 2, orient: '南北', price: 630,  up: 9.12,  floor: [6, 6],  deco: '精装', year: 2001, bldg: '26 号', unit: '601 室', listDate: '2026-09-02', drops: 0,
    title: '罗山花苑新出复式，看房方便',
    points: ['顶层复式', '三房两卫', '精装修', '满五年'],
    selling: '69㎡ 复式做三房两卫，楼上主卧套房设计，精装修拎包入住，楼上两层互不干扰，适合一家四口。',
    compromise: '顶楼无电梯；复式上层层高略低。',
    url: 'https://sh.esf.fang.com/chushou/3_511423339.htm' },
  { area: 69,    br: 2, lr: 2, ba: 1, orient: '南',   price: 540,  up: 7.80,  floor: [3, 6],  deco: '精装', year: 2000, bldg: '8 号',  unit: '302 室', listDate: '2026-08-10', drops: 1,
    title: '罗山花苑 2室2厅，精装修南北通精装两房',
    points: ['南北通透', '精装修', '三楼好楼层', '满五年'],
    selling: '69㎡ 精装两房，客厅带窗南北通风，三楼黄金楼层，装修保养好可拎包入住，满五年税费少。',
    compromise: '面积紧凑，餐厅位置较小。',
    url: 'https://sh.esf.fang.com/chushou/3_432071288.htm' }
];

/* ============ 世茂湖滨花园 15 套（真实挂牌） ============ */
const SMHB = [
  { area: 168.88, br: 2, lr: 2, ba: 2, orient: '南北', price: 1330, up: 7.88, floor: [18, 28], deco: '精装', year: 2004, bldg: '1 号楼', unit: '1801 室', listDate: '2026-08-06', drops: 1,
    title: '碧云社区好房，客厅可打羽毛球，总价低，带产权车位',
    points: ['大客厅大开间', '带产权车位', '南北通透', '满五年'],
    selling: '169㎡ 大两房（可改三房），客厅 60㎡ 开间阔绰可打羽毛球，南北通透，附赠产权车位，世茂湖滨总价门槛最低的一套。',
    compromise: '原始户型仅两房，改三房需自行隔断；楼层中段视野一般。',
    url: 'https://sh.esf.fang.com/chushou/3_426133348.htm' },
  { area: 165.98, br: 2, lr: 2, ba: 2, orient: '南',   price: 1399, up: 8.43, floor: [29, 30], deco: '豪装', year: 2003, bldg: '2 号楼', unit: '2902 室', listDate: '2026-08-20', drops: 0,
    title: '次顶楼，能改三房，我司价低于同行，有钥匙看房随时',
    points: ['次顶楼视野', '南北通透可改三房', '豪华装修', '有钥匙'],
    selling: '29 层次顶楼，南向正看小区湖景与别墅区，视野无遮挡，166㎡ 大两房可改三房，豪装保养好，有钥匙随时看。',
    compromise: '原始为两房户型；报价在同面积中偏高。',
    url: 'https://m.fang.com/esf/sh/3_432333872.html' },
  { area: 207.1,  br: 3, lr: 2, ba: 2, orient: '南',   price: 1718, up: 8.30, floor: [24, 30], deco: '精装', year: 2004, bldg: '3 号楼', unit: '2401 室', listDate: '2026-08-26', drops: 0,
    title: '一期新出高区带车位二次装修三房，有钥匙随时看房',
    points: ['高区景观', '带产权车位', '二次装修', '满五年'],
    selling: '207㎡ 三房，24 楼高区南向采光，业主二次装修保养新，带产权车位，有钥匙随时看房，碧云国际社区大三房。',
    compromise: '总价 1700 万级，首付门槛高。',
    url: 'https://m.anjuke.com/sh/sale/S3058547660431370/' },
  { area: 135,    br: 2, lr: 2, ba: 2, orient: '南',   price: 976,  up: 7.19, floor: [15, 28], deco: '精装', year: 2004, bldg: '4 号楼', unit: '1502 室', listDate: '2026-07-28', drops: 1,
    title: '一期正看湖景，视野开阔，双产权车位，税费各付价',
    points: ['正看湖景', '双产权车位', '税费各付', '满五年'],
    selling: '一期 135㎡ 两房，客厅主卧正看小区中心湖景，中层视野开阔，带双产权车位，报价为税费各付价，到手清晰。',
    compromise: '两房设计，改善家庭需注意房间数。',
    url: 'https://shanghai.anjuke.com/prop/view/7287856145' },
  { area: 211,    br: 3, lr: 2, ba: 3, orient: '南',   price: 1800, up: 8.53, floor: [26, 30], deco: '精装', year: 2004, bldg: '5 号楼', unit: '2601 室', listDate: '2026-08-18', drops: 0,
    title: '世茂湖滨二期新上高区景观二次装修带车位三房，拎包入住',
    points: ['高区景观', '二次装修', '带车位', '拎包入住'],
    selling: '二期 211㎡ 三房三卫，26 层高区南向，二次装修 40 万带地暖中央空调，带车位，拎包即可入住。',
    compromise: '总价高；二期临路栋座略有噪音（中高区影响小）。',
    url: 'https://shanghai.anjuke.com/prop/view/7526576259' },
  { area: 134,    br: 2, lr: 2, ba: 2, orient: '南',   price: 1120, up: 8.31, floor: [27, 29], deco: '精装', year: 2004, bldg: '6 号楼', unit: '2702 室', listDate: '2026-08-22', drops: 0,
    title: '世茂湖滨高区景观双南户型小两房，移民出售看房方便',
    points: ['高区景观', '双南户型', '移民诚售', '满五年'],
    selling: '134㎡ 小两房，27 楼高区双南朝向，客厅主卧均看湖景，业主移民诚意出售，看房方便价格可谈。',
    compromise: '两房面积大但房间数少，适合小家庭或养老。',
    url: 'https://www.anjuke.com/shanghai/cm38/p1/' },
  { area: 166,    br: 2, lr: 2, ba: 2, orient: '南',   price: 1380, up: 8.31, floor: [28, 30], deco: '精装', year: 2003, bldg: '7 号楼', unit: '2801 室', listDate: '2026-09-01', drops: 0,
    title: '次顶楼，能改三房，有钥匙看房随时，满五',
    points: ['次顶楼', '可改三房', '满五年', '有钥匙'],
    selling: '28 层次顶，南向 166㎡，户型可改三房，满五年税费少，有钥匙随时看房，业主诚意出售。',
    compromise: '现状为两房；装修为 2003 年原始精装略老。',
    url: 'https://sh.esf.fang.com/chushou/3_511484347.htm' },
  { area: 296,    br: 3, lr: 2, ba: 3, orient: '南',   price: 2950, up: 9.98, floor: [30, 30], deco: '豪装', year: 2004, bldg: '8 号楼', unit: '3001 室', listDate: '2026-08-12', drops: 0,
    title: '业主诚心卖，临河位置顶层大平层，精装修',
    points: ['顶层大平层', '临河景观', '豪华装修', '一梯一户'],
    selling: '296㎡ 顶层大平层，一梯一户私密性极强，临河位置 270° 景观，豪装带地暖中央空调，碧云终极改善户型。',
    compromise: '总价近 3000 万；顶层需关注防水维护。',
    url: 'https://sh.esf.fang.com/chushou/3_432333865.htm' },
  { area: 141,    br: 2, lr: 2, ba: 2, orient: '南',   price: 1124, up: 7.99, floor: [25, 28], deco: '豪装', year: 2004, bldg: '1 号楼', unit: '2502 室', listDate: '2026-08-16', drops: 0,
    title: '品质高区两房，附赠固定车位，俯看别墅区，送40万精装',
    points: ['高区俯看别墅区', '送固定车位', '40万豪装', '满五年'],
    selling: '25 楼高区，南向俯瞰别墅区成片绿化景观，141㎡ 两房豪装 40 万，附赠固定车位，景观与私密性兼备。',
    compromise: '两房户型；高区风大时阳台略有风声。',
    url: 'https://sh.esf.fang.com/chushou/3_431570834.htm' },
  { area: 166,    br: 3, lr: 2, ba: 2, orient: '南',   price: 1374, up: 8.28, floor: [16, 30], deco: '豪装', year: 2004, bldg: '2 号楼', unit: '1601 室', listDate: '2026-08-30', drops: 0,
    title: '钥匙房送产权双车位，全新婚装，中央空调加地暖，移民诚售',
    points: ['全新婚装', '产权双车位', '中央空调地暖', '移民诚售'],
    selling: '166㎡ 三房（原始两房已改三房），全新婚装未住，中央空调+全屋地暖，送产权双车位，移民诚售配合度高。',
    compromise: '改造三房的小房间面积约 9㎡，适合儿童房/书房。',
    url: 'https://sh.esf.fang.com/chushou/3_431570865.htm' },
  { area: 220,    br: 3, lr: 2, ba: 2, orient: '南',   price: 1805, up: 8.21, floor: [19, 30], deco: '精装', year: 2003, bldg: '3 号楼', unit: '1902 室', listDate: '2026-07-22', drops: 2,
    title: '满五年税费少，看湖景与别墅，业主着急卖',
    points: ['看湖景', '满五税费少', '业主急售', '价格可谈'],
    selling: '220㎡ 三房，19 楼楼层适中，正看湖景与别墅群，满五年税费少，业主已看好新房急售，近三月已降价两次。',
    compromise: '原始装修偏老，买家可能需要二次装修。',
    url: 'https://sh.esf.fang.com/chushou/3_431160734.htm' },
  { area: 220,    br: 3, lr: 1, ba: 2, orient: '南',   price: 1999, up: 9.10, floor: [28, 30], deco: '豪装', year: 2004, bldg: '4 号楼', unit: '2802 室', listDate: '2026-08-02', drops: 0,
    title: '碧云·世茂湖滨花园公寓 3室，高区豪装满五',
    points: ['高区楼层', '豪华装修', '大平层', '满五年'],
    selling: '220㎡ 大平层三房，28 楼高区，豪装大理石地面全屋地暖，业主自住保养极佳，满五年产权清晰。',
    compromise: '客厅为大方厅设计无独立餐厅隔断；总价高。',
    url: 'https://sh.esf.fang.com/chushou/3_432412513.htm' },
  { area: 298,    br: 6, lr: 2, ba: 4, orient: '南北', price: 1999, up: 6.71, floor: [29, 30], deco: '精装', year: 2003, bldg: '5 号楼', unit: '2901 室', listDate: '2026-08-24', drops: 0,
    title: '出国急卖，少有复式 6 房 4 卫，满五，买进价高税费少',
    points: ['顶层复式', '6房4卫', '满五年', '买进价高税费少'],
    selling: '298㎡ 顶层复式，上下两层 6 房 4 卫，适合多代同堂或做家庭会所，业主出国急卖，买进价高增值税几乎为零。',
    compromise: '复式楼梯+顶层，日常动线长；装修为早年风格。',
    url: 'https://sh.esf.fang.com/chushou/3_432412506.htm' },
  { area: 206,    br: 3, lr: 2, ba: 2, orient: '南',   price: 1395, up: 6.76, floor: [12, 30], deco: '豪装', year: 2003, bldg: '6 号楼', unit: '1201 室', listDate: '2026-09-02', drops: 1,
    title: '高区豪华装修 100 多万，业主诚意出售，拎包可入住',
    points: ['百万豪装', '三房两卫', '拎包入住', '满五年'],
    selling: '206㎡ 三房，业主 2019 年豪装花费 100 多万，全屋地暖中央空调进口家电，因工作调动诚意出售，单价小区低位。',
    compromise: '12 楼前方楼栋对视野略有遮挡；装修风格偏厚重。',
    url: 'https://sh.esf.fang.com/chushou/3_431160731.htm' },
  { area: 296,    br: 3, lr: 2, ba: 3, orient: '南',   price: 2048, up: 6.93, floor: [6, 30],  deco: '精装', year: 2003, bldg: '7 号楼', unit: '602 室', listDate: '2026-08-14', drops: 1,
    title: '业主诚心卖，临河位置精装修，看中可以谈',
    points: ['临河位置', '大平层三房', '价格可谈', '满二年'],
    selling: '296㎡ 临河大平层，低层出行方便不用等电梯，临河景观无遮挡，精装修保养好，业主诚心卖价格空间大。',
    compromise: '低楼层采光不如高区；满二不唯一有增值税。',
    url: 'https://sh.esf.fang.com/chushou/3_431160702.htm' }
];

/* ============ 组装完整房源对象 ============ */
function daysBetween(listDate) {
  var d = new Date(listDate + 'T00:00:00');
  var now = new Date('2026-09-05T00:00:00');
  return Math.max(1, Math.round((now - d) / 86400000));
}

function buildProperty(prefix, list, index, cKey) {
  var c = COMMUNITIES[cKey];
  var i = index;
  var sellerName = SELLER_NAMES[i];
  var username = prefix + String(i + 1).padStart(2, '0');
  var id = prefix.replace('seller_', '') + '-' + (i + 1);

  var priceHistory = [{ date: list.listDate, price: list.price }];
  if (list.drops > 0) {
    var drop = list.drops;
    var orig = list.price + Math.round(list.price * 0.03) * drop;
    priceHistory.unshift({ date: list.listDate, price: orig });
    priceHistory.push({ date: '2026-09-01', price: list.price });
  }

  return {
    id: id,
    community: c.community,
    building: list.bldg,
    unit: list.unit,
    city: '上海',
    district: '浦东新区',
    address: c.address,
    totalPrice: list.price,
    unitPrice: list.up,
    area: list.area,
    rooms: { bedroom: list.br, livingRoom: list.lr, bathroom: list.ba },
    floor: { level: list.floor[0], total: list.floor[1] },
    orientation: list.orient,
    decoration: list.deco,
    buildYear: list.year,
    propertyType: '住宅',
    ownershipYears: 70,
    listingDate: list.listDate,
    priceHistory: priceHistory,
    daysOnMarket: daysBetween(list.listDate),
    priceDropCount: list.drops,
    images: ['exterior', 'livingroom', 'bedroom', 'kitchen', 'bathroom', 'balcony'],
    highlights: list.points,
    sellingPoint: list.selling,
    compromise: list.compromise,
    title: list.title,
    surrounding: c.surrounding,
    communityInfo: c.communityInfo,
    seller: {
      id: username,
      username: username,
      name: sellerName,
      phone: phoneFor(i),
      avatar: sellerName[0],
      availableSlots: slotsFor(i)
    },
    source: {
      platform: '房天下（fang.com）公开在售挂牌',
      url: list.url,
      scrapedAt: '2026-09-05'
    }
  };
}

var written = [];
LSHY.forEach(function (l, i) {
  var p = buildProperty('lshy', l, i, 'lshy');
  p.seller.id = 'seller_lshy' + String(i + 1).padStart(2, '0');
  p.seller.username = p.seller.id;
  fs.writeFileSync(path.join(OUT_DIR, p.id + '.json'), JSON.stringify(p, null, 2), 'utf8');
  written.push(p.id);
});
SMHB.forEach(function (l, i) {
  var p = buildProperty('smhb', l, i, 'smhb');
  p.seller.id = 'seller_smhb' + String(i + 1).padStart(2, '0');
  p.seller.username = p.seller.id;
  fs.writeFileSync(path.join(OUT_DIR, p.id + '.json'), JSON.stringify(p, null, 2), 'utf8');
  written.push(p.id);
});

/* ============ 迁移旧的汤臣一品 5 套到文件夹（保留演示数据） ============ */
var legacyPath = path.join(__dirname, '..', 'data', 'properties.json');
if (fs.existsSync(legacyPath)) {
  var legacy = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
  legacy.forEach(function (p, i) {
    var uname = 'seller_tcyp' + String(i + 1).padStart(2, '0');
    p.seller.username = uname;
    p.seller.id = uname;
    p.source = { platform: '内置演示数据', url: '', scrapedAt: '2026-08' };
    fs.writeFileSync(path.join(OUT_DIR, p.id + '.json'), JSON.stringify(p, null, 2), 'utf8');
    written.push(p.id);
  });
}

console.log('已写入 ' + written.length + ' 套房源到 data/properties/：');
written.forEach(function (id) { console.log(' - ' + id); });
