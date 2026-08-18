/**
 * Every text a rendered subtree actually shows, in document order — the DOM half of
 * the second hash.
 *
 * The port of `ContractOfferScreen.CollectTexts`, which walked Godot's node tree
 * depth-first and collected every `Label.Text`. The purpose is the same and it is not
 * the obvious one: this is not a second projection of the model. It reads what the
 * markup ended up holding, so a forgotten binding, two swapped blocks or a dropped
 * reason show up here and nowhere in `readModelHash` — which is green for all three,
 * correctly, because it is a claim about the model rather than about the screen.
 *
 * **Text nodes, not elements.** The C# version collected `Label`s, which meant a text
 * put on any other kind of control was invisible to it. Every character a browser
 * paints comes from a text node, so walking those is the version of the same idea
 * with no such hole: an extra label, a caption composed as `caption + ': ' + value`,
 * or a stray string typed straight into a container all change this list.
 *
 * Whitespace-only nodes are skipped, and nothing else is. They are an artefact of how
 * JSX is laid out on the page — two elements on one source line leave a space between
 * them — so counting them would make the list a property of source formatting.
 * Non-empty text is taken exactly as it stands: trimming it would hide a space
 * introduced in code, which is a composed player-facing string like any other.
 */
export function collectRenderedTexts(root: Node): readonly string[] {
  const texts: string[] = [];
  collect(root, texts);

  return texts;
}

function collect(node: Node, texts: string[]): void {
  if (node.nodeType === node.TEXT_NODE) {
    const text = node.nodeValue ?? '';

    if (text.trim() !== '') {
      texts.push(text);
    }

    return;
  }

  for (const child of Array.from(node.childNodes)) {
    collect(child, texts);
  }
}
