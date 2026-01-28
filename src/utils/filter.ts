export const makeFullText=<k extends string>(
    items:Partial<Record<k,string>> |any,
    updates:Partial<Record<k,string>> |any,
    ...keys:k[]
):string=>{


const joined =keys.map((k)=>updates?.[k] ??items?.[k]??"").join(" ")
.toLowerCase()
.replace(/'/g,' ').replace(/[\W_+]/g," ")
return joined.replace(/\b(\w+)/g,"x$1")
//  return joined.replace(/\b(\w+)/g, 'x$1');



}

// search query 
export function searchQuery(text:string) {
  if (!text?.trim()) return '';

  return text
    .toLowerCase()
    .replace(/'/g, '') // remove apostrophes
    .split('|')        // support OR search
    .map((phrase) =>
      phrase
        .replace(/[\W_]+/g, ' ')
        .trim()
        .split(/\s+/) // split on any space(s)
        .filter((w) => w.length > 1)
        .map((w) => `x${w}:*`) // x + prefix search
        .join(' & ')
    )
    .filter(Boolean)
    .map((p) => `(${p})`)
    .join(' | ');
}