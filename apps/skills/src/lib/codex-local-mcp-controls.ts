/** Shared Codex 0.160 local stdio MCP metadata contract. Extracted from the
 * native plugin reviewer without broadening its admitted capabilities. Callers
 * decide whether a declaration stays fully fingerprinted or is nondiscovery. */
export function isCodexLocalStdioMcpServer(name: string, server: any): boolean {
  const identifier = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
  const refuse = (): never => { throw new Error("Unsupported Codex local stdio MCP controls"); };
  const object=(v:any):boolean => Boolean(v && typeof v==="object" && !Array.isArray(v) && !(v instanceof Date));
  const textField=(v:any,empty=false):boolean => typeof v==="string" && (empty || Boolean(v.trim()))
    && Buffer.byteLength(v)<=16384 && !/[\x00-\x1f\x7f]/.test(v);
  const envName=(v:any):boolean => typeof v==="string" && /^[A-Za-z_][A-Za-z0-9_]{0,255}$/.test(v);
  const optional=(v:any,valid:(v:any)=>boolean):boolean => v===undefined || v===null || valid(v);
  const stringList=(v:any):boolean => Array.isArray(v) && v.length<=256 && v.every((item:any)=>textField(item));
  const approval=(v:any):boolean => ["auto","prompt","writes","approve"].includes(v);
  const duration=(v:any):boolean => typeof v==="number" && Number.isFinite(v) && v>=0;
  const positiveInteger=(v:any):boolean => Number.isSafeInteger(v) && v>0;
  const fields=["command","args","cwd","env","env_vars","enabled","required","environment_id","startup_readiness",
    "supports_parallel_tool_calls","tool_input_schema_max_bytes","startup_timeout_sec","startup_timeout_ms","tool_timeout_sec",
    "default_tools_approval_mode","enabled_tools","disabled_tools","omit_tools_from","tools","name"];
  try {
    if (!identifier(name) || !object(server) || !Object.keys(server).every(key=>fields.includes(key))
      || !textField(server.command)
      || !optional(server.args,v=>Array.isArray(v) && v.length<=256 && v.every((arg:any)=>textField(arg,true)))
      || !optional(server.cwd,textField)
      || !optional(server.env,v=>object(v) && Object.keys(v).length<=256 && Object.entries(v).every(([key,value])=>envName(key) && textField(value,true)))
      || !["enabled","required","supports_parallel_tool_calls"].every(key=>optional(server[key],v=>typeof v==="boolean"))
      || !optional(server.environment_id,v=>v==="local")
      || !optional(server.startup_readiness,v=>["connection","catalog"].includes(v))
      || !optional(server.tool_input_schema_max_bytes,positiveInteger)
      || !["startup_timeout_sec","tool_timeout_sec"].every(key=>optional(server[key],duration))
      || !optional(server.startup_timeout_ms,v=>Number.isSafeInteger(v) && v>=0)
      || !optional(server.default_tools_approval_mode,approval)
      || !["enabled_tools","disabled_tools"].every(key=>optional(server[key],stringList))
      || !optional(server.omit_tools_from,v=>Array.isArray(v) && v.length<=256 && v.every((item:any)=>["code_mode","deferred","direct"].includes(item)))
      || !optional(server.name,textField)) refuse();
    if (server.env_vars!==undefined && server.env_vars!==null) {
      if (!Array.isArray(server.env_vars) || server.env_vars.length>256) refuse();
      const names=server.env_vars.map((entry:any)=>{
        if (envName(entry)) return entry;
        if (!object(entry) || !Object.keys(entry).every(key=>["name","source"].includes(key)) || !envName(entry.name)
          || !optional(entry.source,v=>v==="local")) refuse();
        return entry.name;
      });
      if (new Set(names).size!==names.length) refuse();
    }
    if (server.tools!==undefined && server.tools!==null) {
      if (!object(server.tools) || Object.keys(server.tools).length>256) refuse();
      for (const [tool,config] of Object.entries(server.tools) as [string,any][]) {
        if (!textField(tool) || !object(config) || !Object.keys(config).every(key=>["approval_mode","output_token_limit"].includes(key))
          || !optional(config.approval_mode,approval) || !optional(config.output_token_limit,positiveInteger)) refuse();
      }
    }
    return true;
  } catch { return false; }
}
