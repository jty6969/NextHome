// Shared by current messages and the one-time migration of existing seller chats.
// Completion, stored fields and assistant replies are never evidence of sale intent.
export function sellingIntent(input, modelIntent) {
  const text = String(input || '').trim();
  const anotherHome = /(?:另一|第二|第三|另外一)套|\b(?:another|second|third) (?:home|house|property|apartment)\b/i.test(text);
  const hypothetical = /^(?:(?:请问|我想问|想问)[，,:：\s]*)?(?:如果|假如|假设|假定|万一|if\b|suppose\b|assuming\b|hypothetically\b)/i.test(text);
  const knowledgeLead = /^(?:(?:我|我们)(?:想|要|希望)(?:先)?(?:了解|咨询|问|知道|弄清楚)|(?:想|要)(?:先)?了解|咨询(?:一下)?|(?:什么是|怎么|如何)|卖房(?:知识|流程|税费)|I (?:want|would like) to (?:know|learn|understand|ask)|what\b|how\b|can you explain)/i.test(text);
  const explicit = /^(?:卖房|出售|挂牌|卖掉)(?:[。！.!\s]*|(?:这套|我的|房子|房屋)[^?？]*)$|(?:我要|我想|我打算|我决定|我确定|准备|计划|希望|帮我|想要|想|要|打算)\s*(?:把[^，。！？]{1,20})?(?:出售|卖掉|卖房|卖这|卖我|挂牌|置换|卖(?=[\d一二三四五六七八九十百千万]))|(?:我的房子|这套房|房子)(?:准备|要|打算)?(?:出售|卖掉|挂牌)|(?:我要|我想|打算|准备)?卖旧买新|\b(?:I (?:want|plan|intend|would like|am going|need|am ready|have decided) to (?:sell|list)|I(?:'m| am) (?:selling|listing)|sell my|list my|help me (?:sell|list))\b/i.test(text);
  const consultation = hypothetical || knowledgeLead || (/^(?:请问)|流程|税费|知识|\bwhat\b|\bhow\b/i.test(text) && !explicit);
  // Bare “取消/cancel” still means declining a pending field change. Withdrawal
  // must refer to the sale/listing itself; refusing an agent is not withdrawal.
  const withdrawalText = text.replace(/不(?:想|要)?卖(?:房)?给|不(?:想|要)?卖[^，,。.!！?？;；\n]{0,8}(?:低于|少于)|(?:不要|别|不)取消|(?:不是|并非)不卖|\b(?:sell|selling) (?:to|below|under)\b/gi,'');
  const withdrawal = /(?:取消|撤销|停止|暂停)(?:出售|卖房|挂牌)|(?:不想|不打算|不准备|不考虑|不再|还不|暂不|先不|暂时不).{0,3}(?:出售|卖房|卖掉|挂牌)|不卖(?=了|房|这套|我的|自己的|[。！.!，,\s]|$)|\b(?:don't|do not|not ready to|not planning to) (?:want to )?(?:sell|list)\b|\bI(?:'m| am) not (?:selling|listing)\b|\b(?:cancel|withdraw|pause|stop) (?:my |the )?(?:listing|sale)\b/i.test(withdrawalText);
  const evidenced = modelIntent?.sell === true && typeof modelIntent.evidence === 'string' && text.includes(modelIntent.evidence)
    && /(?:我|my|I\b).*(?:出售|挂牌|卖|sell|list)|(?:出售|挂牌|卖|sell|list).*(?:我|my)/i.test(modelIntent.evidence);
  return { anotherHome, consultation, active:anotherHome || hypothetical || knowledgeLead ? undefined : withdrawal ? false : consultation ? undefined : explicit || evidenced ? true : undefined };
}
