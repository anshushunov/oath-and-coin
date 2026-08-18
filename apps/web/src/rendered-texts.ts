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

/**
 * Every attribute value in the subtree, in document order — the half of the markup
 * the second hash cannot see.
 *
 * Not part of the snapshot comparison, and it must not become part of it: which
 * attributes a screen carries is layout and plumbing, and hashing them would make the
 * rendered-ui hash move on a class name. What it is for is the one rule that has
 * already been broken this way once. The Godot original put `errorDetail` — a
 * machine's absolute path and an exception's own text — on a label's *tooltip*, where
 * neither hash covered it, so the single unlocalized player-facing string on the
 * screen was also the only one nothing compared. `title` and `aria-label` are that
 * tooltip's browser equivalents, and a leak into either is invisible to a walk over
 * text nodes.
 *
 * So this exists to be asserted *against*: a value that must not reach a player is
 * looked for here as well as in the text.
 */
export function collectRenderedAttributes(root: Node): readonly string[] {
  const values: string[] = [];
  collectAttributes(root, values);

  return values;
}

function collectAttributes(node: Node, values: string[]): void {
  if (node.nodeType === node.ELEMENT_NODE) {
    for (const attribute of Array.from((node as Element).attributes)) {
      values.push(attribute.value);
    }
  }

  for (const child of Array.from(node.childNodes)) {
    collectAttributes(child, values);
  }
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
