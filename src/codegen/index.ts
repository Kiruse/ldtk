import fs from 'fs/promises';
import path from 'path';
import { IndentationText, Project, Scope, SourceFile, SyntaxKind } from 'ts-morph';
import { Parser } from '../langkit';
import { CodeWriter } from './code-writer';
import { generateVisitor } from './generate-visitor';
import { DIR, spawn, SpawnPKM, tplDir } from './utils';

export type GenerateOptions = {
  /** Package manager to use in order to invoke antlr4ts. Determined based on presence of package-lock.json or yarn.lock
   * in the current working directory. Specify 'none' to resort to antlr4ts in env.
   */
  pkm?: SpawnPKM;
}

export default async function generate(parser: Parser, { pkm }: GenerateOptions = {}) {
  if (!parser.rules.length) throw Error('Empty Parser rules');
	await runAntlr(parser, pkm);
	await generateCode(parser);
}

async function runAntlr(parser: Parser, pkm: SpawnPKM) {
	const { lexer } = parser;
	const dir = path.join(DIR, 'antlr');
	await fs.mkdir(dir, { recursive: true });
	
	// generate ANTLR grammar files
	const lexerFile  = path.join(dir, lexer.name  + '.g4');
	const parserFile = path.join(dir, parser.name + '.g4');
	
	await Promise.all([
		fs.writeFile(lexerFile, lexer.toAntlr()),
		fs.writeFile(parserFile, parser.toAntlr()),
	]);
	
	let { code } = await spawn('antlr4ts', [lexerFile], pkm);
	if (code) {
    throw Error(`antlr4ts on lexer exited with code ${code}`);
  }
  
  // we generate our own visitor. there's no point in generating an unused listener lib
  // or an interface that's applied to a completely auto-generated class
	({ code } = await spawn('antlr4ts', ['-no-visitor', '-no-listener', parserFile]), pkm);
	if (code) throw Error(`antlr4ts on parser exited with code ${code}`);
}

async function generateCode(parser: Parser) {
	const project = new Project();
  project.manipulationSettings.set({ indentationText: IndentationText.TwoSpaces });
  
  await Promise.all([
    generateUtils(project, parser),
    generateParser(project, parser),
    generateVisitor(project, parser),
  ])
  
  await project.save();
}

/** Generate utils.ts from template */
async function generateUtils(project: Project, parser: Parser) {
  const fs = project.getFileSystem();
  const srcPath = `${await tplDir()}/utils.tpl.ts`;
  const destPath = `${DIR}/utils.ts`;
  await fs.copy(srcPath, destPath);
  project.addSourceFileAtPath(destPath);
}

/** Generate the concrete Parser with Middleware support from the given Parser definition. */
async function generateParser(project: Project, parser: Parser) {
  const { lexer } = parser;
  const ParserIdent = parser.name;
  const LexerIdent = lexer.name;
  
  const rootRule = parser.rules[0];
  const file = project.createSourceFile(path.join(DIR, 'Parser.ts'), undefined, { overwrite: true });
  
  file.addImportDeclarations([
    {
      moduleSpecifier: 'antlr4ts',
      namedImports: ['CharStreams', 'CommonTokenStream'],
    },
    {
      moduleSpecifier: `./antlr/${LexerIdent}`,
      namedImports: [LexerIdent],
    },
    {
      moduleSpecifier: `./antlr/${ParserIdent}`,
      namedImports: [ParserIdent],
    },
    {
      moduleSpecifier: './Visitor',
      namedImports: ['ASTRootNode', 'visit'],
    },
  ]);
  
  const cls = file.addClass({
    name: 'Parser',
    isExported: true,
  });
  
  cls.addConstructor({
    parameters: [
      {
        name: '_lexer',
        scope: Scope.Public,
        type: LexerIdent,
      },
      {
        name: '_parser',
        scope: Scope.Public,
        type: ParserIdent,
      },
    ],
  });
  
  // process()
  cls.addMethod({
    name: 'process',
    statements: writer => {
      const w = new CodeWriter(writer);
      w.write(`return visit.${rootRule.name}(this._parser.${rootRule.name}());`);
    },
  });
  
  // static fromString(source: string): Parser
  cls.addMethod({
    name: 'fromString',
    isStatic: true,
    parameters: [
      {
        name: 'source',
        type: 'string',
      },
    ],
    returnType: 'Parser',
    statements: writer => {
      const w = new CodeWriter(writer);
      w.writeline(`const lexer = new ${LexerIdent}(CharStreams.fromString(source));`);
      w.writeline(`const parser = new ${ParserIdent}(new CommonTokenStream(lexer));`);
      w.writeline(`return new Parser(lexer, parser);`);
    },
  });
  
  // static parse(source: string): ASTRootNode
  cls.addMethod({
    name: 'parse',
    isStatic: true,
    parameters: [{
      name: 'source',
      type: 'string',
    }],
    returnType: 'ASTRootNode',
    statements: writer => {
      const w = new CodeWriter(writer);
      w.writeline(`return Parser.fromString(source).process()`);
    },
  });
}

type HasSetType = { setType(newType: string): void };
const hasSetType = (v: any): v is HasSetType => 'setType' in v;
