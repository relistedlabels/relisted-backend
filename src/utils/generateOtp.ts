import { randomInt } from "crypto"

export const generateOtp=()=>{
    return randomInt(100000,1000000).toString()
}