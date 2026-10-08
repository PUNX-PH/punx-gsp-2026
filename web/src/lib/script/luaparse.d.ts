// luaparse ships no types. Only what check.ts uses.
declare module "luaparse" {
  export interface LuaNode {
    type: string;
    name?: string;
    loc?: { start: { line: number; column: number } };
    [key: string]: unknown;
  }
  export interface LuaChunk extends LuaNode {
    body: LuaNode[];
  }
  const luaparse: {
    parse(code: string, options?: { luaVersion?: "5.1" | "5.2" | "5.3" | "LuaJIT"; locations?: boolean; comments?: boolean; scope?: boolean }): LuaChunk;
  };
  export default luaparse;
}
