import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {Agent,request} from 'undici';
import transport from '../../scripts/cf-stable-transport.cjs';
test('stable upload transport serializes unchanged bodies on fresh connections',async()=>{
  assert.equal(transport.options.connections,1);assert.equal(transport.options.pipelining,0);assert.equal(transport.options.connect.family,4);
  let active=0,peak=0;const bodies=[],connections=new Set();
  const server=http.createServer(async(req,res)=>{
    active++;peak=Math.max(peak,active);connections.add(req.socket);let text='';for await(const chunk of req)text+=chunk;bodies.push(text);
    await new Promise(r=>setTimeout(r,10));active--;res.end('ok');
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');const agent=new Agent(transport.options);
  try{await Promise.all(['one','two','three'].map(async body=>{const r=await request('http://127.0.0.1:'+server.address().port,{dispatcher:agent,method:'POST',body});assert.equal(await r.body.text(),'ok');}));assert.equal(peak,1);assert.equal(connections.size,3);assert.deepEqual(bodies,['one','two','three']);}
  finally{await agent.close();server.close();await once(server,'close');}
});
