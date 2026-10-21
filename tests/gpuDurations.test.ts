import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = ts.createSourceFile("GPUWidgetContent.tsx",
  readFileSync(new URL("../src/widgets/GPUWidgetContent.tsx", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

const declarations = source.statements.filter(node => ts.isFunctionDeclaration(node)
  && ["parseSlurmTime", "slurmDurationKey"].includes(node.name?.text ?? ""));
assert.equal(declarations.length, 2);

function findEffect(marker: string): ts.Expression {
  let effect: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === "useEffect"
      && node.arguments[0]?.getText(source).includes(marker)) effect = node.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(effect, `Missing duration effect: ${marker}`);
  return effect;
}

type Server = {
  host: string;
  gpu_list: { job_id: string }[];
  slurm_times: Record<string, string>;
  slurm_steps: Record<string, { id: string; time: string }[]>;
  slurm_queue_jobs: { id: string; time: string }[];
};

function server(host: string, minutes: number): Server {
  return {
    host, gpu_list: [{ job_id: "42" }],
    slurm_times: { "42": `${minutes}:00` },
    slurm_steps: { "42": [{ id: "42.0", time: `${minutes + 1}:00` }] },
    slurm_queue_jobs: [{ id: "42", time: `${minutes + 2}:00` }],
  };
}

function clocks(initial: Server[]) {
  let state: Record<string, number> = {};
  let tick!: () => void;
  const context = vm.createContext({
    serverData: initial, hasTrackedDurations: true,
    setDurations: (update: (previous: typeof state) => typeof state) => { state = update(state); },
    setInterval: (callback: () => void) => { tick = callback; return 1; },
    clearInterval: () => {},
  });
  const javascript = ts.transpileModule([
    ...declarations.map(node => node.getText(source)),
    `({ sync: ${findEffect("const visibleJobs = new Set<string>()").getText(source)},`,
    `timer: ${findEffect("if (!hasTrackedDurations) return;").getText(source)}, key: slurmDurationKey })`,
  ].join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const runtime = vm.runInContext(javascript, context) as {
    sync: () => void;
    timer: () => () => void;
    key: (host: string, id: string, kind?: "job" | "step" | "queue") => string;
  };
  const cleanup = runtime.timer();
  return {
    sync(servers = initial) { context.serverData = servers; runtime.sync(); },
    tick: () => tick(),
    read(host: string, id: string, kind?: "job" | "step" | "queue") {
      return state[runtime.key(host, id, kind)];
    },
    state: () => state,
    evaluate(expression: string, host: string) {
      return vm.runInNewContext(expression, {
        durations: state, slurmDurationKey: runtime.key,
        server: { host }, jobId: "42", step: { id: "42.0" }, job: { id: "42" },
      });
    },
    cleanup,
  };
}

test("different servers keep separate clocks for the same Slurm job, step and queue IDs", () => {
  const clock = clocks([server("cluster-a", 10), server("cluster-b", 20)]);
  clock.sync();
  assert.equal(clock.read("cluster-a", "42"), 600);
  assert.equal(clock.read("cluster-b", "42"), 1200);
  assert.equal(clock.read("cluster-a", "42.0", "step"), 660);
  assert.equal(clock.read("cluster-b", "42.0", "step"), 1260);
  assert.equal(clock.read("cluster-a", "42", "queue"), 720);
  assert.equal(clock.read("cluster-b", "42", "queue"), 1320);
  assert.equal(Object.keys(clock.state()).length, 6);
  clock.tick();
  assert.equal(clock.read("cluster-a", "42"), 601);
  assert.equal(clock.read("cluster-b", "42"), 1201);
  clock.cleanup();
});

test("refresh order and pruning one server cannot reset another server's clock", () => {
  const a = server("cluster-a", 10);
  const b = server("cluster-b", 100);
  const clock = clocks([a, b]);
  clock.sync();
  clock.tick();
  clock.sync([b, a]);
  assert.equal(clock.read("cluster-a", "42"), 601);
  assert.equal(clock.read("cluster-b", "42"), 6001);
  clock.sync([b]);
  assert.equal(clock.read("cluster-a", "42"), undefined);
  assert.equal(clock.read("cluster-a", "42.0", "step"), undefined);
  assert.equal(clock.read("cluster-a", "42", "queue"), undefined);
  assert.equal(clock.read("cluster-b", "42"), 6001);
  assert.equal(Object.keys(clock.state()).length, 3);
  clock.cleanup();
});

test("compact, full and queue render paths read the matching server clock", () => {
  const clock = clocks([server("cluster-a", 10), server("cluster-b", 20)]);
  clock.sync();
  const reads: ts.ElementAccessExpression[] = [];
  function visit(node: ts.Node) {
    if (ts.isElementAccessExpression(node) && node.expression.getText(source) === "durations") reads.push(node);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(reads.length, 5);
  for (const read of reads) {
    const expression = read.getText(source);
    const kind = expression.includes('"step"') ? "step" : expression.includes('"queue"') ? "queue" : "job";
    const id = kind === "step" ? "42.0" : "42";
    for (const host of ["cluster-a", "cluster-b"]) {
      assert.equal(clock.evaluate(expression, host), clock.read(host, id, kind));
    }
  }
  clock.cleanup();
});
