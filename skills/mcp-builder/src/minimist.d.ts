declare module "minimist" {
  export interface ParsedArgs {
    _: string[];
    [key: string]: any;
  }

  export interface Options {
    string?: string[];
    boolean?: string[];
    default?: Record<string, unknown>;
    alias?: Record<string, string | string[]>;
  }

  export default function minimist(args?: string[], opts?: Options): ParsedArgs;
}
