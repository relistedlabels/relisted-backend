import { randomInt } from "crypto"

export const generateOtp=()=>{
    return randomInt(100000,1000000).toString()
}


// 8bcf59f4-9643-4cc8-b7ee-16f63763a85d upload id
// 32a45752-264c-4c08-bd52-b7c14968c21e
// cb303d76-3109-4c04-a618-99332bc42cc7 profile id
// 0804ad48-5b61-4aa0-9075-0431cff3c2e4 upload id
// eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI4NjczYjE5OC00NjVjLTQ4NWEtYTE1MS0zY2I3MTdiMDQ1NzciLCJlbWFpbCI6Im5pbWlsbzEyMzQ1NkBnbWFpbC5jb20iLCJpYXQiOjE3Njg3ODA1MDksImV4cCI6MTc2ODg2NjkwOX0.XehoZ6cIGs4vW41LT5wrUxQ1L34q1lW_rs9acAX-CG0
