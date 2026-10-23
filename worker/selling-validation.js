// The server is authoritative for readiness, including false elevator values.
export const basicFields = ['city','district','community','address','areaSqm','layout','floorLevel','floorTotal','orientation','elevator','decoration','occupancy'];
// The reason for selling is private and optional, not a condition for saving a draft.
export const saleFields = ['priceWan'];
export const requiredFields = [...basicFields, ...saleFields];
export const unknown = value => typeof value === 'string' && /不确定|不清楚|不知道|暂不|待补充|可能|大概|也许|或|还是|\b(?:or|unknown|unsure|uncertain|maybe|approximately|not sure|prefer not|tbd)\b/i.test(value);
export function listingValidation(fields, pending = {}) {
  const missing = requiredFields.filter(key => fields[key] == null || fields[key] === '');
  const invalid = requiredFields.filter(key => fields[key] != null && unknown(fields[key]));
  for(const key of ['city','district','community','address','layout','orientation','decoration','occupancy','reason'])if(fields[key]!=null&&(typeof fields[key]!=='string'||!fields[key].trim()||fields[key].length>500))invalid.push(key);
  for (const key of ['floorLevel','floorTotal']) if (fields[key] != null && (!Number.isInteger(fields[key]) || fields[key] < 1 || fields[key] > 1000)) invalid.push(key);
  if (fields.floorLevel > fields.floorTotal) invalid.push('floorLevel','floorTotal');
  for (const key of ['areaSqm','priceWan']) if (fields[key] != null && (typeof fields[key] !== 'number' || !Number.isFinite(fields[key]) || fields[key] <= 0 || fields[key] > (key === 'areaSqm' ? 100000 : 1000000))) invalid.push(key);
  if (fields.elevator != null && typeof fields.elevator !== 'boolean') invalid.push('elevator');
  if (fields.occupancy != null && !['自住','空置','出租','owner-occupied','vacant','rented'].includes(fields.occupancy)) invalid.push('occupancy');
  const unfinished = new Set([...missing,...invalid,...Object.keys(pending)]);
  return { missing, invalid:[...new Set(invalid)], stage:basicFields.some(key => unfinished.has(key)) ? 1 : 2,
    complete:!missing.length && !invalid.length && !Object.keys(pending).length };
}
