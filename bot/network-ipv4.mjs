// Process-local IPv4 routing for Telegram/Workers; preserve hostname and TLS checks.
// This machine's automatic dual-stack selection intermittently resets those connections.
import dns from 'node:dns';import net from 'node:net';
net.setDefaultAutoSelectFamily(false);
const originalLookup=dns.lookup;
dns.lookup=function(host,options,callback){
 if(typeof options==='function'){callback=options;options={};}
 if(host==='api.telegram.org'||host.endsWith('.workers.dev'))return originalLookup.call(dns,host,{...(typeof options==='object'?options:{}),family:4},callback);
 return originalLookup.call(dns,host,options,callback);
};
