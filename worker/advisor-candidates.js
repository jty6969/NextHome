// Exclude known numeric/hard mismatches before language generation. Unknown != match.
export function asksForExamples(input) {
  if(/不要.*推荐|别.*推荐|不用.*推荐|不想.*看房|don't.*recommend|do not.*recommend/i.test(input))return false;
  return /先.*(?:推荐|看看房|看几套|看几个)|直接.*(?:推荐|讲几个房|看房)|推荐.*(?:几个|几套|房子|房源)|随便看看|给我.*(?:房源|几套房)|show me.*(?:homes|properties|listings)|recommend.*(?:homes|properties|listings|first)/i.test(input);
}
export function selectAdvisorCandidates(listings, {profile:p,requirements:r}, limit=12) {
  const candidates=[];let excluded=0;
  for(const listing of listings){
    const unknown=[];let mismatch=false;
    const compare=(key,required,passes)=>{
      if(!required)return;
      const value=listing[key];
      if(value==null||value===''||(key!=='elevator'&&(typeof value!=='number'||!Number.isFinite(value))))unknown.push(key);
      else if(!passes(value))mismatch=true;
    };
    compare('totalPriceWan',p.budget!=null,value=>value<=p.budget);
    compare('areaSqm',r.minArea!=null,value=>value>=r.minArea);
    compare('areaSqm',r.maxArea!=null,value=>value<=r.maxArea);
    compare('bedrooms',r.roomCount!=null,value=>value>=r.roomCount);
    // false means the buyer does not require an elevator, not that an elevator is forbidden.
    compare('elevator',r.needElevator===true,value=>value===true);
    if(mismatch)excluded++;
    else candidates.push({...listing,criteriaUnknown:[...new Set(unknown)]});
  }
  candidates.sort((a,b)=>a.criteriaUnknown.length-b.criteriaUnknown.length);
  return {listings:candidates.slice(0,limit),eligibleCount:candidates.length,excludedCount:excluded,truncated:candidates.length>limit};
}
