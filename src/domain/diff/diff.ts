export type DiffToken = { kind: "same" | "added" | "removed"; text: string };

export type DeterministicTextDiff = {
  before: string;
  after: string;
  changed: boolean;
  tokens: readonly DiffToken[];
  addedWords: readonly string[];
  removedWords: readonly string[];
};

export type AdvisoryChange =
  | { kind: "numeric-change"; before: readonly string[]; after: readonly string[] }
  | { kind: "negation-change"; before: boolean; after: boolean }
  | { kind: "modal-strength-change"; before: readonly string[]; after: readonly string[] };

const TOKEN=/\p{L}+[\p{L}\p{M}-]*|\d+(?:[.,]\d+)?|[^\s]/gu;
const NEGATIONS=new Set(["ne","nije","nisu","nema","bez"]);
const MODALS=new Set(["može","mogu","mogao","vjerojatno","upućuje","pokazuje","dokazuje","uzrokuje","sigurno"]);

function words(value:string):string[]{return value.match(TOKEN)??[];}
function lcs(a:string[],b:string[]):number[][]{
 const dp=Array.from({length:a.length+1},()=>Array<number>(b.length+1).fill(0));
 for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--)dp[i][j]=a[i]===b[j]?dp[i+1][j+1]+1:Math.max(dp[i+1][j],dp[i][j+1]);
 return dp;
}
export function diffText(before:string,after:string):DeterministicTextDiff{
 const a=words(before),b=words(after),dp=lcs(a,b);let i=0,j=0;const tokens:DiffToken[]=[];
 while(i<a.length||j<b.length){
  if(i<a.length&&j<b.length&&a[i]===b[j]){tokens.push({kind:"same",text:a[i++]});j++;continue;}
  if(j<b.length&&(i===a.length||dp[i][j+1]>=dp[i+1][j])){tokens.push({kind:"added",text:b[j++]});continue;}
  tokens.push({kind:"removed",text:a[i++]});
 }
 return {before,after,changed:before!==after,tokens,addedWords:tokens.filter(x=>x.kind==="added").map(x=>x.text),removedWords:tokens.filter(x=>x.kind==="removed").map(x=>x.text)};
}
function normalizedSet(text:string,set:Set<string>):string[]{return words(text.toLocaleLowerCase("hr-HR")).filter(x=>set.has(x));}
function numbers(text:string):string[]{return words(text).filter(x=>/^\d+(?:[.,]\d+)?$/.test(x));}
export function advisoryClassifications(before:string,after:string):AdvisoryChange[]{
 const out:AdvisoryChange[]=[];const bn=numbers(before),an=numbers(after);
 if(JSON.stringify(bn)!==JSON.stringify(an))out.push({kind:"numeric-change",before:bn,after:an});
 const bneg=normalizedSet(before,NEGATIONS).length>0,aneg=normalizedSet(after,NEGATIONS).length>0;
 if(bneg!==aneg)out.push({kind:"negation-change",before:bneg,after:aneg});
 const bm=normalizedSet(before,MODALS),am=normalizedSet(after,MODALS);
 if(JSON.stringify(bm)!==JSON.stringify(am))out.push({kind:"modal-strength-change",before:bm,after:am});
 return out;
}
