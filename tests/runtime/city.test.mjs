import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, symlink, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { authEnv, sessionCookie } from '../auth-fixture.mjs';
import { compactCityMap } from '../city-fixture.mjs';
let output, city, provider;
const previousEnv=Object.fromEntries(Object.keys(authEnv).map(key=>[key,process.env[key]]));
before(async()=>{
  Object.assign(process.env,authEnv);
  output=await mkdtemp(join(tmpdir(),'trailprint-city-api-'));
  execFileSync(process.execPath,[resolve('node_modules/typescript/bin/tsc'),'-p','tsconfig.api.json','--noEmit','false','--rootDir','.','--outDir',output],{stdio:'pipe'});
  await writeFile(join(output,'package.json'),'{"type":"module"}'); await symlink(resolve('node_modules'),join(output,'node_modules'),'dir');
  city=(await import(pathToFileURL(join(output,'api/city.js')).href)).default;
  provider=await import(pathToFileURL(join(output,'shared/city/map-provider.js')).href);
});
after(async()=>{await rm(output,{recursive:true,force:true});for(const[key,value]of Object.entries(previousEnv)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
const body={bounds:{minLat:40.17,maxLat:40.19,minLon:44.50,maxLon:44.52},buildings:true,roads:true};
async function invoke(request) {
  const result={status:0,headers:{},body:null};
  const res={setHeader(name,value){result.headers[name.toLowerCase()]=value;return this;},writeHead(status,headers={}){result.status=status;for(const[name,value]of Object.entries(headers))this.setHeader(name,value);return this;},end(value){result.body=value;return this;}};
  await city({headers:{},...request},res);return result;
}
async function headers() {const c=await sessionCookie();return{cookie:`${c.name}=${c.value}`};}
test('city endpoint compiles in plain Node, authenticates and validates bounds before fetching',async(t)=>{
  t.mock.method(globalThis,'fetch',async()=>{throw new Error('Unexpected network');});
  assert.equal((await invoke({method:'GET'})).status,405);
  assert.equal((await invoke({method:'POST',body})).status,401);
  assert.equal((await invoke({method:'POST',body:{},headers:await headers()})).status,400);
  assert.equal((await invoke({method:'POST',body:{...body,bounds:{minLat:0,maxLat:5,minLon:0,maxLon:5}},headers:await headers()})).status,413);
  assert.equal((await invoke({method:'POST',body,headers:{...await headers(),origin:'https://untrusted.example'}})).status,403);
});
test('complete multipolygon and road downloads are cached and contain no GPX data',async(t)=>{
  provider.clearCityMapCache();const fixture=compactCityMap(JSON.parse(await readFile('fixtures/city-map.osm.json','utf8')));let calls=0;
  t.mock.method(globalThis,'fetch',async(url,init)=>{calls++;assert.match(String(url),/overpass/);assert.equal(init.method,'POST');const headers=new Headers(init.headers);assert.equal(headers.get('user-agent'),'TrailPrint-3D (+https://github.com/arentant/TrailPrint-3D)');assert.equal(headers.get('accept'),'application/json');assert.match(headers.get('content-type'),/^application\/x-www-form-urlencoded/);const query=new URLSearchParams(init.body).get('data');assert.match(query,/>>/);assert.match(query,/building:part/);assert.match(query,/highway/);assert.match(query,/way\.complete;out body geom;rel\.complete;out body;/);assert.doesNotMatch(query,/nwr\[|out body geom\(/);assert.doesNotMatch(query,/gpx|trkpt/);return Response.json(fixture);});
  for(let i=0;i<2;i++){const response=await invoke({method:'POST',body,headers:await headers()});assert.equal(response.status,200);assert.deepEqual(JSON.parse(gunzipSync(response.body)),fixture);}
  assert.equal(calls,1);
});
test('empty map data succeeds and malformed, oversized and rate-limited responses are actionable',async(t)=>{
  for(const[result,status,pattern]of[[Response.json({elements:[]}),200,null],[Response.json({unexpected:[]}),502,/malformed/],[Response.json({elements:[],remark:'timeout'}),502,/could not complete/],[new Response('rate limited',{status:429}),429,/rate limited/],[new Response('oversized',{headers:{'content-length':String(50*1024*1024)}}),413,/too large/],[Response.json({elements:[{type:'node',id:1,lat:NaN,lon:44}]}),502,/invalid coordinates/]]){
    provider.clearCityMapCache();const mock=t.mock.method(globalThis,'fetch',async()=>result);
    const response=await invoke({method:'POST',body,headers:await headers()});assert.equal(response.status,status);if(pattern)assert.match(JSON.parse(response.body).error,pattern);mock.mock.restore();
  }
});
test('provider endpoint can be configured by deployment and requests are bounded',async(t)=>{
  provider.clearCityMapCache();const previous=process.env.CITY_OVERPASS_URL;process.env.CITY_OVERPASS_URL='https://maps.example.test/interpreter';
  try{t.mock.method(globalThis,'fetch',async(url)=>{assert.equal(String(url),process.env.CITY_OVERPASS_URL);return Response.json({elements:[]});});assert.equal((await invoke({method:'POST',body,headers:await headers()})).status,200);assert.equal((await invoke({method:'POST',body:JSON.stringify({...body,padding:'x'.repeat(3000)}),headers:await headers()})).status,413);}finally{if(previous===undefined)delete process.env.CITY_OVERPASS_URL;else process.env.CITY_OVERPASS_URL=previous;}
});
test('provider rejection explains access policy and is not cached',async(t)=>{
  provider.clearCityMapCache();let calls=0;
  t.mock.method(globalThis,'fetch',async()=>++calls===1?new Response('Not Acceptable',{status:406}):Response.json({elements:[]}));
  const rejected=await invoke({method:'POST',body,headers:await headers()});
  assert.equal(rejected.status,502);assert.match(JSON.parse(rejected.body).error,/406.*access policy.*CITY_OVERPASS_URL/);
  const recovered=await invoke({method:'POST',body,headers:await headers()});
  assert.equal(recovered.status,200);assert.equal(calls,2);
});
test('dense geometry is accepted without counting coordinate nodes as map features',async(t)=>{
  provider.clearCityMapCache();
  const elements=Array.from({length:6000},(_,id)=>({type:'way',id:id+1,tags:{building:'yes'},nodes:Array.from({length:32},(_,i)=>id*32+i+1),geometry:Array.from({length:32},(_,i)=>({lat:40.18+i*0.000001,lon:44.51}))}));
  assert.ok(elements.length+elements.reduce((n,e)=>n+e.geometry.length,0)>provider.MAX_CITY_ELEMENTS);
  t.mock.method(globalThis,'fetch',async()=>Response.json({elements}));
  const response=await invoke({method:'POST',body,headers:await headers()});
  assert.equal(response.status,200);assert.equal(JSON.parse(gunzipSync(response.body)).elements.length,6000);
});
test('pretty provider JSON has a bounded allowance while normalized data and geometry remain bounded',async(t)=>{
  provider.clearCityMapCache();
  let mock=t.mock.method(globalThis,'fetch',async()=>new Response(' '.repeat(25*1024*1024)+'{"elements":[]}'));
  assert.equal((await invoke({method:'POST',body,headers:await headers()})).status,200);mock.mock.restore();
  provider.clearCityMapCache();
  mock=t.mock.method(globalThis,'fetch',async()=>Response.json({elements:[],padding:'x'.repeat(provider.MAX_CITY_BYTES)}));
  const response=await invoke({method:'POST',body,headers:await headers()});
  assert.equal(response.status,413);assert.match(JSON.parse(response.body).error,/map data is too large/);
  assert.throws(()=>provider.validateCityMapData({elements:[{type:'way',id:1,nodes:Array(1_000_001).fill(1)}]}),/too detailed/);
  assert.throws(()=>provider.validateCityMapData({elements:[{type:'way',id:1,geometry:[{lat:91,lon:44}]}]}),/invalid coordinates/);
  assert.throws(()=>provider.validateCityMapData({elements:[{type:'relation',id:1,members:[{type:'way',ref:2,geometry:[{lat:40,lon:NaN}]}]}]}),/invalid coordinates/);
});
