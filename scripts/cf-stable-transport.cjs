// Opt-in host transport for the locked Wrangler CLI, not deployed game code.
// Serial IPv4 connections without reuse mitigate observed upload ECONNRESET.
// No request URL, credential, body, TLS verification or retry policy is changed.
const options = Object.freeze({connections:1,pipelining:0,connect:Object.freeze({family:4})});
module.exports = {options};
if (process.env.RPG_CF_STABLE_TRANSPORT === '1') {
  const {Agent,setGlobalDispatcher} = require('undici');
  setGlobalDispatcher(new Agent(options));
}
