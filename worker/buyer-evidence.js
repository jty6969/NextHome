// Model patches are proposals. Only facts grounded in the latest user message may persist.
const numeric = new Set(['familySize','budget','downPayment','monthlyPaymentMax','commuteMinutes','roomCount','minArea','maxArea','metroDistance']);
const subjects = {
  budget:/预算|总价|budget|price/i, downPayment:/首付|down\s*payment/i,
  monthlyPaymentMax:/月供|monthly\s*(?:payment|mortgage)/i,
  familySize:/口|人|family|people|household/i, roomCount:/室|房|bedroom|\bbr\b/i,
  commuteMinutes:/通勤|commut/i, metroDistance:/地铁|metro|subway/i,
};
function number(raw) {
  if (/^\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
  const digits={零:0,一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};
  let total=0,digit=0;
  for(const c of raw){if(c in digits)digit=digits[c];else if('十百千'.includes(c)){total+=(digit||1)*({十:10,百:100,千:1000}[c]);digit=0;}else return NaN;}
  return total+digit;
}
export function buyerEvidenceAllows(key, value, quote, input) {
  if(typeof quote!=='string'||!quote.trim()||quote.length>500||!input.includes(quote))return false;
  // Conservative: do not persist scenario questions, uncertain claims or refusals.
  if(/如果|假如|假设|假設|要是|\b(?:if|suppose|hypothetically)\b/i.test(input))return false;
  if(/不确定|不知道|不清楚|暂不|不想说|可能|也许|\b(?:maybe|unsure|unknown)\b|not sure|don't know|prefer not/i.test(quote))return false;
  if(value===null)return /清空|删除|清除|\b(?:clear|remove|delete)\b/i.test(quote);
  if(numeric.has(key)){
    if(typeof value!=='number'||!Number.isFinite(value)||value<0)return false;
    if(subjects[key]&&!subjects[key].test(quote))return false;
    if(/不是|不要|不按|并非|取消|\bnot\b|don't/i.test(quote))return false;
    let pattern,scale=()=>1;
    const amount='([\\d.零一二两三四五六七八九十百千]+)\\s*';
    if(['budget','downPayment','monthlyPaymentMax'].includes(key)){
      if(/美元|港币|港元|欧元|英镑|\b(?:USD|HKD|EUR|GBP)\b|US\$|dollars?/i.test(quote))return false;
      if(/million|\bwan\b/i.test(quote)&&!/人民币|元|yuan|CNY|RMB/i.test(quote))return false;
      pattern=new RegExp(amount+'(万元?|元|million|wan|yuan|CNY|RMB)','gi');
      scale=unit=>(/million/i.test(unit)?1e6:/万|wan/i.test(unit)?1e4:1)/(key==='monthlyPaymentMax'?1:1e4);
    }else if(['minArea','maxArea'].includes(key)){
      // Approximate areas remain conversational preferences, not exact minimums/maximums.
      if(/左右|大概|大约|约|about|around|approximately/i.test(quote))return false;
      pattern=new RegExp(amount+'(平方米|平米|平|㎡|m²|sqm|square meters?|square feet|sqft)','gi');
      scale=unit=>/feet|sqft/i.test(unit)?.09290304:1;
    }else if(key==='commuteMinutes')pattern=new RegExp(amount+'(分钟|minutes?|mins?)','gi');
    else if(key==='metroDistance')pattern=new RegExp(amount+'(米|meters?|m\\b)','gi');
    else pattern=/([\d.零一二两三四五六七八九十百千]+)/g;
    return [...quote.matchAll(pattern)].some(m=>Math.abs(number(m[1])*scale(m[2]||'')-value)<.000001);
  }
  if(key==='needElevator'){
    if(!/电梯|elevator|lift/i.test(quote)||/但|除非|unless|\bbut\b/i.test(quote))return false;
    const no=/不要|不需要|无电梯|没有电梯|no elevator|without|don't need/i.test(quote);
    return value===false?no:value===true&&!no&&/有|需要|必须|要电梯|need|must|with/i.test(quote);
  }
  if(key==='firstHome'){
    if(!/首套|首次购房|名下无房|二套|first home|second home/i.test(quote))return false;
    const no=/不是首套|非首套|二套|not.*first home|second home/i.test(quote);
    return value===false?no:value===true&&!no;
  }
  if(typeof value!=='string')return false;
  if(key==='purpose')return value==='自住'?/自住|self.?occup|live in/i.test(quote)&&!/不自住|非自住|not.*live in/i.test(quote):value==='投资'?/投资|invest/i.test(quote)&&!/不投资|非投资|not.*invest/i.test(quote):quote.includes(value);
  // Free-text preferences retain the user's wording, including negation and conditions.
  return quote.toLowerCase().includes(value.toLowerCase());
}
