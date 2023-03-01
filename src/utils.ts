import { Token } from 'antlr4ts/Token';
import chalk from 'chalk';
import { AnyVisitor, BaseTransformer, TransformerASTNodes, TransformVisitorFromBase, VisitorASTNodes } from './transform';
import type { AST } from './transform/AST';

type ExtractASTMapFromVisitor<V extends AnyVisitor> = {
  [K in keyof V]: ReturnType<V[K]>;
}
export type ASTMap<T> =
  T extends AST<infer M, any> ? M
  : T extends BaseTransformer
  ? ExtractASTMapFromVisitor<TransformVisitorFromBase<T>>
  : T extends AnyVisitor
  ? ExtractASTMapFromVisitor<T>
  : never;
export type ASTNodes<T> = ASTMap<T>[keyof ASTMap<T>];

type AntlrCtx = {
  _start: Token;
  _stop: Token | undefined;
}
type RuleAST = {
  type: string;
  children: ASTLike[] | never[];
  ctx: AntlrCtx;
}
type OptionsAST = {
  type: string;
  family: 'options';
  option: RuleAST;
  children: [RuleAST];
  ctx: AntlrCtx;
}
type ASTLike = RuleAST | OptionsAST;

export async function dump(src: string, ast: ASTLike) {
  return await dump_inner(src, ast, 0);
}

async function dump_inner(src: string, ast: ASTLike, level: number) {
  const indent = '  '.repeat(level);
  const isOptions = 'family' in ast && ast.family === 'options';
  
  let line = '';
  
  if (isOptions) {
    line += `${indent}${chalk.green(ast.option.type)}`;
  } else {
    line += `${indent}${chalk.cyan(ast.type)}`;
  }
  
  if (ast.ctx._stop) {
    line += ': ' + chalk.yellow(getCodeRange(src, ast.ctx._start, ast.ctx._stop).replace(/\r?\n/g, '\\n'));
  }
  
  console.log(line);
    
  if (isOptions) {
    ast.option.children.forEach(child => dump_inner(src, child, level + 1));
  } else {
    ast.children.forEach(child => dump_inner(src, child, level + 1));
  }
}

export function getCodeRange(src: string, start: Token, stop: Token) {
  const startIdx = start.startIndex;
  const stopIdx = stop.stopIndex;
  return src.substring(startIdx, stopIdx + 1);
}

export function createNodeFinder<V extends AnyVisitor | BaseTransformer<any, any>>(visit: V) {
  type Nodes = V extends BaseTransformer<any, any>
    ? TransformerASTNodes<V>
    : V extends AnyVisitor
    ? VisitorASTNodes<V>
    : never;
  return function findNodes<Type extends Nodes['type']>(type: Type, node: ASTLike, result = new Set<ASTLike>()): Array<Nodes & { type: Type }> {
    if (node.type === type) result.add(node);
    for (const child of node.children) {
      findNodes(type, child, result);
    }
    return [...result as any];
  }
}
