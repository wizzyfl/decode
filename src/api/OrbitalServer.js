/**
 * ORBITAL REASONING SERVER v2
 * ============================
 * Production HTTP + SSE streaming server.
 * Concept: Wisam | Implementation: Claude
 */

const http          = require('http');
const fs_           = require('fs');
const path_         = require('path');
const OrbitalCore   = require('./OrbitalCore');
const BooleanParser = require('../mcp/BooleanParser');

const PORT   = process.env.PORT || 3000;
const PUBLIC = path_.join(__dirname, '../../public');
const core   = new OrbitalCore({ verbose: false, cachePath: path_.join(__dirname, '../../.orbital_cache.json') });
const parser = new BooleanParser();

// Live stream clients
const streamClients = new Set();
function broadcast(event) {
  const msg = JSON.stringify(event);
  streamClients.forEach(res => { try { res.write(`data: ${msg}\n\n`); } catch(_){} });
}

function send(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(JSON.stringify(data, null, 2));
}

function fail(res, msg, status = 400) { send(res, { error: msg }, status); }

function readBody(req) {
  return new Promise((ok, no) => {
    let d = '';
    req.on('data', c => d += c);
    req.on('end', () => { try { ok(d ? JSON.parse(d) : {}); } catch(e) { no(new Error('Invalid JSON')); } });
    req.on('error', no);
  });
}

function inferTask(examples, n) {
  const fns = {
    parity:   b => b.reduce((a,x)=>a^x,0)&1,
    majority: b => b.reduce((a,x)=>a+x,0) > n/2 ? 1 : 0,
    and:      b => b.every(x=>x===1)?1:0,
    or:       b => b.some(x=>x===1)?1:0,
  };
  for (const [t,fn] of Object.entries(fns)) {
    if (examples.every(e => fn(e.input)===e.output)) return {task:t, confidence:1.0};
  }
  for (let k=1;k<=n;k++) {
    if (examples.every(e => (e.input.reduce((a,b)=>a+b,0)>=k?1:0)===e.output)) return {task:'threshold',k,confidence:1.0};
  }
  return null;
}

const TOOL_SCHEMA = {
  name: 'orbital_reason',
  description: 'Exact discrete logic solver. Parity, majority, threshold, AND, OR, XOR, NOR, NAND on binary inputs. 100% exact. Scales to 64+ bits. Also evaluates boolean expressions.',
  input_schema: {
    type: 'object', required: ['task'],
    properties: {
      task:       { type:'string', enum:['parity','majority','threshold','and','or','xor','nor','nand','expression','auto'] },
      bits:       { type:'array', items:{ type:'integer', enum:[0,1] } },
      k:          { type:'integer' },
      expression: { type:'string' },
      values:     { type:'object' },
      question:   { type:'string' },
    },
  },
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { send(res, {}); return; }
  const url = req.url.split('?')[0];
  const t0  = Date.now();

  // SSE stream
  if (url === '/stream') {
    res.writeHead(200, { 'Content-Type':'text/event-stream', 'Cache-Control':'no-cache', 'Connection':'keep-alive', 'Access-Control-Allow-Origin':'*' });
    res.write(`data: ${JSON.stringify({type:'connected',ts:Date.now()})}\n\n`);
    streamClients.add(res);
    const hb = setInterval(() => { try { res.write(`data: ${JSON.stringify({type:'ping',ts:Date.now()})}\n\n`); } catch(_){ clearInterval(hb); } }, 25000);
    req.on('close', () => { streamClients.delete(res); clearInterval(hb); });
    return;
  }

  try {
    if (req.method === 'GET' && url === '/') {
      const f = path_.join(PUBLIC,'index.html');
      if (fs_.existsSync(f)) { res.writeHead(200,{'Content-Type':'text/html'}); res.end(fs_.readFileSync(f)); }
      else send(res, { name:'Orbital v2', status:'ready', endpoints:['/health','/status','/solve','/reason','/verify_expression','/discover','/stream','/tools'] });
      return;
    }

    if (req.method === 'GET' && url === '/health')   { send(res, {status:'ok',uptime:process.uptime(),clients:streamClients.size}); return; }
    if (req.method === 'GET' && url === '/status')   { send(res, {status:'ready',...core.getStats(),uptime:process.uptime(),streamClients:streamClients.size}); return; }
    if (req.method === 'GET' && url === '/tools')    { send(res, {tools:[TOOL_SCHEMA]}); return; }
    if (req.method === 'GET' && url === '/programs') { send(res, {programs:core.cache.list(),total:core.cache.size()}); return; }
    if (req.method === 'GET' && url === '/v1/models'){ send(res, {object:'list',data:[{id:'orbital-reasoning-v2',object:'model'}]}); return; }

    if (req.method === 'POST' && url === '/solve') {
      const b = await readBody(req);
      if (!b.task || !Array.isArray(b.bits)) { fail(res,'task and bits required'); return; }
      const result = await core.solve({task:b.task, bits:b.bits, k:b.k});
      const out = {...result, latencyMs: Date.now()-t0};
      broadcast({type:'solve', task:b.task, bits:b.bits.length, answer:result.answer, ms:out.latencyMs});
      send(res, out);
      return;
    }

    if (req.method === 'POST' && url === '/verify_expression') {
      const b = await readBody(req);
      if (!b.expression) { fail(res,'expression required'); return; }
      const parsed = parser.parse(b.expression);
      if (!parsed.valid) { fail(res,'Cannot parse: '+parsed.error); return; }
      let ev = null;
      if (b.values && Object.keys(b.values).length>0) { try { ev = parser.evaluate(parsed,b.values); } catch(_){} }
      const taskType = parser.inferTaskType(parsed);
      const bits = b.values ? parsed.variables.map(v=>b.values[v]??0) : Array(parsed.variables.length).fill(0);
      const result = await core.solve({task:taskType, bits, k:parsed.threshold});
      send(res, {expression:b.expression, variables:parsed.variables, description:parsed.description, evaluation:ev, task:taskType, answer:result.answer, answerText:result.answerText, verified:result.verifier?.consistent??null, program:result.verifier?.program??null, latencyMs:Date.now()-t0});
      return;
    }

    if (req.method === 'POST' && url === '/discover') {
      const b = await readBody(req);
      if (!Array.isArray(b.examples)||b.examples.length<2) { fail(res,'Need at least 2 examples'); return; }
      const n = b.examples[0].input.length;
      const found = inferTask(b.examples, n);
      if (found) {
        const result = await core.solve({task:found.task, bits:b.examples[0].input, k:found.k});
        send(res, {discoveredTask:found.task, confidence:found.confidence, k:found.k, verified:result.verifier?.consistent, program:result.verifier?.program, answer:result.answer, examplesChecked:b.examples.length, latencyMs:Date.now()-t0});
      } else {
        send(res, {discoveredTask:'unknown', confidence:0, message:'Add more examples or a taskHint', latencyMs:Date.now()-t0});
      }
      return;
    }

    if (req.method === 'POST' && url === '/reason') {
      const b = await readBody(req);
      if (!b.question) { fail(res,'question required'); return; }
      const parsed = core.parseQuestion(b.question);
      if (!parsed) { send(res,{answer:null,method:'unrecognized',message:'Try: "parity of 1,0,1,1" or "majority of 1,1,0,1,0"'}); return; }
      const result = await core.solve(parsed);
      send(res, {...result, question:b.question, latencyMs:Date.now()-t0});
      return;
    }

    if (req.method === 'POST' && url === '/tool/orbital_reason') {
      const b = await readBody(req);
      let result;
      if (b.task==='expression'||b.expression) {
        const parsed = parser.parse(b.expression||b.question||'');
        if (!parsed.valid) { fail(res,'Cannot parse expression'); return; }
        const bits = parsed.variables.map(v=>(b.values||{})[v]??0);
        result = await core.solve({task:parser.inferTaskType(parsed), bits});
      } else if (b.task==='auto'&&b.question) {
        const parsed = core.parseQuestion(b.question);
        if (!parsed) { send(res,{answer:null,method:'unrecognized'}); return; }
        result = await core.solve(parsed);
      } else {
        if (!b.task||!Array.isArray(b.bits)) { fail(res,'task and bits required'); return; }
        result = await core.solve({task:b.task, bits:b.bits, k:b.k});
      }
      send(res, {answer:result.answer, answerText:result.answerText, confidence:result.confidence, method:result.method, verified:result.verifier?.consistent??null, latencyMs:Date.now()-t0});
      return;
    }

    if (req.method === 'POST' && url === '/v1/chat/completions') {
      const b = await readBody(req);
      const last = [...(b.messages||[])].reverse().find(m=>m.role==='user');
      if (!last?.content) { fail(res,'No user message'); return; }
      const parsed = core.parseQuestion(last.content);
      let content, orbital_result=null;
      if (parsed) {
        orbital_result = await core.solve(parsed);
        content = `Answer: ${orbital_result.answerText}\nMethod: ${orbital_result.method}\nVerified: ${orbital_result.verifier?.consistent?'yes':'n/a'}`;
      } else {
        content = 'Could not parse as a supported logic task (parity, majority, threshold, and, or, xor on binary inputs).';
      }
      send(res, {id:`chatcmpl_${Date.now()}`,object:'chat.completion',created:Math.floor(Date.now()/1000),model:b.model||'orbital-reasoning-v2',choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content}}],orbital_result,usage:{prompt_tokens:0,completion_tokens:0,total_tokens:0}});
      return;
    }

    // Static files
    if (req.method==='GET') {
      const fp = path_.join(PUBLIC, url==='/'?'/index.html':url);
      if (fs_.existsSync(fp)&&fs_.statSync(fp).isFile()) {
        const mime = {'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json'}[path_.extname(fp)]||'text/plain';
        res.writeHead(200,{'Content-Type':mime});
        res.end(fs_.readFileSync(fp));
        return;
      }
    }

    fail(res, `Not found: ${url}`, 404);

  } catch(e) {
    console.error('[error]', e.message);
    fail(res, e.message, 500);
  }
});

server.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║  ORBITAL REASONING SERVER v2                        ║');
  console.log('║  Exact logic. Universal SDK. LLM-ready.             ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║  HTTP:    http://localhost:${PORT}                     ║`);
  console.log(`║  Stream:  http://localhost:${PORT}/stream              ║`);
  console.log(`║  CLI:     node cli/orbital.js help                   ║`);
  console.log(`║  MCP:     node src/mcp/OrbitalMCPServer.js           ║`);
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log('║  Concept: Wisam  |  Implementation: Claude          ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');
});

module.exports = server;
