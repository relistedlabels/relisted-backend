
export function connectId(id: string) {
  return { connect: { id } };
}
export const createAttachments=(uploads?:string[])=>{
     if (!uploads || uploads.length === 0) return undefined;

return {
    create:{
        uploads:{
            connect:uploads?.map((id)=>({id}))
        }
    }
}
}