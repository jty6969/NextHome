import test from 'node:test';
import assert from 'node:assert/strict';
import { advisorGuidance } from '../worker/advisor-guidance.js';
import { buyerEvidenceAllows } from '../worker/buyer-evidence.js';
import { listingValidation } from '../worker/selling-validation.js';
import { selectAdvisorCandidates, asksForExamples } from '../worker/advisor-candidates.js';

test('all runtime modes include the advisor playbook, evidence boundaries and actual capabilities',()=>{
  for(const mode of ['buy','sell','analysis']){
    const prompt=advisorGuidance({mode,language:'en',date:'2026-10-21'});
    for(const fragment of ['2026-10-21','Reply in English','1–2','先识别并回答','没有联网搜索','不能说','私密底价'])assert.ok(prompt.includes(fragment),fragment);
  }
  assert.match(advisorGuidance({mode:'analysis',date:'2026-10-21'}),/不强迫补齐五类画像/);
  assert.match(advisorGuidance({mode:'sell',date:'2026-10-21'}),/出售原因可选/);
});
test('buyer changes require exact current evidence, correct units and factual rather than hypothetical intent',()=>{
  for(const [key,value,quote]of [['budget',500,'预算500万元'],['downPayment',180,'首付180万元'],['monthlyPaymentMax',10000,'月供上限1万元'],['roomCount',3,'三房'],['needElevator',false,'不需要电梯'],['minArea',90,'至少90平方米']])assert.equal(buyerEvidenceAllows(key,value,quote,quote),true,quote);
  for(const [key,value,quote,input]of [
    ['budget',600,'预算600万元','如果预算600万元会怎样'],
    ['budget',500,'预算500','预算500'],
    ['budget',500,'budget 5 million USD','budget 5 million USD'],
    ['budget',500,'budget 5 million','budget 5 million'],
    ['budget',500,'预算500万元','我没说过这个预算'],
    ['budget',500,'预算不是500万元','预算不是500万元'],
    ['minArea',90,'90平左右','90平左右'],
    ['needElevator',false,'没电梯但只接受一楼','没电梯但只接受一楼'],
    ['city','杭州','上海','上海'],
    ['budget',null,'预算500万元','预算500万元'],
  ])assert.equal(buyerEvidenceAllows(key,value,quote,input),false,quote);
  assert.equal(buyerEvidenceAllows('budget',500,'budget 5 million CNY','budget 5 million CNY'),true);
  assert.equal(buyerEvidenceAllows('budget',null,'清空预算','清空预算'),true);
});
test('seller reason is optional but actual listing facts and asking price still gate review',()=>{
  const fields={city:'上海',district:'浦东',community:'演示小区',address:'演示地址',areaSqm:90,layout:'两房',floorLevel:2,floorTotal:10,orientation:'南',elevator:false,decoration:'简装',occupancy:'空置',priceWan:500};
  assert.equal(listingValidation(fields).complete,true);
  delete fields.priceWan;
  assert.deepEqual(listingValidation(fields).missing,['priceWan']);
});
test('candidate selection excludes known budget/size/room/elevator violations and labels unknown facts',()=>{
  const base={totalPriceWan:490,areaSqm:90,bedrooms:3,elevator:true};
  const listings=[{id:'good',...base},{id:'expensive',...base,totalPriceWan:600},{id:'small',...base,areaSqm:80},{id:'few-rooms',...base,bedrooms:2},{id:'stairs',...base,elevator:false},{id:'unknown',...base,elevator:null}];
  const data={profile:{budget:500},requirements:{minArea:90,roomCount:3,needElevator:true}};
  const result=selectAdvisorCandidates(listings,data);
  assert.deepEqual(result.listings.map(p=>p.id),['good','unknown']);assert.equal(result.excludedCount,4);assert.deepEqual(result.listings[1].criteriaUnknown,['elevator']);
  data.requirements.needElevator=false;assert.ok(selectAdvisorCandidates(listings,data).listings.some(p=>p.id==='stairs'));
});
test('explicit requests for examples allow exploration, without treating all intake as recommendation requests',()=>{
  for(const input of ['你先推荐','你直接先讲几个房子','先看看房','show me some properties'])assert.equal(asksForExamples(input),true,input);
  for(const input of ['我要买房','预算500万元','不要先推荐，我问的是费用','你好'])assert.equal(asksForExamples(input),false,input);
});
