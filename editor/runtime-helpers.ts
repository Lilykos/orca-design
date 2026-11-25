// Small helpers the artboard runtime runs inside each iframe. They are plain JavaScript source, not
// compiled functions, for the same reason as RUNTIME_SOURCE: transpiler helpers do not exist in the
// iframe. Tests run this exact source through `new Function`.

/**
 * The element's text for a comment's anchor: each text piece of the element, joined with " · ",
 * whitespace collapsed, at most 200 characters. (Orca: UP ran the pieces together with no
 * separator, e.g. "An Ordinary Wonder A COLLECTION IRIS BELL…".)
 */
export const JOIN_TEXTS_SRC = String.raw`function joinTexts(texts) {
  var parts = [];
  for (var i = 0; i < texts.length; i++) {
    var flat = String(texts[i] || "").replace(/\s+/g, " ").trim();
    if (flat) parts.push(flat);
  }
  var joined = parts.join(" · ");
  return joined.length > 200 ? joined.slice(0, 200) : joined;
}`;

/**
 * Where a comment pin's centre goes, in page px: half a pin (10 screen px) right of and above the
 * element's top-right corner, so the pin never covers what it points at, kept inside the page.
 * `scale` is page px per screen px (1 / zoom). (Orca: UP centred pins on the corner.)
 */
export const PIN_POSITION_SRC = String.raw`function pinPosition(rect, pageWidth, scale) {
  var half = 10 * scale;
  var x = rect.x + rect.width + half;
  var y = rect.y - half;
  return { x: Math.min(Math.max(x, half), pageWidth - half), y: Math.max(y, half) };
}`;
