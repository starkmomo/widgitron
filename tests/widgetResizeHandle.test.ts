import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = ts.createSourceFile("WidgetResizeHandle.tsx",
  readFileSync(new URL("../src/components/WidgetResizeHandle.tsx", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = source.statements.find(node => ts.isFunctionDeclaration(node)
  && node.name?.text === "WidgetResizeHandle")!;
const javascript = ts.transpileModule(component.getText(source).replace("export function", "function"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React },
}).outputText;

type Element = { type: string; props: Record<string, unknown>; children: Element[] };

function render(isMacOS: boolean) {
  const invoked: string[] = [];
  const context = vm.createContext({
    isMacOS, Maximize2: "icon", console,
    useState: (initial: unknown) => [initial, () => {}],
    useRef: (initial: unknown) => ({ current: initial }),
    useEffect: () => {},
    React: { Fragment: "fragment", createElement: (type: string, props: object, ...children: Element[]) => ({ type, props, children }) },
    getCurrentWindow: () => ({ startResizeDragging: async (direction: string) => { invoked.push(direction); } }),
  });
  const tree = vm.runInContext(`${javascript}\nWidgetResizeHandle()`, context) as Element;
  return { grip: tree.children[1], invoked };
}

test("Windows retains its native SouthEast resize button and ignores other mouse buttons", () => {
  const { grip, invoked } = render(false);
  assert.equal(grip.type, "button");
  const handle = grip.props.onPointerDown as (event: object) => void;
  let prevented = 0;
  let stopped = 0;
  handle({ button: 2, preventDefault: () => { prevented += 1; }, stopPropagation: () => { stopped += 1; } });
  assert.deepEqual(invoked, []);
  handle({ button: 0, preventDefault: () => { prevented += 1; }, stopPropagation: () => { stopped += 1; } });
  assert.deepEqual(invoked, ["SouthEast"]);
  assert.equal(prevented, 1);
  assert.equal(stopped, 1);
});

test("Mac grip leaves resize input to its native edge view without invoking the unsupported Tao API", () => {
  const { grip, invoked } = render(true);
  assert.equal(grip.type, "span");
  assert.equal(grip.props.onPointerDown, undefined);
  assert.match(grip.props.className as string, /pointer-events-none/);
  assert.deepEqual(invoked, []);
});
