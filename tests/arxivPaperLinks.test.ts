import assert from "node:assert/strict";
import test from "node:test";
import { arxivPaperLinks } from "../src/utils/arxivPaperLinks.ts";

test("opening a cached paper with a PDF link uses its abstract page", () => {
  assert.deepEqual(arxivPaperLinks({ id: "http://arxiv.org/abs/2609.12345v2", link: "https://arxiv.org/pdf/2609.12345v2" }), {
    id: "2609.12345v2", pageUrl: "https://arxiv.org/abs/2609.12345v2",
  });
});

test("old cached papers and legacy category IDs retain their version", () => {
  assert.deepEqual(arxivPaperLinks({ id: "", link: "https://arxiv.org/pdf/math.GT/0309136v1.pdf" }), {
    id: "math.GT/0309136v1", pageUrl: "https://arxiv.org/abs/math.GT/0309136v1",
  });
});

test("external URLs and invalid IDs cannot become download requests", () => {
  assert.equal(arxivPaperLinks({ id: "../../file", link: "https://example.com/pdf/2609.12345" }), null);
});
