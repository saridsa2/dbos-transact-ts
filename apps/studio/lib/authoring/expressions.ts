import jsep from 'jsep';
export type ExpressionContext = {
  input: unknown;
  nodeInput?: unknown;
  index?: number;
  outputs: Record<string, unknown>;
  variables?: Record<string, unknown>;
  item?: unknown;
  state?: unknown;
  execution?: unknown;
};
const blocked = new Set(['__proto__', 'prototype', 'constructor']);
const roots = new Set(['$input', '$nodes', '$vars', '$item', '$state', '$execution', '$nodeInput', '$index']);
const helpers: Record<string, (...args: any[]) => unknown> = {
  hasOutput: (_v) => false,
  string: (v) => String(v),
  number: (v) => Number(v),
  boolean: (v) => Boolean(v),
  count: (v) => (Array.isArray(v) || typeof v === 'string' ? v.length : Object.keys(v ?? {}).length),
  sum: (v) => {
    if (!Array.isArray(v) || v.length > 10000 || v.some((x) => typeof x !== 'number'))
      throw new Error('sum expects an array of numbers');
    return v.reduce((a, b) => a + b, 0);
  },
  upper: (v) => String(v).toUpperCase(),
  lower: (v) => String(v).toLowerCase(),
  join: (v, sep = ',') => {
    if (!Array.isArray(v)) throw new Error('join expects an array');
    const separator = String(sep);
    if (
      v.length > 10000 ||
      v.reduce((n, x) => n + String(x).length, 0) + Math.max(0, v.length - 1) * separator.length > 4194304
    )
      throw new Error('Expression result exceeds limits.');
    return v.join(separator);
  },
  concat: (...v) => {
    if (v.reduce((n, x) => n + (Array.isArray(x) ? x.length : 1), 0) > 10000)
      throw new Error('Expression array limit exceeded.');
    return v.flat();
  },
  keys: (v) => Object.keys(v ?? {}),
  values: (v) => Object.values(v ?? {}),
  coalesce: (...v) => v.find((x) => x !== null && x !== undefined) ?? null,
};
export function expressionAst(source: string): jsep.Expression {
  if (source.length > 10000) throw new Error('Expression exceeds 10000 characters.');
  const ast = jsep(source);
  let count = 0;
  function check(n: jsep.Expression, depth = 0, nodeAccess = false): void {
    if (++count > 500 || depth > 40) throw new Error('Expression is too complex.');
    switch (n.type) {
      case 'Literal':
        if (typeof n.value === 'object' && n.value !== null) throw new Error('Unsupported literal.');
        return;
      case 'Identifier':
        if (n.name === '$nodes' && !nodeAccess) throw new Error('Select a specific upstream node from $nodes.');
        if (!roots.has(String(n.name))) throw new Error(`Unknown expression variable ${n.name}.`);
        return;
      case 'MemberExpression': {
        const m = n as jsep.MemberExpression;
        check(m.object, depth + 1, true);
        if (m.computed) {
          if (m.property.type !== 'Literal') throw new Error('Property names and array indexes must be fixed.');
        } else if (m.property.type !== 'Identifier') throw new Error('Invalid property.');
        const key = String(m.computed ? (m.property as jsep.Literal).value : (m.property as jsep.Identifier).name);
        if (blocked.has(key)) throw new Error('Unsafe property path.');
        return;
      }
      case 'UnaryExpression':
        if (!['!', '-', '+'].includes(String(n.operator))) throw new Error('Unsupported unary operator.');
        check(n.argument as jsep.Expression, depth + 1);
        return;
      case 'BinaryExpression':
      case 'LogicalExpression':
        if (
          !['+', '-', '*', '/', '%', '**', '===', '!==', '==', '!=', '>', '>=', '<', '<=', '&&', '||', '??'].includes(
            String(n.operator),
          )
        )
          throw new Error('Unsupported operator.');
        check(n.left as jsep.Expression, depth + 1);
        check(n.right as jsep.Expression, depth + 1);
        return;
      case 'ConditionalExpression':
        for (const key of ['test', 'consequent', 'alternate']) check(n[key] as jsep.Expression, depth + 1);
        return;
      case 'ArrayExpression':
        for (const e of (n as jsep.ArrayExpression).elements) if (e) check(e, depth + 1);
        return;
      case 'CallExpression': {
        const call = n as jsep.CallExpression;
        if (call.callee.type !== 'Identifier' || !Object.hasOwn(helpers, String(call.callee.name)))
          throw new Error('Only documented expression helpers can be called.');
        for (const a of call.arguments) check(a, depth + 1);
        return;
      }
      default:
        throw new Error(`Unsupported expression syntax: ${n.type}.`);
    }
  }
  check(ast);
  return ast;
}
export function expressionNodeReferences(source: string): string[] {
  const found = new Set<string>();
  function walk(n: jsep.Expression) {
    if (n.type === 'MemberExpression') {
      const m = n as jsep.MemberExpression;
      if (m.object.type === 'Identifier' && m.object.name === '$nodes')
        found.add(String(m.computed ? (m.property as jsep.Literal).value : (m.property as jsep.Identifier).name));
    }
    for (const v of Object.values(n)) {
      if (Array.isArray(v))
        for (const x of v)
          if (x && typeof x === 'object' && 'type' in x) walk(x as jsep.Expression);
          else {
          }
      else if (v && typeof v === 'object' && 'type' in v) walk(v as jsep.Expression);
    }
  }
  walk(expressionAst(source));
  return [...found];
}
export function evaluateExpression(source: string, context: ExpressionContext): unknown {
  const env: Record<string, unknown> = {
    $input: context.input,
    $nodeInput: context.nodeInput,
    $index: context.index,
    $nodes: context.outputs,
    $vars: context.variables ?? {},
    $item: context.item,
    $state: context.state,
    $execution: context.execution,
  };
  function run(n: jsep.Expression): any {
    switch (n.type) {
      case 'Literal':
        return n.value;
      case 'Identifier':
        if (env[String(n.name)] === undefined) throw new Error(`${n.name} is unavailable in this execution context.`);
        return env[String(n.name)];
      case 'MemberExpression': {
        const m = n as jsep.MemberExpression;
        const obj = run(m.object);
        const key = String(m.computed ? (m.property as jsep.Literal).value : (m.property as jsep.Identifier).name);
        if (obj === null || obj === undefined || !Object.hasOwn(Object(obj), key))
          throw new Error(`Expression property '${key}' is unavailable.`);
        return obj[key];
      }
      case 'UnaryExpression': {
        const v = run(n.argument as jsep.Expression);
        return n.operator === '!' ? !v : n.operator === '-' ? -v : +v;
      }
      case 'ConditionalExpression':
        return run(n.test as jsep.Expression)
          ? run(n.consequent as jsep.Expression)
          : run(n.alternate as jsep.Expression);
      case 'ArrayExpression':
        return (n as jsep.ArrayExpression).elements.map((e) => (e ? run(e) : null));
      case 'CallExpression':
        if ((n as jsep.CallExpression).callee.name === 'hasOutput')
          return Object.hasOwn(context.outputs, String(run((n as jsep.CallExpression).arguments[0])));
        return helpers[String((n as jsep.CallExpression).callee.name)](
          ...(n as jsep.CallExpression).arguments.map(run),
        );
      default: {
        const l = run(n.left as jsep.Expression);
        if (n.operator === '&&') return l && run(n.right as jsep.Expression);
        if (n.operator === '||') return l || run(n.right as jsep.Expression);
        if (n.operator === '??') return l ?? run(n.right as jsep.Expression);
        const r = run(n.right as jsep.Expression);
        switch (n.operator) {
          case '+':
            if ((typeof l === 'string' || typeof r === 'string') && String(l).length + String(r).length > 4194304)
              throw new Error('Expression string limit exceeded.');
            return l + r;
          case '-':
            return l - r;
          case '*':
            return l * r;
          case '/':
            return l / r;
          case '%':
            return l % r;
          case '**':
            return l ** r;
          case '==':
          case '===':
            return l === r;
          case '!=':
          case '!==':
            return l !== r;
          case '>':
            return l > r;
          case '>=':
            return l >= r;
          case '<':
            return l < r;
          case '<=':
            return l <= r;
        }
        throw new Error('Unsupported expression.');
      }
    }
  }
  const result = run(expressionAst(source));
  if (typeof result === 'number' && !Number.isFinite(result))
    throw new Error('Expression must produce a finite number.');
  const json = JSON.stringify(result, (_key, value) => {
    if (typeof value === 'number' && !Number.isFinite(value))
      throw new Error('Expression must produce finite JSON numbers.');
    if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint')
      throw new Error('Expression must produce JSON values.');
    return value;
  });
  if (json === undefined || json.length > 4 * 1024 * 1024) throw new Error('Expression result must be bounded JSON.');
  return JSON.parse(json);
}
