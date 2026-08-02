import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

export function readSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

export function readTypeScriptSource(relativePath: string): ts.SourceFile {
  const source = readSource(relativePath);
  return ts.createSourceFile(
    relativePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith(".tsx")
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS,
  );
}

export function visitTypeScriptNodes(
  node: ts.Node,
  callback: (node: ts.Node) => void,
): void {
  callback(node);
  ts.forEachChild(
    node,
    (child) => visitTypeScriptNodes(child, callback),
  );
}
