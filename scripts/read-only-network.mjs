// Only for GET verification reads. Never use this around a publication/mutation.
export async function retryRead(read,maxAttempts=3){
 for(let n=1;;n++){
  try{return await read();}
  catch(error){if(n>=maxAttempts||!['ECONNRESET','ETIMEDOUT','EAI_AGAIN','ECONNREFUSED','ENETUNREACH','EHOSTUNREACH'].includes(error?.code))throw error;}
 }
}
