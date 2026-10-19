import { parentPort, workerData } from 'node:worker_threads';
import { getQuickJS } from 'quickjs-emscripten';
let runtime, vm;
try {
  const { definition, input, variables } = workerData;
  let source = `async function __userCode(input, variables, item, index) {\n${definition.source}\n}`;
  if (definition.language === 'typescript') {
    const ts = await import('typescript');
    const compiled = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None, strict: true },
      reportDiagnostics: true,
    });
    const errors = (compiled.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error);
    if (errors.length)
      throw new Error(errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' ')).join('\n'));
    source = compiled.outputText;
  }
  const quick = await getQuickJS();
  runtime = quick.newRuntime();
  runtime.setMemoryLimit(definition.limits.memoryMB * 1024 * 1024);
  runtime.setMaxStackSize(512 * 1024);
  const deadline = Date.now() + definition.limits.timeoutMS;
  runtime.setInterruptHandler(() => Date.now() > deadline);
  vm = runtime.newContext();
  const payload = JSON.stringify(JSON.stringify({ input, variables }));
  const code = `(async () => {
  'use strict';
  const data=JSON.parse(${payload}); const logs=[]; let logBytes=0;
  const record=(level,...args)=>{if(logs.length>=100||logBytes>=16000)return; const text=level+': '+args.map(v=>typeof v==='string'?v:JSON.stringify(v)).join(' ').slice(0,1000);logBytes+=text.length;logs.push(text);};
  const console=Object.freeze({log:(...v)=>record('log',...v),info:(...v)=>record('info',...v),warn:(...v)=>record('warn',...v),error:(...v)=>record('error',...v)});
  ${source}
  let value;
  if(${JSON.stringify(definition.mode)}==='each-item'){
   if(!Array.isArray(data.input)||data.input.length>1000)throw new Error('Per-item code input must be an array with at most 1000 items.');
   value=[];for(let index=0;index<data.input.length;index++)value.push(await __userCode(data.input[index],data.variables,data.input[index],index));
  } else value=await __userCode(data.input,data.variables,undefined,undefined);
  const result=JSON.stringify({value,logs},(key,v)=>{if(v===undefined||typeof v==='function'||typeof v==='symbol'||typeof v==='bigint'||(typeof v==='number'&&!Number.isFinite(v)))throw new Error('Code must return JSON values without undefined, functions, bigint or non-finite numbers.');return v;});
  if(result.length>${definition.limits.maxOutputBytes})throw new Error('Code output exceeds the configured limit.');
  return result;
 })()`;
  const evaluated = vm.evalCode(code, 'stackproc-code.js');
  if (evaluated.error) {
    const value = vm.dump(evaluated.error);
    evaluated.error.dispose();
    throw new Error(value?.message ?? String(value));
  }
  const handle = evaluated.value;
  while (runtime.hasPendingJob()) {
    const jobs = runtime.executePendingJobs(64);
    if (jobs.error) {
      const value = jobs.error.context.dump(jobs.error);
      jobs.error.dispose();
      throw new Error(value?.message ?? String(value));
    }
  }
  const state = vm.getPromiseState(handle);
  handle.dispose();
  if (state.type === 'pending')
    throw new Error('Code returned an unresolved promise. External I/O and timers are not enabled.');
  if (state.type === 'rejected') {
    const value = vm.dump(state.error);
    state.error.dispose();
    throw new Error(value?.message ?? String(value));
  }
  const json = vm.getString(state.value);
  state.value.dispose();
  if (Buffer.byteLength(json) > definition.limits.maxOutputBytes)
    throw new Error('Code output exceeds the configured byte limit.');
  parentPort.postMessage({ ok: true, ...JSON.parse(json) });
} catch (error) {
  parentPort.postMessage({ ok: false, error: String(error?.message ?? 'Code execution failed.').slice(0, 4000) });
} finally {
  try {
    vm?.dispose();
    runtime?.dispose();
  } catch {}
}
