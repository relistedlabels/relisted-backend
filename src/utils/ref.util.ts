import { v4 } from "uuid"


export const generateTransactionRef=()=>{
    const uuid =v4 
    const timeStamp =Date.now()
    const reference =`${uuid}-${timeStamp}`
    return reference
}