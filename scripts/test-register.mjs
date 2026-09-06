// Run the app's TypeScript and @/ imports in Node's built-in test runner.
import { registerHooks } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, extname } from 'node:path';
import ts from 'typescript';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      const file = resolve('src', specifier.slice(2));
      for (const extension of ['.ts', '.tsx', '.js']) {
        if (existsSync(file + extension)) return { url: pathToFileURL(file + extension).href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith('file:') && ['.ts', '.tsx'].includes(extname(fileURLToPath(url)))) {
      return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
        fileName: fileURLToPath(url),
      }).outputText };
    }
    return nextLoad(url, context);
  },
});
