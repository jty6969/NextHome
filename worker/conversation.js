// Conservative, clause-scoped evidence rules shared by both advisors.
export const clauses = text => String(text).split(/[，,。；;！!？?\n]/).map(s=>s.trim()).filter(Boolean);
export const nonFact = text => /如果|假如|假设|假定|要是|朋友|同事|别人|他人|听说|例如|比如|不是|并非|不改|不要改|别改|\b(?:if|suppose|hypothetically|friend|colleague|example|not|don't)\b/i.test(text);
export function factualEvidence(input, evidence) {
  // Inspect the whole enclosing sentence: a model may quote only the number.
  const sentences=String(input).split(/[。；;！!？?\n]/);
  return sentences.some(s=>s.includes(evidence)&&!nonFact(s));
}
export const style = `Be a natural, patient property advisor with judgment. Answer the current question FIRST; knowledge questions, concerns and topic changes are not invitations to collect fields. Usually ask one necessary question, at most 1–2; ask none when unnecessary. Never repeat confirmed or deferred questions. Keep simple replies short; explain tradeoffs only when helpful. Avoid routine headings, numbered lists, full-profile recaps and repetitive acknowledgments. Do not pretend to be human, invent experience, oversell or pressure a purchase. Unknown facts remain unknown. Browse/favorite events are not hard requirements. Current structured state overrides old chat. Never claim a save or publication that has not been confirmed by the server.`;
export const buyerExamples = `Examples (illustrative, not facts):
User: 预算300万，想要两室，但每天上班太远受不了。 Reply: 我们先围绕通勤缩小范围。你平时到哪里上班，单程最多能接受多久？ Remember budget and rooms; do not ask them again.
User: 首付暂时不想说，先给我看看。 Use real supplied candidates within known constraints, disclose funding has not been assessed; do not ask down payment.
User: 如果多花50万，选择会不会好一点？ Compare supplied baseline and hypothetical candidates; NEVER change stored budget. If data is absent, say so.
User: 这套临街，我不喜欢。 Keep the reason scoped to that listing; if its identity is ambiguous ask which one, never create a global street exclusion.
User: 卖房一般需要多久？ Answer timing factors and uncertainty, never initiate collection.`;

export const buyerLabels = {
 budget:/预算|budget/i, downPayment:/首付|down payment/i, monthlyPaymentMax:/月供|monthly payment/i,
 city:/城市|city/i, familySize:/家庭人数|几口|family size/i, purpose:/用途|目的|purpose/i, firstHome:/首套|first home/i,
 workAddress:/上班|工作地点|work address/i, commuteMinutes:/通勤|commute/i,
 roomCount:/户型|几室|两室|三室|bedroom/i, minArea:/面积|area/i,maxArea:/面积上限|max.*area/i,
 needElevator:/电梯|elevator/i, metroDistance:/地铁|metro/i, floorPreference:/楼层|floor/i,
 orientation:/朝向|orientation/i,decorationPreference:/装修|decoration/i,surroundingReq:/周边|学校|school/i,otherReq:/其他要求|安静|quiet/i,
};
export function controls(input, labels=buyerLabels, previous='') {
 const result={clear:[],deferred:[],resumed:[]};
 for(const clause of clauses(input)) {
  if(nonFact(clause.replace(/don't know|prefer not/gi,'')))continue;
  for(const [key,label] of Object.entries(labels)) if(label.test(clause)) {
   if(/清空|清除|删除|取消|撤销|不再要求|不限|clear|remove|delete/i.test(clause))result.clear.push(key);
   else if(/不知道|不清楚|不确定|暂时不想说|暂不|不想说|先不|以后再|don't know|unsure|prefer not/i.test(clause))result.deferred.push(key);
   else if(/继续|恢复|现在.*(?:说|回答)|resume/i.test(clause))result.resumed.push(key);
  }
 }
 if(!result.deferred.length && /^(?:不知道|不清楚|不确定|暂时不想说|暂不提供|先看看|I don.t know|not sure)[。.!！\s]*$/i.test(input.trim())) {
   const question=String(previous).split(/[。.!！\n]/).filter(s=>/[？?]/.test(s)).at(-1)||'';
   const keys=Object.entries(labels).filter(([,label])=>label.test(question)).map(([key])=>key);
   if(keys.length===1)result.deferred.push(keys[0]);
 }
 return result;
}

export function candidateContext(input, data, listings) {
 const requested=/看看|看房|房源|推荐|候选|选择.*好|多花|比较|对比|show|recommend|compare|options/i.test(input);
 const p=data.profile,r=data.requirements;
 const hypothetical=/如果|假如|假设|if\b/i.test(input);
 const extra=input.match(/(?:多花|增加|加)\s*(\d+(?:\.\d+)?)\s*万/);
 const absolute=input.match(/预算(?:到|为|是)?\s*(\d+(?:\.\d+)?)\s*万/);
 const alternate=hypothetical?(extra&&p.budget?p.budget+Number(extra[1]):absolute?Number(absolute[1]):null):null;
 const matches=(row,budget)=>!row.isDemo&&(!budget||(Number.isFinite(row.totalPriceWan)&&row.totalPriceWan<=budget))&&(!r.roomCount||row.bedrooms===r.roomCount)&&(!r.minArea||(row.areaSqm!=null&&row.areaSqm>=r.minArea))&&(!r.maxArea||(row.areaSqm!=null&&row.areaSqm<=r.maxArea))&&(r.needElevator==null||row.elevator===r.needElevator);
 const baseline=requested?listings.filter(row=>matches(row,p.budget)):[];
 const alternative=requested&&alternate?listings.filter(row=>matches(row,alternate)):[];
 return {requested, hypotheticalBudget:alternate, baselineIds:baseline.map(p=>p.id), alternativeIds:alternative.map(p=>p.id),
  // These candidates have only been screened on structured numeric/elevator facts.
  unverified:['location','commute','eligibility','funding','textual preferences'],
  listings:[...new Map([...baseline,...alternative].map(p=>[p.id,p])).values()]};
}
