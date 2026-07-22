import {access,readFile,writeFile} from 'node:fs/promises';
import {constants as fsConstants} from 'node:fs';
import {fileURLToPath} from 'node:url';

const SPENDING_TYPES=new Set(['fixed','flexible','discretionary','exceptional']);
export const DEFAULT_CATEGORY_MAPPINGS={
  'food-vegetable':'flexible','food-meat':'flexible','food-fruit':'flexible','food-snack':'discretionary','food-drink':'discretionary',
  'shopping-daily':'flexible','shopping-clothes':'flexible','shopping-sports':'discretionary','shopping-digital':'discretionary',
  'kids-toy':'discretionary','kids-clothes':'flexible','kids-shoes':'flexible','kids-bedding':'flexible','kids-study':'flexible','kids-other':'flexible',
  'dining-restaurant':'flexible','dining-takeout':'flexible',
  'transport-transit':'flexible','transport-taxi':'flexible','transport-fuel':'flexible','transport-charging':'flexible','transport-ticket':'exceptional',
  'living-rent':'fixed','living-utility':'flexible','living-hotel':'exceptional',
  'entertainment-media':'discretionary','entertainment-movie':'discretionary','entertainment-scenic':'discretionary','entertainment-fitness':'discretionary',
  'health-medicine':'flexible','health-checkup':'flexible','social-gift':'discretionary',
};

function cleanSettings(source){
  return {schemaVersion:5,updatedAt:source.updatedAt||'',defaultBeneficiaryId:source.defaultBeneficiaryId,beneficiaries:structuredClone(source.beneficiaries)};
}
function cleanPlans(source){return {...structuredClone(source),schemaVersion:5};}
function validV4Backup(source){return !!(source&&source.backupVersion===4&&source.schemaVersion===4&&source.records&&source.records.schemaVersion===4&&Array.isArray(source.records.records)&&source.settings&&source.settings.schemaVersion===4&&source.plans&&source.plans.schemaVersion===4);}

export function convertBackup(source,{categoryMappings={}}={}){
  if(!validV4Backup(source))return {ok:false,report:{error:'只支持完整备份 v4'}};
  const mappings={...DEFAULT_CATEGORY_MAPPINGS,...categoryMappings},unmapped=new Map(),typeCounts={fixed:0,flexible:0,discretionary:0,exceptional:0},records=[];
  for(const record of source.records.records){
    const spendingType=mappings[record.categoryId];
    if(!SPENDING_TYPES.has(spendingType)){unmapped.set(record.categoryId,(unmapped.get(record.categoryId)||0)+1);continue;}
    const {categoryId,...rest}=record;records.push({...rest,spendingType});typeCounts[spendingType]++;
  }
  const originalCents=source.records.records.reduce((sum,item)=>sum+item.amountCents,0),convertedCents=records.reduce((sum,item)=>sum+item.amountCents,0),report={originalRecordCount:source.records.records.length,convertedRecordCount:records.length,originalExpenseCents:originalCents,convertedExpenseCents:convertedCents,typeCounts,unmappedCategories:[...unmapped].map(([categoryId,count])=>({categoryId,count})).sort((a,b)=>a.categoryId.localeCompare(b.categoryId))};
  if(report.unmappedCategories.length)return {ok:false,report};
  if(records.length!==source.records.records.length||convertedCents!==originalCents)return {ok:false,report:{...report,error:'转换前后记录数或支出总额不一致'}};
  const exportedAt=new Date().toISOString(),backup={appName:'CassieProject',backupVersion:5,schemaVersion:5,exportedAt,summary:{recordCount:records.length,expenseCents:convertedCents},records:{schemaVersion:5,updatedAt:exportedAt,records},settings:cleanSettings(source.settings),plans:cleanPlans(source.plans)};
  return {ok:true,backup,report};
}

async function runCli(){
  const args=process.argv.slice(2),input=args[0],output=args[1],mappingFlag=args.indexOf('--mapping');
  if(!input||!output)throw new Error('用法：node tools/convert-v4-to-v5.mjs <v4备份.json> <v5备份.json> [--mapping 映射.json]');
  try{await access(output,fsConstants.F_OK);throw new Error('输出文件已存在，请更换路径');}catch(error){if(error.code!=='ENOENT')throw error;}
  let categoryMappings={};
  if(mappingFlag>=0){const path=args[mappingFlag+1];if(!path)throw new Error('--mapping 后需要提供 JSON 文件');const parsed=JSON.parse(await readFile(path,'utf8'));categoryMappings=parsed.categoryMappings||parsed;}
  const source=JSON.parse(await readFile(input,'utf8')),result=convertBackup(source,{categoryMappings});
  process.stdout.write(JSON.stringify(result.report,null,2)+'\n');
  if(!result.ok)throw new Error(result.report.error||'仍有未映射分类，请通过 --mapping 明确指定');
  await writeFile(output,JSON.stringify(result.backup,null,2)+'\n','utf8');
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])runCli().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
